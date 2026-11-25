import { FamilyPetService } from 'src/family/pets/family-pet.service.js';
import { PET_MODEL_VERSION, PetModelError, PetModels } from 'src/family/pets/pet-models.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyPetService.name, () => {
  let sut: FamilyPetService;
  let mocks: ServiceMocks;
  const familyId = newUuid();

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyPetService));
    mocks.family.removePetFacesOnPrivatePhotos.mockResolvedValue(0);
    mocks.family.getUngroupedPetFaceIds.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('drops waiting previews and asks to back off when there is no family yet', async () => {
    mocks.family.getAnyFamily.mockResolvedValue(void 0);
    (sut as unknown as { pending: Set<string> }).pending.add(newUuid());

    await expect(sut.runOnce()).resolves.toBe('no-family');

    expect((sut as unknown as { pending: Set<string> }).pending.size).toBe(0);
    expect(mocks.family.getAssetsForPetScan).not.toHaveBeenCalled();
  });

  describe('with a family', () => {
    const [first, second] = [newUuid(), newUuid()];
    beforeEach(() => {
      mocks.family.getAnyFamily.mockResolvedValue({ id: familyId } as never);
    });

    it('stops the pass on a model-wide failure and marks nothing as scanned', async () => {
      mocks.family.getAssetsForPetScan.mockResolvedValue([{ id: first }, { id: second }] as never);
      mocks.family.getAssetForPetScan.mockRejectedValue(new PetModelError('no runtime'));

      await expect(sut.runOnce()).rejects.toBeInstanceOf(PetModelError);

      expect(mocks.family.markPetScanned).not.toHaveBeenCalled();
      // the unscanned photos are kept for the retry
      expect([...(sut as unknown as { pending: Set<string> }).pending]).toEqual([first, second]);
    });

    it('does not mark an unreadable photo as scanned, and skips it for the rest of the run', async () => {
      mocks.family.getAssetsForPetScan.mockResolvedValueOnce([{ id: first }] as never).mockResolvedValue([]);
      mocks.family.getAssetForPetScan.mockRejectedValue(new Error('corrupt jpeg'));

      await expect(sut.runOnce()).resolves.toBe('done');

      expect(mocks.family.markPetScanned).not.toHaveBeenCalled();
      expect(mocks.family.getAssetsForPetScan).toHaveBeenLastCalledWith(familyId, PET_MODEL_VERSION, 25, [first]);
    });
  });
});

describe(PetModels.name, () => {
  it('forgets a failed load, so the next use tries again instead of replaying the failure', async () => {
    const models = new PetModels('/nonexistent-sibred-models');
    await expect(models.embed('x.jpg', { x1: 0, y1: 0, x2: 20, y2: 20 })).rejects.toBeInstanceOf(PetModelError);
    expect((models as unknown as { sessions?: unknown }).sessions).toBeUndefined();
    await expect(models.detect('x.jpg', 0.5)).rejects.toBeInstanceOf(PetModelError);
  });
});
