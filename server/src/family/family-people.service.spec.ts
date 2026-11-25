import { BadRequestException } from '@nestjs/common';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyPeopleService.name, () => {
  let sut: FamilyPeopleService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const familyId = newUuid();

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyPeopleService));
    mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Admin });
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('should look the photo up among the family shared photos only', async () => {
    const assetId = newUuid();
    mocks.family.getFamilyAssetIds.mockResolvedValue(new Set());

    await expect(sut.getComments(auth, assetId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(sut.getAssetPeople(auth, assetId)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.family.getFamilyAssetIds).toHaveBeenCalledWith(familyId, [assetId]);
    expect(mocks.family.getComments).not.toHaveBeenCalled();
  });
});
