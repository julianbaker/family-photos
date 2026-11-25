import { BadRequestException } from '@nestjs/common';
import { FamilyInviteService } from 'src/family/family-invite.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyInviteService.name, () => {
  let sut: FamilyInviteService;
  let mocks: ServiceMocks;

  const loginDetails = { clientIp: '127.0.0.1', deviceOS: '', deviceType: '', isSecure: false, appVersion: null };
  const dto = { token: 'token', email: 'new@example.com', name: 'New', password: 'password' };
  const invite = {
    id: newUuid(),
    familyId: newUuid(),
    clusterGroupId: newUuid(),
    role: FamilyRole.Member,
    maxUses: 1,
    uses: 0,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdById: newUuid(),
  };

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyInviteService));
    mocks.crypto.hashSha256.mockReturnValue(Buffer.from('hash'));
    mocks.family.getInviteByTokenHash.mockResolvedValue({ ...invite, familyName: 'Family' } as never);
    mocks.family.consumeInvite.mockResolvedValue({ ...invite, uses: 1 } as never);
    mocks.user.getByEmail.mockResolvedValue(void 0);
    mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }) as never);
    mocks.clusterGroup.create.mockResolvedValue({ id: newUuid() } as never);
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  describe('accept', () => {
    it('should give the use back and remove the account when joining the family fails', async () => {
      const user = UserFactory.create({ email: dto.email });
      mocks.user.create.mockResolvedValue(user as never);
      // adding the account to the family fails: the user can't be loaded
      mocks.family.getMembership.mockResolvedValue(void 0);
      mocks.user.get.mockResolvedValue(void 0);

      await expect(sut.accept(dto, loginDetails)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.family.releaseInvite).toHaveBeenCalledWith(invite.id);
      expect(mocks.user.delete).toHaveBeenCalledWith({ id: user.id }, true);
      expect(mocks.family.addInviteUse).not.toHaveBeenCalled();
    });

    it('should give the use back when the account cannot be created', async () => {
      mocks.user.create.mockRejectedValue(new Error('database down'));

      await expect(sut.accept(dto, loginDetails)).rejects.toThrow('database down');

      expect(mocks.family.releaseInvite).toHaveBeenCalledWith(invite.id);
      expect(mocks.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('should drop the link kept on approved requests', async () => {
      const admin = { user: { id: newUuid() } } as never;
      mocks.family.getMembership.mockResolvedValue({
        familyId: invite.familyId,
        clusterGroupId: invite.clusterGroupId,
        role: FamilyRole.Admin,
      });
      mocks.family.revokeInvite.mockResolvedValue({ ...invite } as never);

      await sut.revoke(admin, invite.id);

      expect(mocks.family.clearRequestTokens).toHaveBeenCalledWith(invite.id);
    });
  });
});
