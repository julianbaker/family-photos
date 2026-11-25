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

  describe('requireInvitablePerson', () => {
    const personId = newUuid();
    const person = (values: Record<string, unknown> = {}) => ({
      personGroupId: personId,
      name: 'Ann Smith',
      kind: null,
      hasPetFaces: false,
      linkedUserId: null,
      ...values,
    });

    it('accepts an unlinked person in the family', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person()] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).resolves.toEqual(
        expect.objectContaining({ personGroupId: personId }),
      );
      expect(mocks.family.getFamilyPeople).toHaveBeenCalledWith(familyId);
    });

    it('refuses someone not in the family', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toThrow('Person not found in the family');
    });

    it('refuses a pet, set by hand or found by pet recognition', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ kind: 'pet' })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toBeInstanceOf(BadRequestException);

      mocks.family.getFamilyPeople.mockResolvedValue([person({ hasPetFaces: true })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a person marked as a person even with pet faces', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ kind: 'person', hasPetFaces: true })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).resolves.toBeDefined();
    });

    it('refuses a person already linked to an account', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toThrow(
        'Ann Smith is already linked to an account',
      );
    });
  });

  describe('linkInvitedMember', () => {
    const membership = { familyId, clusterGroupId: newUuid(), role: FamilyRole.Member };
    const personId = newUuid();
    const userId = newUuid();

    it('links the person and records it in the history', async () => {
      mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue({ personGroupId: personId } as never);

      await expect(sut.linkInvitedMember(membership, personId, userId)).resolves.toBe(true);

      expect(mocks.family.linkUnlinkedFamilyPerson).toHaveBeenCalledWith(familyId, personId, userId);
      expect(mocks.family.addHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId,
          userId,
          entityType: 'person',
          entityId: personId,
          before: { linkedUserId: null },
          after: { linkedUserId: userId },
        }),
      );
    });

    it('leaves a person someone else was linked to alone', async () => {
      mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue(void 0);

      await expect(sut.linkInvitedMember(membership, personId, userId)).resolves.toBe(false);
      expect(mocks.family.addHistory).not.toHaveBeenCalled();
    });
  });
});
