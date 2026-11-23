import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Family members edit each other's photos through the stock asset endpoints; personal fields stay with the owner.

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const assets = newMediumService(AssetService, {
    database: defaultDatabase,
    real: [
      AssetRepository,
      AssetEditRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
      FamilyRepository,
      SharedLinkAssetRepository,
      StackRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository, OcrRepository, WebsocketRepository],
  });
  const family = newMediumService(FamilyService, {
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
  return { sut: assets.sut, ctx: assets.ctx, family: family.sut };
};

const newFamily = async ({ ctx, family }: ReturnType<typeof setup>) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const { user: member } = await ctx.newUser();
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  await family.create(adminAuth, {});
  await family.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
  const { asset } = await ctx.newAsset({ ownerId: admin.id });
  await ctx.newExif({ assetId: asset.id, description: '' });
  return { admin, member, asset };
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

describe('family photo edits', () => {
  it('lets a member add a caption to another member’s photo', async () => {
    const setupResult = setup();
    const { member, asset } = await newFamily(setupResult);
    setupResult.ctx.getMock(JobRepository).queue.mockResolvedValue();

    await setupResult.sut.update(factory.auth({ user: member }), asset.id, { description: 'Grandma at the beach' });

    const exif = await setupResult.ctx.database
      .selectFrom('asset_exif')
      .select('description')
      .where('assetId', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(exif.description).toBe('Grandma at the beach');
  });

  it('records the edit in the family history with the values before and after', async () => {
    const setupResult = setup();
    const { member, asset } = await newFamily(setupResult);
    setupResult.ctx.getMock(JobRepository).queue.mockResolvedValue();

    await setupResult.sut.update(factory.auth({ user: member }), asset.id, { description: 'Grandma at the beach' });

    const history = await setupResult.ctx.database
      .selectFrom('family_history')
      .selectAll()
      .where('action', '=', 'asset.update')
      .execute();
    expect(history).toEqual([
      expect.objectContaining({
        userId: member.id,
        entityType: 'asset',
        entityId: asset.id,
        before: { description: '' },
        after: { description: 'Grandma at the beach' },
      }),
    ]);
  });

  it.each([
    ['favourite', { isFavorite: true }],
    ['archive', { visibility: AssetVisibility.Archive }],
    ['rating', { rating: 5 }],
  ])('keeps the %s with the owner', async (_, dto) => {
    const setupResult = setup();
    const { member, asset } = await newFamily(setupResult);

    await expect(setupResult.sut.update(factory.auth({ user: member }), asset.id, dto)).rejects.toThrow(
      'Only the owner can change',
    );
    await expect(
      setupResult.sut.updateAll(factory.auth({ user: member }), { ids: [asset.id], ...dto }),
    ).rejects.toThrow('Only the owner can change');
  });

  it('still lets the owner favourite their own photo', async () => {
    const setupResult = setup();
    const { admin, asset } = await newFamily(setupResult);
    setupResult.ctx.getMock(WebsocketRepository).clientSend.mockReturnValue();

    await setupResult.sut.update(factory.auth({ user: admin }), asset.id, { isFavorite: true });

    const stored = await setupResult.ctx.database
      .selectFrom('asset')
      .select('isFavorite')
      .where('id', '=', asset.id)
      .executeTakeFirstOrThrow();
    expect(stored.isFavorite).toBe(true);
  });
});
