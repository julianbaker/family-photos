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
});
