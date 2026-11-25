import { Kysely } from 'kysely';
import { randomBytes } from 'node:crypto';
import { AssetVisibility, Permission, SharedLinkType, SyncRequestType } from 'src/enum.js';
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
import { checkAccess } from 'src/utils/access.js';
import { SyncTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

/**
The guarantees the family fork promises: members see everything, non-members see nothing, viewers
can't edit, members delete only their own uploads, shared links behave as in stock Immich, and a new
member receives the family library through the mobile sync stream.
*/

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const service = newMediumService(FamilyService, {
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
  const sync = new SyncTestContext(defaultDatabase);
  const access = service.ctx.get(AccessRepository);
  return { sut: service.sut, ctx: service.ctx, sync, access };
};

type Setup = ReturnType<typeof setup>;

/** Admin, member and viewer in one family, plus an outsider; each owns one photo. */
const newFamilyWithOutsider = async ({ sut, ctx }: Setup) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const { user: member } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: outsider } = await ctx.newUser();
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });

  await sut.create(adminAuth, {});
  await sut.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
  await sut.addMember(adminAuth, { userId: viewer.id, role: FamilyRole.Viewer });

  const { asset: adminAsset } = await ctx.newAsset({ ownerId: admin.id });
  const { asset: memberAsset } = await ctx.newAsset({ ownerId: member.id });
  const { asset: outsiderAsset } = await ctx.newAsset({ ownerId: outsider.id });

  return {
    admin: factory.auth({ user: admin }),
    member: factory.auth({ user: member }),
    viewer: factory.auth({ user: viewer }),
    outsider: factory.auth({ user: outsider }),
    adminAsset,
    memberAsset,
    outsiderAsset,
  };
};

const granted = async (
  access: AccessRepository,
  auth: ReturnType<typeof factory.auth>,
  permission: Permission,
  id: string,
) => {
  // editing and trashing other members' photos is opt-in per caller (familyGrant), as the asset service does
  const familyGrant = permission === Permission.AssetUpdate || permission === Permission.AssetDelete;
  const allowed = await checkAccess(access, { auth, permission, ids: [id], familyGrant });
  return allowed.has(id);
};

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

describe('family guarantees', () => {
  describe('member sees all', () => {
    it.each([Permission.AssetRead, Permission.AssetView, Permission.AssetDownload])(
      'grants %s on another member’s photo, for members and viewers',
      async (permission) => {
        const setupResult = setup();
        const family = await newFamilyWithOutsider(setupResult);
        expect(await granted(setupResult.access, family.member, permission, family.adminAsset.id)).toBe(true);
        expect(await granted(setupResult.access, family.viewer, permission, family.memberAsset.id)).toBe(true);
      },
    );

    it('includes every member in each other’s timeline', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      expect(await granted(setupResult.access, family.viewer, Permission.TimelineRead, family.admin.user.id)).toBe(
        true,
      );
    });
  });

  describe('non-member sees nothing', () => {
    it.each([Permission.AssetRead, Permission.AssetView, Permission.AssetDownload, Permission.AssetUpdate])(
      'denies %s on a family photo to an outsider',
      async (permission) => {
        const setupResult = setup();
        const family = await newFamilyWithOutsider(setupResult);
        expect(await granted(setupResult.access, family.outsider, permission, family.adminAsset.id)).toBe(false);
        expect(await granted(setupResult.access, family.outsider, permission, family.memberAsset.id)).toBe(false);
      },
    );

    it('keeps the outsider’s photos away from the family', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      expect(await granted(setupResult.access, family.admin, Permission.AssetRead, family.outsiderAsset.id)).toBe(
        false,
      );
      expect(await granted(setupResult.access, family.member, Permission.TimelineRead, family.outsider.user.id)).toBe(
        false,
      );
    });
  });

  describe('editing', () => {
    it('lets members and admins edit any family photo', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      expect(await granted(setupResult.access, family.member, Permission.AssetUpdate, family.adminAsset.id)).toBe(true);
      expect(await granted(setupResult.access, family.admin, Permission.AssetUpdate, family.memberAsset.id)).toBe(true);
    });

    it('never lets a viewer edit', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      for (const permission of [Permission.AssetUpdate, Permission.AssetDelete, Permission.AssetEditCreate]) {
        expect(await granted(setupResult.access, family.viewer, permission, family.adminAsset.id)).toBe(false);
      }
    });

    it('never grants a photo in its owner’s locked folder', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      const { asset: locked } = await setupResult.ctx.newAsset({
        ownerId: family.admin.user.id,
        visibility: AssetVisibility.Locked,
      });
      expect(await granted(setupResult.access, family.member, Permission.AssetUpdate, locked.id)).toBe(false);
    });

    it('lets members identify people on any family photo, but not viewers', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      const { assetFace } = await setupResult.ctx.newAssetFace({ assetId: family.adminAsset.id });
      expect(await granted(setupResult.access, family.member, Permission.FaceDelete, assetFace.id)).toBe(true);
      expect(await granted(setupResult.access, family.viewer, Permission.FaceDelete, assetFace.id)).toBe(false);
    });

    it('grants nothing extra while the feature is off', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      process.env.IMMICH_FAMILY_ENABLED = 'false';
      expect(await granted(setupResult.access, family.member, Permission.AssetUpdate, family.adminAsset.id)).toBe(
        false,
      );
    });
  });

  describe('deleting', () => {
    it('lets members delete only their own uploads', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      expect(await granted(setupResult.access, family.member, Permission.AssetDelete, family.memberAsset.id)).toBe(
        true,
      );
      expect(await granted(setupResult.access, family.member, Permission.AssetDelete, family.adminAsset.id)).toBe(
        false,
      );
    });

    it('lets admins delete any family photo', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      expect(await granted(setupResult.access, family.admin, Permission.AssetDelete, family.memberAsset.id)).toBe(true);
    });
  });

  describe('shared links unchanged', () => {
    it('grants only the linked photo, never the rest of the family library', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      const link = await setupResult.ctx.database
        .insertInto('shared_link')
        .values({
          userId: family.admin.user.id,
          key: randomBytes(16),
          type: SharedLinkType.Individual,
          allowUpload: false,
          albumId: null,
          expiresAt: null,
          description: null,
          password: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await setupResult.ctx.database
        .insertInto('shared_link_asset')
        .values({ sharedLinkId: link.id, assetId: family.adminAsset.id })
        .execute();
      const linkAuth = factory.auth({ sharedLink: { id: link.id, userId: family.admin.user.id } });

      expect(await granted(setupResult.access, linkAuth, Permission.AssetRead, family.adminAsset.id)).toBe(true);
      expect(await granted(setupResult.access, linkAuth, Permission.AssetRead, family.memberAsset.id)).toBe(false);
    });
  });

  describe('mobile sync', () => {
    it('streams the family library to a new member, including photos taken before they joined', async () => {
      const setupResult = setup();
      const { user: admin } = await setupResult.ctx.newUser({ isAdmin: true });
      const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
      await setupResult.sut.create(adminAuth, {});
      const { asset: oldPhoto } = await setupResult.ctx.newAsset({ ownerId: admin.id });

      const { auth: newMember } = await setupResult.sync.newSyncAuthUser();
      await setupResult.sut.addMember(adminAuth, { userId: newMember.user.id, role: FamilyRole.Member });

      const response = await setupResult.sync.syncStream(newMember, [SyncRequestType.PartnerAssetsV2]);
      expect(response).toEqual(
        expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ id: oldPhoto.id }) })]),
      );
    });

    it('streams nothing from the family to an outsider', async () => {
      const setupResult = setup();
      const family = await newFamilyWithOutsider(setupResult);
      const { auth: outsider } = await setupResult.sync.newSyncAuthUser();

      const response = await setupResult.sync.syncStream(outsider, [SyncRequestType.PartnerAssetsV2]);
      const ids = response.map((item) => (item as { data?: { id?: string } }).data?.id);
      expect(ids).not.toContain(family.adminAsset.id);
      expect(ids).not.toContain(family.memberAsset.id);
    });
  });
});
