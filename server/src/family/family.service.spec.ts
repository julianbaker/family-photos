import { ForbiddenException } from '@nestjs/common';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyService } from 'src/family/family.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyService.name, () => {
  let sut: FamilyService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyService));
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  describe('addMember', () => {
    it('should refuse a family admin who is not a server admin', async () => {
      const auth = AuthFactory.create({ isAdmin: false });
      mocks.family.getMembership.mockResolvedValue({
        familyId: newUuid(),
        clusterGroupId: newUuid(),
        role: FamilyRole.Admin,
      });

      await expect(sut.addMember(auth, { userId: newUuid(), role: FamilyRole.Member })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.family.addMember).not.toHaveBeenCalled();
      expect(mocks.person.reassignCluster).not.toHaveBeenCalled();
    });
  });

  describe('getBranding', () => {
    afterEach(() => {
      delete process.env.IMMICH_FAMILY_APP_URL;
    });

    it('includes where to get the app, when configured', async () => {
      process.env.IMMICH_FAMILY_APP_URL = 'https://apps.apple.com/app/id123';
      mocks.family.getAnyFamily.mockResolvedValue({ wordmark: 'Smiths' } as never);

      await expect(sut.getBranding()).resolves.toEqual({
        wordmark: 'Smiths',
        appUrl: 'https://apps.apple.com/app/id123',
      });
    });

    it('has no app link when none is configured', async () => {
      mocks.family.getAnyFamily.mockResolvedValue(void 0);

      await expect(sut.getBranding()).resolves.toEqual({ wordmark: 'sibred', appUrl: null });
    });
  });
});

describe('familyRefuseSharedLinks', () => {
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('refuses public links when the family archive is on, and does nothing when it is off', async () => {
    const { familyRefuseSharedLinks } = await import('src/family/family-owner-fields.js');
    expect(() => familyRefuseSharedLinks()).not.toThrow();
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(() => familyRefuseSharedLinks()).toThrow('Public sharing is turned off');
  });
});
