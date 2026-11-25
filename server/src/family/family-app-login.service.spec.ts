import { BadRequestException } from '@nestjs/common';
import { APP_LOGIN_DEVICE_TYPE, FamilyAppLoginService } from 'src/family/family-app-login.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { clearConfigCache } from 'src/utils/config.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyAppLoginService.name, () => {
  let sut: FamilyAppLoginService;
  let mocks: ServiceMocks;

  const user = UserFactory.create();
  const auth = { user: { id: user.id, name: user.name } } as never;
  const loginDetails = { clientIp: '127.0.0.1', deviceOS: 'iOS', deviceType: '', isSecure: true, appVersion: null };
  const hash = Buffer.from('hash');
  const CODE = Buffer.from('one-time-code-abcdefghi').toString('base64url');

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    clearConfigCache();
    ({ sut, mocks } = newTestService(FamilyAppLoginService));
    mocks.crypto.randomBytes.mockReturnValue(Buffer.from('one-time-code-abcdefghi'));
    mocks.crypto.hashSha256.mockReturnValue(hash);
    mocks.family.getMembership.mockResolvedValue({
      familyId: newUuid(),
      clusterGroupId: newUuid(),
      role: FamilyRole.Viewer,
    });
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  describe('create', () => {
    it('stores only a hash of a code that expires in 5 minutes, for any family role', async () => {
      const before = Date.now();
      const result = await sut.create(auth, 'https://photos.example.com');

      expect(result.code).toBe(CODE);
      expect(mocks.crypto.randomBytes).toHaveBeenCalledWith(24);
      expect(mocks.family.createAppLoginCode).toHaveBeenCalledWith({
        userId: user.id,
        codeHash: hash,
        expiresAt: result.expiresAt,
      });
      const lifetime = result.expiresAt.getTime() - before;
      expect(lifetime).toBeGreaterThanOrEqual(5 * 60 * 1000 - 1000);
      expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    });

    it('clears out codes that can no longer be used', async () => {
      await sut.create(auth, 'https://photos.example.com');
      expect(mocks.family.deleteStaleAppLoginCodes).toHaveBeenCalled();
    });

    it("builds the links from the server's external domain when it is set", async () => {
      mocks.systemMetadata.get.mockResolvedValue({ server: { externalDomain: 'https://family.example.com/' } });

      const result = await sut.create(auth, 'http://192.168.1.2:2283');

      expect(result.url).toBe(`https://family.example.com/app-login?code=${CODE}`);
      expect(result.appUrl).toBe(`sibred://app-login?server=https%3A%2F%2Ffamily.example.com&code=${CODE}`);
    });

    it('falls back to the address the website was reached on', async () => {
      const result = await sut.create(auth, 'https://photos.example.com');

      expect(result.url).toBe(`https://photos.example.com/app-login?code=${CODE}`);
      expect(result.appUrl).toBe(`sibred://app-login?server=https%3A%2F%2Fphotos.example.com&code=${CODE}`);
    });

    it("refuses when the server's address can't be worked out", async () => {
      await expect(sut.create(auth)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.family.createAppLoginCode).not.toHaveBeenCalled();
    });

    it('refuses people who are not in a family', async () => {
      mocks.family.getMembership.mockResolvedValue(void 0);
      await expect(sut.create(auth, 'https://photos.example.com')).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.family.createAppLoginCode).not.toHaveBeenCalled();
    });

    it('refuses while the family feature is off', async () => {
      delete process.env.IMMICH_FAMILY_ENABLED;
      await expect(sut.create(auth, 'https://photos.example.com')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('redeem', () => {
    it('signs in as the person who made the code, as a new session from the app', async () => {
      mocks.family.consumeAppLoginCode.mockResolvedValue({ id: newUuid(), userId: user.id });
      mocks.user.get.mockResolvedValue(user as never);
      mocks.crypto.randomBytesAsText.mockReturnValue('session-token');
      mocks.session.create.mockResolvedValue({} as never);

      const result = await sut.redeem({ code: CODE }, loginDetails);

      expect(mocks.family.consumeAppLoginCode).toHaveBeenCalledWith(hash);
      expect(mocks.user.get).toHaveBeenCalledWith(user.id, { withDeleted: false });
      expect(mocks.session.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: user.id, token: hash, deviceType: APP_LOGIN_DEVICE_TYPE, deviceOS: 'iOS' }),
      );
      expect(result).toEqual(expect.objectContaining({ accessToken: 'session-token', userId: user.id }));
    });

    it('refuses an unknown, expired or used code', async () => {
      mocks.family.consumeAppLoginCode.mockResolvedValue(void 0);

      await expect(sut.redeem({ code: CODE }, loginDetails)).rejects.toThrow(
        'This sign-in link has expired or was already used. Make a new one.',
      );
      expect(mocks.session.create).not.toHaveBeenCalled();
    });

    it('refuses a code whose account was deleted', async () => {
      mocks.family.consumeAppLoginCode.mockResolvedValue({ id: newUuid(), userId: user.id });
      mocks.user.get.mockResolvedValue(void 0);

      await expect(sut.redeem({ code: CODE }, loginDetails)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.session.create).not.toHaveBeenCalled();
    });

    it('refuses while the family feature is off', async () => {
      delete process.env.IMMICH_FAMILY_ENABLED;
      await expect(sut.redeem({ code: CODE }, loginDetails)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.family.consumeAppLoginCode).not.toHaveBeenCalled();
    });
  });
});
