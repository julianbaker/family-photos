import { BadRequestException } from '@nestjs/common';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const row = (id: string) => ({ personGroupId: id, name: id, gender: null, kind: null, hasPetFaces: false }) as never;
const relation = (personGroupId: string, relatedPersonGroupId: string) =>
  ({ id: newUuid(), personGroupId, relatedPersonGroupId, type: 'parent', qualifier: null, label: null }) as never;

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

  describe('getPeopleToKeep', () => {
    it('protects persisted family people whether or not the feature is on (restart with the flag off)', async () => {
      const ancestor = newUuid();
      mocks.family.getFamilyPersonGroupIds.mockResolvedValue(new Set([ancestor]));

      // enable -> disable -> cleanup -> re-enable: the lookup never depends on the flag
      for (const flag of ['true', undefined, 'true']) {
        if (flag) {
          process.env.IMMICH_FAMILY_ENABLED = flag;
        } else {
          delete process.env.IMMICH_FAMILY_ENABLED;
        }
        await expect(sut.getPeopleToKeep([ancestor, newUuid()])).resolves.toEqual(new Set([ancestor]));
      }
    });
  });

  describe('relations under the graph lock', () => {
    const [a, b, c, child] = [newUuid(), newUuid(), newUuid(), newUuid()];

    beforeEach(() => {
      mocks.family.getFamilyPerson.mockImplementation((_, id) => Promise.resolve(row(id)));
      // runs the plan on a state read "inside the lock", like the repository does
      mocks.family.addRelationsLocked.mockImplementation((_family, plan) =>
        Promise.resolve({
          newId: null,
          relations: plan(
            [row(a), row(b), row(c), row(child)],
            [relation(a, child), relation(b, child)],
          ).relations.map((item) => ({ ...item, id: newUuid() })),
        } as never),
      );
    });

    it('refuses a third parent: the check runs against the relations read under the lock', async () => {
      await expect(
        sut.createRelation(auth, { personId: c, relatedPersonId: child, type: 'parent' } as never),
      ).rejects.toThrow('already has two parents');
      expect(mocks.family.addRelationsLocked).toHaveBeenCalledTimes(1);
    });

    it('addRelative checks under the lock too', async () => {
      await expect(
        sut.addRelative(auth, child, { kind: 'parent', existingId: c } as never),
      ).rejects.toThrow('already has two parents');
      expect(mocks.family.addRelationsLocked).toHaveBeenCalledTimes(1);
    });

    it('writes an accepted relation through the same locked call', async () => {
      await expect(
        sut.createRelation(auth, { personId: c, relatedPersonId: a, type: 'friend' } as never),
      ).resolves.toEqual(expect.objectContaining({ type: 'friend' }));
    });
  });

  describe('changing a person into a pet', () => {
    const [ann, bob, kid] = [newUuid(), newUuid(), newUuid()];

    beforeEach(() => {
      mocks.family.getFamilyPerson.mockResolvedValue({ personGroupId: ann, name: 'Ann', kind: null } as never);
      mocks.family.getFamilyPeople.mockResolvedValue([row(ann), row(bob), row(kid)]);
      mocks.family.getRelations.mockResolvedValue([]);
      mocks.family.updateFamilyPersonChecked.mockImplementation((_f, _id, _values, check) => {
        check([row(ann), row(bob), row(kid)], [relation(ann, kid), relation(bob, ann)]);
        return Promise.resolve({} as never);
      });
    });

    it('returns the relations a pet cannot keep and does not save', async () => {
      const error = await sut.update(auth, ann, { kind: 'pet' } as never).catch((error_) => error_);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().conflicts).toEqual([
        expect.objectContaining({ personId: ann, relatedPersonId: kid, type: 'parent' }),
      ]);
    });
  });

  describe('merging people', () => {
    const [target, source] = [newUuid(), newUuid()];

    beforeEach(() => {
      mocks.family.getFamilyPerson.mockImplementation((_, id) => Promise.resolve({ personGroupId: id, name: id } as never));
      mocks.family.getPeopleWithoutCover.mockResolvedValue([]);
    });

    it('refuses a merge that would make a cycle, before anything is written', async () => {
      // target is the grandchild of source
      const mid = newUuid();
      mocks.family.mergeFamilyPeople.mockImplementation((_f, _t, _s, _v, plan) => {
        plan([row(target), row(source), row(mid)], [relation(source, mid), relation(mid, target)]);
        return Promise.resolve([]);
      });
      await expect(sut.beforeStockMerge(auth, target, [source])).rejects.toThrow('cannot be merged');
      expect(mocks.family.addHistory).not.toHaveBeenCalled();
    });

    it('takes back the relations added for a source whose merge did not complete', async () => {
      const added = [{ id: newUuid(), source }];
      mocks.family.dropMergedFamilyPeople.mockResolvedValue([]);
      await sut.afterStockMerge(auth, target, { familyId, sourceIds: [source], added });
      expect(mocks.family.undoMergeRelations).toHaveBeenCalledWith(familyId, [added[0].id]);
    });

    it('keeps the added relations of a source that merged completely', async () => {
      const added = [{ id: newUuid(), source }];
      mocks.family.dropMergedFamilyPeople.mockResolvedValue([source]);
      await sut.afterStockMerge(auth, target, { familyId, sourceIds: [source], added });
      expect(mocks.family.undoMergeRelations).toHaveBeenCalledWith(familyId, []);
    });
  });
});
