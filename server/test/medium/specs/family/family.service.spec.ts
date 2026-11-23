import { Kysely } from 'kysely';
import { AlbumUserRole } from 'src/enum.js';
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
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = () =>
  newMediumService(FamilyService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      ClusterGroupRepository,
      FamilyRepository,
      PersonRepository,
      UserRepository,
    ],
    mock: [LoggingRepository, EventRepository],
  });

type Ctx = ReturnType<typeof setup>['ctx'];

const getUser = (ctx: Ctx, id: string) =>
  ctx.database.selectFrom('user').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const clusterOf = async (ctx: Ctx, id: string) => {
  const user = await getUser(ctx, id);
  return user.clusterGroupId;
};

const getPartners = (ctx: Ctx) =>
  ctx.database.selectFrom('partner').select(['sharedById', 'sharedWithId', 'inTimeline']).execute();

const getAlbumRole = async (ctx: Ctx, albumId: string, userId: string) => {
  const row = await ctx.database
    .selectFrom('album_user')
    .select('role')
    .where('albumId', '=', albumId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row?.role;
};

/** A family with an admin, created the way the API does it. */
const newFamily = async ({ sut, ctx }: ReturnType<typeof setup>) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  const family = await sut.create(adminAuth, { name: 'Bakers' });
  return { admin, adminAuth, family };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(async () => {
  process.env.IMMICH_FAMILY_ENABLED = 'true';
  // one family per server: each test starts without one
  await defaultDatabase.deleteFrom('family').execute();
  await defaultDatabase.deleteFrom('partner').execute();
});

afterAll(() => {
  delete process.env.IMMICH_FAMILY_ENABLED;
});

describe(FamilyService.name, () => {
  describe('create', () => {
    it('makes the admin the first family admin, in their own cluster group', async () => {
      const ctx = setup();
      const { admin, family } = await newFamily(ctx);

      expect(family).toEqual(
        expect.objectContaining({
          name: 'Bakers',
          role: FamilyRole.Admin,
          members: [expect.objectContaining({ userId: admin.id, role: FamilyRole.Admin })],
        }),
      );
      const stored = await ctx.ctx.database.selectFrom('family').selectAll().executeTakeFirstOrThrow();
      expect(stored.clusterGroupId).toBe(await clusterOf(ctx.ctx, admin.id));
    });

    it('rejects a user who is not a server admin', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await expect(sut.create(factory.auth({ user }), {})).rejects.toThrow('Only a server admin');
    });

    it('allows only one family per server', async () => {
      const ctx = setup();
      await newFamily(ctx);
      const { user: other } = await ctx.ctx.newUser({ isAdmin: true });
      await expect(ctx.sut.create(factory.auth({ user: { ...other, isAdmin: true } }), {})).rejects.toThrow(
        'A family already exists',
      );
    });

    it('is refused while the feature is off', async () => {
      process.env.IMMICH_FAMILY_ENABLED = 'false';
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser({ isAdmin: true });
      await expect(sut.create(factory.auth({ user: { ...user, isAdmin: true } }), {})).rejects.toThrow('not enabled');
    });
  });

  describe('addMember', () => {
    it('moves the user into the family cluster group and shares both ways', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { user: member } = await ctx.ctx.newUser();

      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      expect(await clusterOf(ctx.ctx, member.id)).toBe(await clusterOf(ctx.ctx, admin.id));
      expect(await getPartners(ctx.ctx)).toEqual(
        expect.arrayContaining([
          { sharedById: admin.id, sharedWithId: member.id, inTimeline: true },
          { sharedById: member.id, sharedWithId: admin.id, inTimeline: true },
        ]),
      );
    });

    it('adds the new member to existing albums, as a viewer when their role is viewer', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { album } = await ctx.ctx.newAlbum({ ownerId: admin.id });
      const { user: viewer } = await ctx.ctx.newUser();
      const { user: member } = await ctx.ctx.newUser();

      await ctx.sut.addMember(adminAuth, { userId: viewer.id, role: FamilyRole.Viewer });
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      expect(await getAlbumRole(ctx.ctx, album.id, viewer.id)).toBe(AlbumUserRole.Viewer);
      expect(await getAlbumRole(ctx.ctx, album.id, member.id)).toBe(AlbumUserRole.Editor);
      expect(await getAlbumRole(ctx.ctx, album.id, admin.id)).toBe(AlbumUserRole.Owner);
    });

    it('shares the new member’s own albums with the family', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { user: member } = await ctx.ctx.newUser();
      const { album } = await ctx.ctx.newAlbum({ ownerId: member.id });

      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      expect(await getAlbumRole(ctx.ctx, album.id, admin.id)).toBe(AlbumUserRole.Editor);
    });

    it('rejects a member who is not a family admin', async () => {
      const ctx = setup();
      const { adminAuth } = await newFamily(ctx);
      const { user: member } = await ctx.ctx.newUser();
      const { user: other } = await ctx.ctx.newUser();
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      await expect(
        ctx.sut.addMember(factory.auth({ user: member }), { userId: other.id, role: FamilyRole.Member }),
      ).rejects.toThrow('Only a family admin');
    });

    it('rejects a user who is already a member', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      await expect(ctx.sut.addMember(adminAuth, { userId: admin.id, role: FamilyRole.Member })).rejects.toThrow(
        'already in a family',
      );
    });
  });

  describe('updateMember', () => {
    it('downgrades album access when a member becomes a viewer', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { album } = await ctx.ctx.newAlbum({ ownerId: admin.id });
      const { user: member } = await ctx.ctx.newUser();
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      await ctx.sut.updateMember(adminAuth, member.id, { role: FamilyRole.Viewer });

      expect(await getAlbumRole(ctx.ctx, album.id, member.id)).toBe(AlbumUserRole.Viewer);
      expect(await getAlbumRole(ctx.ctx, album.id, admin.id)).toBe(AlbumUserRole.Owner);
    });

    it('keeps at least one admin', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      await expect(ctx.sut.updateMember(adminAuth, admin.id, { role: FamilyRole.Member })).rejects.toThrow(
        'at least one admin',
      );
    });
  });

  describe('removeMember', () => {
    it('stops sharing both ways and gives the user a cluster group of their own', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { album } = await ctx.ctx.newAlbum({ ownerId: admin.id });
      const { user: member } = await ctx.ctx.newUser();
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });

      await ctx.sut.removeMember(adminAuth, member.id);

      expect(await getPartners(ctx.ctx)).toEqual([]);
      expect(await getAlbumRole(ctx.ctx, album.id, member.id)).toBeUndefined();
      expect(await clusterOf(ctx.ctx, member.id)).not.toBe(await clusterOf(ctx.ctx, admin.id));
      await expect(ctx.sut.getMyFamily(factory.auth({ user: member }))).rejects.toThrow('not in a family');
    });

    it('keeps at least one admin', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      await expect(ctx.sut.removeMember(adminAuth, admin.id)).rejects.toThrow('at least one admin');
    });
  });

  describe('onAlbumCreate', () => {
    it('shares a new album with every other member', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { user: member } = await ctx.ctx.newUser();
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
      const { album } = await ctx.ctx.newAlbum({ ownerId: member.id });

      await ctx.sut.onAlbumCreate({ id: album.id, userId: member.id });

      expect(await getAlbumRole(ctx.ctx, album.id, admin.id)).toBe(AlbumUserRole.Editor);
    });
  });

  describe('history', () => {
    it('records who added and changed members', async () => {
      const ctx = setup();
      const { admin, adminAuth } = await newFamily(ctx);
      const { user: member } = await ctx.ctx.newUser();
      await ctx.sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
      await ctx.sut.updateMember(adminAuth, member.id, { role: FamilyRole.Viewer });

      const history = await ctx.sut.getHistory(adminAuth, { take: 10, skip: 0 });
      expect(history.map(({ action }) => action)).toEqual(['member.role.update', 'member.add', 'family.create']);
      expect(history[0]).toEqual(
        expect.objectContaining({
          userId: admin.id,
          entityId: member.id,
          before: { role: 'member' },
          after: { role: 'viewer' },
        }),
      );
    });
  });
});
