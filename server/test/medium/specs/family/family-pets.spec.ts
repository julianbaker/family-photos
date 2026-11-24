import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Kysely } from 'kysely';
import { AssetFileType, SourceType } from 'src/enum.js';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { FamilyPetService } from 'src/family/pets/family-pet.service.js';
import { PET_MODEL_FILES } from 'src/family/pets/pet-models.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newEmbedding } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Pet recognition: pets are faces with sourceType 'pet', grouped into people among themselves only.

let defaultDatabase: Kysely<DB>;

const real = [
  AccessRepository,
  AlbumRepository,
  AssetRepository,
  ClusterGroupRepository,
  CryptoRepository,
  FamilyRepository,
  PersonRepository,
  SearchRepository,
  UserRepository,
];

const setup = () => {
  const pets = newMediumService(FamilyPetService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository, JobRepository],
  });
  // new pets ask for their face thumbnail, made by the stock thumbnail job
  pets.ctx.getMock(JobRepository).queue.mockResolvedValue();
  const family = newMediumService(FamilyService, { database: defaultDatabase, real, mock: [LoggingRepository, EventRepository] });
  const people = newMediumService(FamilyPeopleService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository, JobRepository],
  });
  people.ctx.getMock(JobRepository).queue.mockResolvedValue();
  return { sut: pets.sut, ctx: pets.ctx, family: family.sut, people: people.sut };
};

type Setup = ReturnType<typeof setup>;

const newFamily = async ({ ctx, family }: Setup) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  const created = await family.create(adminAuth, {});
  const {clusterGroupId} = await ctx.database.selectFrom('user').select('clusterGroupId').where('id', '=', admin.id).executeTakeFirstOrThrow();
  return { admin, adminAuth, familyId: created.id, clusterGroupId };
};

const addFace = async (
  ctx: Setup['ctx'],
  assetId: string,
  sourceType: SourceType,
  embedding: string,
  personGroupId: string | null = null,
) => {
  const id = factory.uuid();
  await ctx.database.insertInto('asset_face').values({ id, assetId, sourceType, personGroupId }).execute();
  await ctx.database.insertInto('face_search').values({ faceId: id, embedding }).execute();
  return id;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(async () => {
  process.env.IMMICH_FAMILY_ENABLED = 'true';
  await defaultDatabase.deleteFrom('family').execute();
});

afterEach(() => {
  delete process.env.IMMICH_FAMILY_ENABLED;
  delete process.env.IMMICH_FAMILY_PET_MODELS;
  delete process.env.IMMICH_FAMILY_PET_MIN_PHOTOS;
});

describe('pet faces and human faces', () => {
  it('never match each other in face search, even with identical embeddings', async () => {
    const setupResult = setup();
    const { ctx } = setupResult;
    const { admin, clusterGroupId } = await newFamily(setupResult);
    const { asset } = await ctx.newAsset({ ownerId: admin.id });
    const embedding = newEmbedding();
    const human = await addFace(ctx, asset.id, SourceType.MachineLearning, embedding);
    const pet = await addFace(ctx, asset.id, SourceType.Pet, embedding);
    const search = ctx.get(SearchRepository);
    const options = { clusterGroupId, embedding, maxDistance: 0.5, numResults: 10 };

    const people = await search.searchFaces(options);
    const pets = await search.searchFaces({ ...options, pets: true });

    expect(people.map((face) => face.id)).toEqual([human]);
    expect(pets.map((face) => face.id)).toEqual([pet]);
  });
});

describe('pets in the family', () => {
  it('are reported as pets when their faces were found by pet recognition, and can be set by hand', async () => {
    const setupResult = setup();
    const { ctx, people } = setupResult;
    const { admin, adminAuth, familyId } = await newFamily(setupResult);
    const { asset } = await ctx.newAsset({ ownerId: admin.id });
    const { person: dog } = await ctx.newPerson({ ownerId: admin.id, name: 'Bo' });
    const { person: aunt } = await ctx.newPerson({ ownerId: admin.id, name: 'Ann' });
    await addFace(ctx, asset.id, SourceType.Pet, newEmbedding(), dog.personGroupId);
    await addFace(ctx, asset.id, SourceType.MachineLearning, newEmbedding(), aunt.personGroupId);
    await people.reconcile(familyId);

    const all = await people.getAll(adminAuth);
    expect(all.find((person) => person.id === dog.personGroupId)?.kind).toBe('pet');
    expect(all.find((person) => person.id === aunt.personGroupId)?.kind).toBe('person');

    // a dog with no photos yet, added by hand
    const sunny = await people.create(adminAuth, { name: 'Sunny', kind: 'pet' });
    expect(sunny.kind).toBe('pet');
    // and a correction: whatever the photos say, the family's word wins
    const corrected = await people.update(adminAuth, dog.personGroupId, { kind: 'person' });
    expect(corrected.kind).toBe('person');
  });
});

// The whole pipeline with the real models on real photos (US government photos of the Obamas' and the
// Bidens' dogs, public domain). Needs the models (server/Dockerfile downloads them; locally, put them in
// sibred-models/) and the photos: PET_TEST_PHOTOS=<folder of bo-NN.jpg, sunny-NN.jpg, champ-NN.jpg>.
const modelsFolder = resolve(import.meta.dirname, '../../../../../sibred-models');
const photosFolder = process.env.PET_TEST_PHOTOS;
const canRunModels =
  !!photosFolder &&
  existsSync(photosFolder) &&
  Object.values(PET_MODEL_FILES).every(({ file }) => existsSync(join(modelsFolder, file)));

describe.skipIf(!canRunModels)('pet recognition on real photos', () => {
  it('finds the dogs and never puts two different-looking dogs in the same pet', { timeout: 300_000 }, async () => {
    process.env.IMMICH_FAMILY_PET_MODELS = modelsFolder;
    const setupResult = setup();
    const { ctx, sut } = setupResult;
    const { admin } = await newFamily(setupResult);

    const photos = readdirSync(photosFolder!).filter((name) => /^(bo|sunny|champ)-\d+\.jpe?g$/.test(name));
    const dogOf = new Map<string, string>();
    for (const name of photos) {
      const { asset } = await ctx.newAsset({ ownerId: admin.id, originalFileName: name });
      await ctx.newAssetFile({ assetId: asset.id, type: AssetFileType.Preview, path: join(photosFolder!, name) });
      dogOf.set(asset.id, name.split('-', 1)[0]);
    }

    await sut.runOnce();

    const faces = await ctx.database
      .selectFrom('asset_face')
      .select(['assetId', 'personGroupId'])
      .where('sourceType', '=', SourceType.Pet)
      .execute();
    const photosWithPets = new Set(faces.map((face) => face.assetId));
    // the detector found a dog in nearly every photo (each shows one dog clearly)
    expect(photosWithPets.size).toBeGreaterThanOrEqual(Math.floor(photos.length * 0.9));
    expect(await ctx.database.selectFrom('family_pet_scan').select('assetId').execute()).toHaveLength(photos.length);

    // Champ (a German shepherd) never shares a pet with Bo or Sunny (black Portuguese water dogs);
    // Bo and Sunny look alike and may share one, which the family then splits.
    const groups = new Map<string, Set<string>>();
    for (const face of faces) {
      if (!face.personGroupId) {
        continue;
      }
      const dogs = groups.get(face.personGroupId!) ?? new Set();
      dogs.add(dogOf.get(face.assetId)!);
      groups.set(face.personGroupId!, dogs);
    }
    for (const dogs of groups.values()) {
      expect(dogs.has('champ') && (dogs.has('bo') || dogs.has('sunny'))).toBe(false);
    }
    // and Champ, in nine photos, became a pet
    const champFaces = faces.filter((face) => dogOf.get(face.assetId) === 'champ' && face.personGroupId);
    expect(champFaces.length).toBeGreaterThanOrEqual(3);

    // a rescan with the same models changes nothing: same faces, same pets
    await ctx.database.deleteFrom('family_pet_scan').execute();
    await sut.runOnce();
    const again = await ctx.database
      .selectFrom('asset_face')
      .select(['assetId', 'personGroupId'])
      .where('sourceType', '=', SourceType.Pet)
      .execute();
    expect(new Set(again.map((face) => `${face.assetId}:${face.personGroupId}`))).toEqual(
      new Set(faces.map((face) => `${face.assetId}:${face.personGroupId}`)),
    );
  });
});
