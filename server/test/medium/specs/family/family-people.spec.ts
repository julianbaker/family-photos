import { Kysely } from 'kysely';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { RelationQualifier, RelationType } from 'src/family/family-relations.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
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
    mock: [LoggingRepository, EventRepository],
  });
  const family = newMediumService(FamilyService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository],
  });
  const stockPeople = newMediumService(PersonService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository],
  });
  return { sut: people.sut, ctx: people.ctx, family: family.sut, stockPeople: stockPeople.sut };
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

    it('lets members comment and authors or admins delete, but not viewers comment', async () => {
      const setupResult = setup();
      const { admin, memberAuth, viewerAuth, adminAuth } = await newFamily(setupResult);
      const { asset } = await setupResult.ctx.newAsset({ ownerId: admin.id });

      const comment = await setupResult.sut.createComment(memberAuth, asset.id, { text: 'Look at that hat!' });
      await expect(setupResult.sut.createComment(viewerAuth, asset.id, { text: 'Hi' })).rejects.toThrow(
        'Viewers can look',
      );
      const asViewer = await setupResult.sut.getComments(viewerAuth, asset.id);
      expect(asViewer).toEqual([expect.objectContaining({ text: 'Look at that hat!', canDelete: false })]);

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
