import { Kysely } from 'kysely';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { AssetVisibility, JobName, SourceType } from 'src/enum.js';
import { RelationQualifier, RelationType } from 'src/family/family-relations.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { PersonService } from 'src/services/person.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const real = [
  AccessRepository,
  AlbumRepository,
  ClusterGroupRepository,
  FamilyRepository,
  PersonRepository,
  UserRepository,
];

const setup = () => {
  const people = newMediumService(FamilyPeopleService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository, JobRepository],
  });
  // a person given a cover face asks for its picture, made by the stock thumbnail job
  people.ctx.getMock(JobRepository).queue.mockResolvedValue();
  const family = newMediumService(FamilyService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository],
  });
  const stockPeople = newMediumService(PersonService, {
    database: defaultDatabase,
    real,
    // merging deletes the merged people's face thumbnails, and asks for new ones
    mock: [LoggingRepository, EventRepository, StorageRepository, JobRepository],
  });
  stockPeople.ctx.getMock(StorageRepository).unlink.mockResolvedValue();
  stockPeople.ctx.getMock(JobRepository).queue.mockResolvedValue();
  return {
    sut: people.sut,
    ctx: people.ctx,
    family: family.sut,
    stockPeople: stockPeople.sut,
    stockJobs: stockPeople.ctx.getMock(JobRepository),
  };
};

type Setup = ReturnType<typeof setup>;

const newFamily = async ({ ctx, family }: Setup) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const { user: member } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  await family.create(adminAuth, {});
  // the admin had already named someone before anyone joined
  const { person: amy } = await ctx.newPerson({ ownerId: admin.id, name: 'Amy', birthDate: new Date('1960-02-20') });
  await family.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
  await family.addMember(adminAuth, { userId: viewer.id, role: FamilyRole.Viewer });
  return {
    admin,
    member,
    adminAuth,
    memberAuth: factory.auth({ user: member }),
    viewerAuth: factory.auth({ user: viewer }),
    amyId: amy.personGroupId,
  };
};

const familyPeopleCount = (ctx: Setup['ctx']) =>
  ctx.database.selectFrom('family_person').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();

const getName = async (ctx: Setup['ctx'], ownerId: string, personGroupId: string) => {
  const row = await getPersonRow(ctx, ownerId, personGroupId);
  return row?.name;
};

const getPersonRow = (ctx: Setup['ctx'], ownerId: string, personGroupId: string) =>
  ctx.database
    .selectFrom('person')
    .select(['name', 'birthDate'])
    .where('ownerId', '=', ownerId)
    .where('personGroupId', '=', personGroupId)
    .executeTakeFirst();

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(async () => {
  process.env.IMMICH_FAMILY_ENABLED = 'true';
  await defaultDatabase.deleteFrom('family').execute();
  await defaultDatabase.deleteFrom('partner').execute();
});

afterAll(() => {
  delete process.env.IMMICH_FAMILY_ENABLED;
});

describe(FamilyPeopleService.name, () => {
  describe('shared names', () => {
    it('gives a new member the names the family already has', async () => {
      const setupResult = setup();
      const { member, amyId } = await newFamily(setupResult);

      const row = await getPersonRow(setupResult.ctx, member.id, amyId);
      expect(row?.name).toBe('Amy');
    });

    it('shares a name changed through the stock people screen with everyone', async () => {
      const setupResult = setup();
      const { admin, memberAuth, amyId } = await newFamily(setupResult);

      await setupResult.stockPeople.update(memberAuth, amyId, { name: 'Amy Baker' });

      expect(await getName(setupResult.ctx, admin.id, amyId)).toBe('Amy Baker');
      const [amy] = await setupResult.sut.getAll(memberAuth);
      expect(amy.name).toBe('Amy Baker');
      const history = await setupResult.ctx.database
        .selectFrom('family_history')
        .selectAll()
        .where('action', '=', 'person.update')
        .execute();
      expect(history).toEqual([
        expect.objectContaining({
          entityId: amyId,
          before: expect.objectContaining({ name: 'Amy' }),
          after: { name: 'Amy Baker' },
        }),
      ]);
    });
  });

  describe('people without photos', () => {
    it('adds an ancestor every member can see', async () => {
      const setupResult = setup();
      const { member, memberAuth, adminAuth } = await newFamily(setupResult);

      const ancestor = await setupResult.sut.create(memberAuth, {
        name: 'Great-grandma Rose',
        birthDate: '1901-05-04',
        deathDate: '1980-01-01',
        gender: 'female',
        bio: 'Grew up on a **farm**. [Census record](https://example.org/census)',
      });

      expect(ancestor).toEqual(expect.objectContaining({ faceCount: 0, deathDate: '1980-01-01', gender: 'female' }));
      expect(await getName(setupResult.ctx, member.id, ancestor.id)).toBe('Great-grandma Rose');
      const adminView = await setupResult.sut.getAll(adminAuth);
      expect(adminView.map(({ name }) => name)).toContain('Great-grandma Rose');
    });

    it('refuses a death date before the birth date', async () => {
      const setupResult = setup();
      const { memberAuth, amyId } = await newFamily(setupResult);
      await expect(setupResult.sut.update(memberAuth, amyId, { deathDate: '1950-01-01' })).rejects.toThrow(
        'before the birth date',
      );
    });

    it('lets viewers look but not change anything', async () => {
      const setupResult = setup();
      const { viewerAuth, amyId } = await newFamily(setupResult);
      await expect(setupResult.sut.getAll(viewerAuth)).resolves.toHaveLength(1);
      await expect(setupResult.sut.update(viewerAuth, amyId, { bio: 'hello' })).rejects.toThrow('Viewers can look');
      await expect(setupResult.sut.create(viewerAuth, { name: 'Someone' })).rejects.toThrow('Viewers can look');
    });
  });

  describe('this is me', () => {
    it('lets a member link themselves, but only an admin link someone else', async () => {
      const setupResult = setup();
      const { member, admin, memberAuth, adminAuth, amyId } = await newFamily(setupResult);
      const other = await setupResult.sut.create(memberAuth, { name: 'Someone else' });

      await expect(setupResult.sut.update(memberAuth, amyId, { linkedUserId: admin.id })).rejects.toThrow(
        'only link yourself',
      );
      await expect(setupResult.sut.update(memberAuth, amyId, { linkedUserId: member.id })).resolves.toEqual(
        expect.objectContaining({ linkedUserId: member.id }),
      );
      await expect(setupResult.sut.update(adminAuth, other.id, { linkedUserId: member.id })).rejects.toThrow(
        'already linked',
      );
    });
  });

  describe('relations', () => {
    it('records a parent and works out the relationship to the viewer', async () => {
      const setupResult = setup();
      const { member, memberAuth, adminAuth, amyId } = await newFamily(setupResult);
      const kid = await setupResult.sut.create(memberAuth, { name: 'Kid', gender: 'male' });
      const grandkid = await setupResult.sut.create(memberAuth, { name: 'Grandkid', gender: 'female' });
      await setupResult.sut.update(memberAuth, grandkid.id, { linkedUserId: member.id });

      await setupResult.sut.createRelation(memberAuth, {
        personId: amyId,
        relatedPersonId: kid.id,
        type: RelationType.Parent,
      });
      await setupResult.sut.createRelation(adminAuth, {
        personId: kid.id,
        relatedPersonId: grandkid.id,
        type: RelationType.Parent,
      });

      const amy = await setupResult.sut.get(memberAuth, amyId);
      expect(amy.relationToMe).toEqual({ key: 'grandparent', label: 'grandparent' });

      const children = await setupResult.sut.getRelatives(memberAuth, amyId, { keys: 'child' });
      expect(children).toEqual([expect.objectContaining({ personId: kid.id, name: 'Kid', label: 'son' })]);
    });

    it('refuses a cycle and a duplicate', async () => {
      const setupResult = setup();
      const { memberAuth, amyId } = await newFamily(setupResult);
      const kid = await setupResult.sut.create(memberAuth, { name: 'Kid' });
      await setupResult.sut.createRelation(memberAuth, {
        personId: amyId,
        relatedPersonId: kid.id,
        type: RelationType.Parent,
      });

      await expect(
        setupResult.sut.createRelation(memberAuth, {
          personId: kid.id,
          relatedPersonId: amyId,
          type: RelationType.Parent,
        }),
      ).rejects.toThrow('own ancestor');
      await expect(
        setupResult.sut.createRelation(memberAuth, {
          personId: amyId,
          relatedPersonId: kid.id,
          type: RelationType.Parent,
        }),
      ).rejects.toThrow('already recorded');
    });

    it('stores spouses once, whichever way round they are added', async () => {
      const setupResult = setup();
      const { memberAuth, amyId } = await newFamily(setupResult);
      const husband = await setupResult.sut.create(memberAuth, { name: 'Husband' });

      await setupResult.sut.createRelation(memberAuth, {
        personId: husband.id,
        relatedPersonId: amyId,
        type: RelationType.Spouse,
        qualifier: RelationQualifier.Former,
      });
      await expect(
        setupResult.sut.createRelation(memberAuth, {
          personId: amyId,
          relatedPersonId: husband.id,
          type: RelationType.Spouse,
        }),
      ).rejects.toThrow('already recorded');

      const relations = await setupResult.sut.getRelations(memberAuth);
      expect(relations).toHaveLength(1);
      const [relation] = relations;
      await setupResult.sut.deleteRelation(memberAuth, relation.id);
      expect(await setupResult.sut.getRelations(memberAuth)).toEqual([]);
    });
  });

  describe('nightly cleanup', () => {
    it('keeps family people without photos, and their relations, but still removes stray people', async () => {
      const setupResult = setup();
      const { ctx, sut, stockPeople } = setupResult;
      const { admin, memberAuth, amyId } = await newFamily(setupResult);
      const ancestor = await sut.create(memberAuth, { name: 'Great-grandma Ada' });
      await sut.createRelation(memberAuth, {
        personId: ancestor.id,
        relatedPersonId: amyId,
        type: RelationType.Parent,
      });
      // a person outside the family's records, with no faces: the stock cleanup should still remove it
      const { person: stray } = await ctx.newPerson({ ownerId: admin.id, name: '' });
      await ctx.database.deleteFrom('family_person').where('personGroupId', '=', stray.personGroupId).execute();

      await stockPeople.handlePersonCleanup();

      const everyone = await sut.getAll(memberAuth);
      const names = everyone.map((person) => person.name);
      expect(names).toEqual(expect.arrayContaining(['Amy', 'Great-grandma Ada']));
      expect(await sut.getRelations(memberAuth)).toHaveLength(1);
      const strayRows = await ctx.database
        .selectFrom('person')
        .select('ownerId')
        .where('personGroupId', '=', stray.personGroupId)
        .execute();
      expect(strayRows).toEqual([]);
    });
  });

  describe('face thumbnails', () => {
    it('shows a member the face from another member’s copy of the person', async () => {
      const setupResult = setup();
      const { ctx, stockPeople } = setupResult;
      const { admin, memberAuth, amyId } = await newFamily(setupResult);
      // the picture is a crop of Amy's face in a photo the family can see
      const { asset } = await ctx.newAsset({ ownerId: admin.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: amyId });
      await ctx.database
        .updateTable('person')
        .set({ thumbnailPath: '/thumbs/amy.jpeg', faceAssetId: assetFace.id })
        .where('ownerId', '=', admin.id)
        .where('personGroupId', '=', amyId)
        .execute();

      const file = await stockPeople.getThumbnail(memberAuth, amyId);

      expect(file.path).toBe('/thumbs/amy.jpeg');
    });
  });

  describe('dates known only in part', () => {
    it('keeps a year or a month as given, and gives the stock records only exact dates', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { admin, memberAuth } = await newFamily(setupResult);

      const great = await sut.create(memberAuth, { name: 'Great Gran', birthDate: '1880', deathDate: '1951-03' });
      expect(great).toEqual(expect.objectContaining({ birthDate: '1880', deathDate: '1951-03' }));
      // the stock person record has no idea of "just the year": it gets no birth date
      const stock = await ctx.database
        .selectFrom('person')
        .select('birthDate')
        .where('personGroupId', '=', great.id)
        .where('ownerId', '=', admin.id)
        .executeTakeFirst();
      expect(stock?.birthDate ?? null).toBeNull();

      const exact = await sut.update(memberAuth, great.id, { birthDate: '1880-06-02' });
      expect(exact.birthDate).toBe('1880-06-02');
      const back = await sut.update(memberAuth, great.id, { birthDate: '1880-06' });
      expect(back.birthDate).toBe('1880-06');

      await expect(sut.update(memberAuth, great.id, { birthDate: '1880-02-30' })).rejects.toThrow('real date');
      // died "March 1951" and born 14 March 1951 is possible (service and database agree)
      const baby = await sut.create(memberAuth, { name: 'Baby', birthDate: '1951-03-14', deathDate: '1951-03' });
      expect(baby.deathDate).toBe('1951-03');
      await expect(sut.update(memberAuth, great.id, { deathDate: '1870' })).rejects.toThrow('before the birth');
    });
  });

  describe('key photo', () => {
    it('sets the same picture for every member, from a photo the person is in', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { admin, member, memberAuth, amyId } = await newFamily(setupResult);
      const { asset: first } = await ctx.newAsset({ ownerId: admin.id });
      const { asset: second } = await ctx.newAsset({ ownerId: member.id });
      const { asset: elsewhere } = await ctx.newAsset({ ownerId: admin.id });
      await ctx.newAssetFace({ assetId: first.id, personGroupId: amyId });
      const { assetFace: chosen } = await ctx.newAssetFace({ assetId: second.id, personGroupId: amyId });
      const before = await sut.get(memberAuth, amyId);

      const after = await sut.setCover(memberAuth, amyId, { assetId: second.id });

      const covers = await ctx.database
        .selectFrom('person')
        .select(['ownerId', 'faceAssetId'])
        .where('personGroupId', '=', amyId)
        .execute();
      expect(covers.length).toBeGreaterThanOrEqual(2);
      expect(covers.every((cover) => cover.faceAssetId === chosen.id)).toBe(true);
      expect(ctx.getMock(JobRepository).queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: member.id, personGroupId: amyId },
      });
      // the apps see a new version and drop their cached picture
      expect(after.updatedAt).not.toBe(before.updatedAt);
      // a photo she isn't in can't be her picture
      await expect(sut.setCover(memberAuth, amyId, { assetId: elsewhere.id })).rejects.toThrow('not recognised');
    });
  });

  describe('adding a relative', () => {
    it('adds a new father as a male parent, and the other parent as his partner when asked', async () => {
      const setupResult = setup();
      const { sut } = setupResult;
      const { memberAuth } = await newFamily(setupResult);
      const kid = await sut.create(memberAuth, { name: 'Kid' });
      const mum = await sut.addRelative(memberAuth, kid.id, { kind: 'mother', newName: 'Mum' });

      const dad = await sut.addRelative(memberAuth, kid.id, { kind: 'father', newName: 'Dad', alsoWith: mum.personId });

      const created = await sut.get(memberAuth, dad.personId);
      expect(created.gender).toBe('male');
      expect(dad.relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ personId: dad.personId, relatedPersonId: kid.id, type: RelationType.Parent }),
          expect.objectContaining({ type: RelationType.Spouse }),
        ]),
      );
    });

    it('refuses a third owner for a pet without leaving a new person behind', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { memberAuth } = await newFamily(setupResult);
      const alice = await sut.create(memberAuth, { name: 'Alice' });
      const bob = await sut.create(memberAuth, { name: 'Bob' });
      const rex = await sut.addRelative(memberAuth, alice.id, { kind: 'pet', newName: 'Rex' });
      const pet = await sut.get(memberAuth, rex.personId);
      expect(pet.kind).toBe('pet');
      await sut.addRelative(memberAuth, rex.personId, { kind: 'owner', existingId: bob.id });
      const before = await familyPeopleCount(ctx);

      await expect(sut.addRelative(memberAuth, rex.personId, { kind: 'owner', newName: 'Carol' })).rejects.toThrow(
        'two companions',
      );
      expect(await familyPeopleCount(ctx)).toEqual(before);
    });

    it('writes nothing when the companion relation is refused', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { memberAuth } = await newFamily(setupResult);
      const gran = await sut.create(memberAuth, { name: 'Gran' });
      const kid = await sut.addRelative(memberAuth, gran.id, { kind: 'child', newName: 'Kid' });
      const relationsBefore = await sut.getRelations(memberAuth);
      const peopleBefore = await familyPeopleCount(ctx);

      // a new parent of Gran recorded as the partner of Gran's own child: an ancestor can't be a partner
      await expect(
        sut.addRelative(memberAuth, gran.id, { kind: 'parent', newName: 'Great Gran', alsoWith: kid.personId }),
      ).rejects.toThrow();
      expect(await sut.getRelations(memberAuth)).toEqual(relationsBefore);
      expect(await familyPeopleCount(ctx)).toEqual(peopleBefore);
    });

    it("keeps people's and pets' relatives apart", async () => {
      const setupResult = setup();
      const { sut } = setupResult;
      const { memberAuth } = await newFamily(setupResult);
      const alice = await sut.create(memberAuth, { name: 'Alice' });
      const rex = await sut.create(memberAuth, { name: 'Rex', kind: 'pet' });
      await expect(sut.addRelative(memberAuth, alice.id, { kind: 'owner', existingId: rex.id })).rejects.toThrow(
        'Only a pet has companions',
      );
      await expect(sut.addRelative(memberAuth, rex.id, { kind: 'sibling', newName: 'Spot' })).rejects.toThrow('companions');
    });
  });

  describe('pictures the family may see', () => {
    it('never uses a Locked photo for a key photo, and replaces a cover whose photo was locked', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { admin, memberAuth, amyId } = await newFamily(setupResult);
      const { asset: shared } = await ctx.newAsset({ ownerId: admin.id });
      const { asset: locked } = await ctx.newAsset({ ownerId: admin.id, visibility: AssetVisibility.Locked });
      const { assetFace: sharedFace } = await ctx.newAssetFace({ assetId: shared.id, personGroupId: amyId });
      const { assetFace: lockedFace } = await ctx.newAssetFace({ assetId: locked.id, personGroupId: amyId });

      await expect(sut.setCover(memberAuth, amyId, { assetId: locked.id })).rejects.toThrow('can see');

      // a cover set before the photo went into a Locked folder
      await ctx.database.updateTable('person').set({ faceAssetId: lockedFace.id }).where('personGroupId', '=', amyId).execute();
      const family = await ctx.database.selectFrom('family').select('id').executeTakeFirstOrThrow();
      await sut.repairCovers(family.id);

      const covers = await ctx.database.selectFrom('person').select('faceAssetId').where('personGroupId', '=', amyId).execute();
      expect(covers.every((cover) => cover.faceAssetId === sharedFace.id)).toBe(true);
    });

    it('treats someone as a pet only when all their faces were found by pet recognition', async () => {
      const setupResult = setup();
      const { ctx, sut } = setupResult;
      const { admin, memberAuth, amyId } = await newFamily(setupResult);
      const { asset } = await ctx.newAsset({ ownerId: admin.id });
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: amyId, sourceType: SourceType.MachineLearning });
      // a dog's box assigned to Amy by mistake
      await ctx.newAssetFace({ assetId: asset.id, personGroupId: amyId, sourceType: SourceType.Pet });
      const amy = await sut.get(memberAuth, amyId);
      expect(amy.kind).toBe('person');
    });
  });

  describe('merging', () => {
    it('merges every member’s copy, and keeps details, relations and faces', async () => {
      const setupResult = setup();
      const { ctx, sut, stockPeople, stockJobs } = setupResult;
      const { admin, member, adminAuth, memberAuth, amyId } = await newFamily(setupResult);
      // the same woman, found twice by face recognition and named by a member
      const twin = await sut.create(memberAuth, { name: 'Amy B', bio: 'Loved the sea.', deathDate: '2020-01-01' });
      const kid = await sut.create(memberAuth, { name: 'Kid' });
      const husband = await sut.create(memberAuth, { name: 'Husband' });
      await sut.createRelation(memberAuth, { personId: amyId, relatedPersonId: kid.id, type: RelationType.Parent });
      await sut.createRelation(memberAuth, { personId: twin.id, relatedPersonId: kid.id, type: RelationType.Parent });
      await sut.createRelation(memberAuth, {
        personId: husband.id,
        relatedPersonId: twin.id,
        type: RelationType.Spouse,
      });
      await sut.createRelation(memberAuth, { personId: amyId, relatedPersonId: twin.id, type: RelationType.Sibling });
      const { asset: adminPhoto } = await ctx.newAsset({ ownerId: admin.id });
      const { asset: memberPhoto } = await ctx.newAsset({ ownerId: member.id });
      await ctx.newAssetFace({ assetId: adminPhoto.id, personGroupId: twin.id });
      await ctx.newAssetFace({ assetId: memberPhoto.id, personGroupId: twin.id });

      const results = await stockPeople.mergePeople(adminAuth, { ids: [amyId, twin.id] });

      expect(results).toEqual([
        { id: amyId, success: true },
        { id: twin.id, success: true },
      ]);
      // one person for everyone, not just for the admin
      const everyone = await sut.getAll(memberAuth);
      const names = everyone.map((person) => person.name).sort();
      expect(names).toEqual(['Amy', 'Husband', 'Kid']);
      const leftovers = await ctx.database
        .selectFrom('person')
        .select('ownerId')
        .where('personGroupId', '=', twin.id)
        .execute();
      expect(leftovers).toEqual([]);
      // the kept person's details win; the merged one fills the gaps
      const amy = await sut.get(memberAuth, amyId);
      expect(amy).toEqual(
        expect.objectContaining({
          name: 'Amy',
          birthDate: '1960-02-20',
          deathDate: '2020-01-01',
          bio: 'Loved the sea.',
        }),
      );
      // relations move across; the duplicate parent link and the sibling link to herself go
      const relations = await sut.getRelations(memberAuth);
      expect(relations).toHaveLength(2);
      expect(relations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ personId: amyId, relatedPersonId: kid.id, type: RelationType.Parent }),
          expect.objectContaining({ type: RelationType.Spouse }),
        ]),
      );
      const spouse = relations.find((relation) => relation.type === RelationType.Spouse)!;
      expect([spouse.personId, spouse.relatedPersonId].sort()).toEqual([amyId, husband.id].sort());
      // every member's faces now belong to the kept person
      const faces = await ctx.database
        .selectFrom('asset_face')
        .select('personGroupId')
        .where('assetId', 'in', [adminPhoto.id, memberPhoto.id])
        .execute();
      expect(faces).toEqual([{ personGroupId: amyId }, { personGroupId: amyId }]);
      // Amy had no photos before, so she had no cover face: she gets one from the merged photos, and
      // her picture is made (an accidental photo-less duplicate kept by a merge still shows a face)
      const covers = await ctx.database
        .selectFrom('person')
        .select(['ownerId', 'faceAssetId'])
        .where('personGroupId', '=', amyId)
        .execute();
      const mergedFaces = await ctx.database.selectFrom('asset_face').select('id').where('personGroupId', '=', amyId).execute();
      const mergedFaceIds = mergedFaces.map((face) => face.id);
      expect(covers.length).toBeGreaterThan(0);
      for (const cover of covers) {
        expect(mergedFaceIds).toContain(cover.faceAssetId);
      }
      expect(stockJobs.queue).toHaveBeenCalledWith({
        name: JobName.PersonGenerateThumbnail,
        data: { ownerId: admin.id, personGroupId: amyId },
      });
      const history = await ctx.database
        .selectFrom('family_history')
        .selectAll()
        .where('action', '=', 'person.merge')
        .execute();
      expect(history).toEqual([expect.objectContaining({ entityId: amyId })]);
    });
  });

  describe('photos', () => {
    it('gives each person’s age when the photo was taken', async () => {
      const setupResult = setup();
      const { admin, memberAuth, amyId } = await newFamily(setupResult);
      const { asset } = await setupResult.ctx.newAsset({
        ownerId: admin.id,
        localDateTime: new Date('1985-07-04T12:00:00.000Z'),
      });
      await setupResult.ctx.newAssetFace({ assetId: asset.id, personGroupId: amyId });

      const people = await setupResult.sut.getAssetPeople(memberAuth, asset.id);
      expect(people).toEqual([expect.objectContaining({ personId: amyId, name: 'Amy', age: 25 })]);
    });

    it('lets everyone comment, viewers included, and authors or admins delete', async () => {
      const setupResult = setup();
      const { admin, memberAuth, viewerAuth, adminAuth } = await newFamily(setupResult);
      const { asset } = await setupResult.ctx.newAsset({ ownerId: admin.id });

      const comment = await setupResult.sut.createComment(memberAuth, asset.id, { text: 'Look at that hat!' });
      const viewerComment = await setupResult.sut.createComment(viewerAuth, asset.id, { text: 'Hi' });
      const asViewer = await setupResult.sut.getComments(viewerAuth, asset.id);
      expect(asViewer).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: 'Look at that hat!', canDelete: false }),
          expect.objectContaining({ text: 'Hi', canDelete: true }),
        ]),
      );
      await setupResult.sut.deleteComment(viewerAuth, viewerComment.id);

      await expect(setupResult.sut.deleteComment(viewerAuth, comment.id)).rejects.toThrow('Only the author');
      await setupResult.sut.deleteComment(adminAuth, comment.id);
      expect(await setupResult.sut.getComments(memberAuth, asset.id)).toEqual([]);
    });

    it('refuses photos outside the family', async () => {
      const setupResult = setup();
      const { memberAuth } = await newFamily(setupResult);
      const { user: outsider } = await setupResult.ctx.newUser();
      const { asset } = await setupResult.ctx.newAsset({ ownerId: outsider.id });

      await expect(setupResult.sut.getComments(memberAuth, asset.id)).rejects.toThrow('not found in the family');
    });
  });
});
