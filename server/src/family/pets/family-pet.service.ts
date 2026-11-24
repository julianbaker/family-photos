// family fork: pet recognition. Finds the family's dogs and cats in their photos and groups each
// animal into a person, so pets are named, merged and shown like people (internal/docs/pets-design.md).
import { Injectable } from '@nestjs/common';
import { Insertable } from 'kysely';
import { OnEvent } from 'src/decorators.js';
import { ImmichWorker, JobName, SourceType } from 'src/enum.js';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { PET_MODEL_VERSION, PetModels, type PetBox } from 'src/family/pets/pet-models.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { BaseService } from 'src/services/base.service.js';

const number = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && process.env[name] !== '' && process.env[name] !== undefined ? value : fallback;
};

/** Settings, from the environment (read on each use so tests can change them). */
export const petSettings = () => ({
  enabled: isFamilyEnabled() && process.env.IMMICH_FAMILY_PETS !== 'false',
  /** Where the two model files are (baked into the server image). */
  models: process.env.IMMICH_FAMILY_PET_MODELS || '/usr/src/app/sibred-models',
  /** How sure the detector must be that it's a dog or cat (0-1). */
  minScore: number('IMMICH_FAMILY_PET_MIN_SCORE', 0.5),
  /**
  Largest cosine distance between two photos of the same animal (0 = identical, 2 = opposite). 0.65 keeps
  different-looking pets apart (measured: different breeds never closer than 0.75, each photo of a dog
  within 0.67 of another photo of it); look-alikes of the same breed still group together.
  */
  maxDistance: number('IMMICH_FAMILY_PET_MAX_DISTANCE', 0.65),
  /** Photos an animal must be in before it becomes a pet of its own. */
  minPhotos: Math.max(1, Math.round(number('IMMICH_FAMILY_PET_MIN_PHOTOS', 3))),
});

/** Overlap of two boxes (intersection over union), each in its own image's pixels. */
export const overlap = (
  a: { x1: number; y1: number; x2: number; y2: number; width: number; height: number },
  b: { x1: number; y1: number; x2: number; y2: number; width: number; height: number },
) => {
  const n = (box: typeof a) => ({ x1: box.x1 / box.width, y1: box.y1 / box.height, x2: box.x2 / box.width, y2: box.y2 / box.height });
  const p = n(a);
  const q = n(b);
  const intersection = Math.max(0, Math.min(p.x2, q.x2) - Math.max(p.x1, q.x1)) * Math.max(0, Math.min(p.y2, q.y2) - Math.max(p.y1, q.y1));
  const union = (p.x2 - p.x1) * (p.y2 - p.y1) + (q.x2 - q.x1) * (q.y2 - q.y1) - intersection;
  return union > 0 ? intersection / union : 0;
};

const BATCH = 25;
const RECONCILE_DELAY_MS = 15_000;
const CATCH_UP_EVERY_MS = 6 * 60 * 60 * 1000;
const IDLE_RELEASE_MS = 10 * 60 * 1000;

@Injectable()
export class FamilyPetService extends BaseService {
  private models?: PetModels;
  /** Photos waiting to be scanned (new previews), handled one at a time. */
  private pending = new Set<string>();
  private running?: Promise<void>;
  private catchUpTimer?: NodeJS.Timeout;
  private reconcileTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private stopped = false;

  private getModels() {
    const settings = petSettings();
    this.models ??= new PetModels(settings.models);
    return this.models;
  }

  /** Starts the catch-up pass over the library, then repeats it every few hours for anything missed. */
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Microservices] })
  onBootstrap() {
    const settings = petSettings();
    if (!settings.enabled) {
      return;
    }
    if (!this.getModels().available()) {
      this.logger.warn(`Pet recognition is off: models not found in ${settings.models}`);
      return;
    }
    this.logger.log('Pet recognition is on');
    this.schedule();
    this.catchUpTimer = setInterval(() => this.schedule(), CATCH_UP_EVERY_MS);
  }

  @OnEvent({ name: 'AppShutdown' })
  onShutdown() {
    this.stopped = true;
    clearInterval(this.catchUpTimer);
    clearTimeout(this.reconcileTimer);
    clearTimeout(this.idleTimer);
  }

  /** A photo's preview was (re)made: look for pets in it. */
  @OnEvent({ name: 'JobSuccess', workers: [ImmichWorker.Microservices] })
  onJobSuccess({ job }: ArgOf<'JobSuccess'>) {
    if (job.name !== JobName.AssetGenerateThumbnails || !petSettings().enabled || !this.getModels().available()) {
      return;
    }
    this.pending.add(job.data.id);
    this.schedule();
  }

  /** Runs the work loop unless it's already running; it picks up anything added meanwhile. */
  private schedule() {
    if (this.running || this.stopped) {
      return;
    }
    clearTimeout(this.idleTimer);
    this.running = this.runOnce()
      .catch((error) => this.logger.error(`Pet recognition stopped: ${error}`, (error as Error)?.stack))
      .finally(() => {
        this.running = undefined;
        if (this.pending.size > 0) {
          // previews that arrived while this run was finishing: go again rather than wait hours
          this.schedule();
        } else {
          // the models take about a gigabyte; let them go when there's nothing to do
          this.idleTimer = setTimeout(() => void this.models?.release(), IDLE_RELEASE_MS);
        }
      });
  }

  /** Scans everything waiting, then groups what's left. Public so tests can run one pass. */
  async runOnce() {
    const family = await this.familyRepository.getAnyFamily();
    if (!family) {
      return;
    }
    // pets come only from photos the family shares: drop any on photos since locked, hidden or deleted
    const removed = await this.familyRepository.removePetFacesOnPrivatePhotos();
    if (removed > 0) {
      this.logger.log(`Removed ${removed} pet faces from photos the family no longer shares`);
    }
    let changed = removed > 0;
    // new previews first, then the library a batch at a time, until nothing is left
    for (;;) {
      if (this.stopped) {
        return;
      }
      let ids = [...this.pending];
      this.pending.clear();
      if (ids.length === 0) {
        const batch = await this.familyRepository.getAssetsForPetScan(family.id, PET_MODEL_VERSION, BATCH);
        ids = batch.map((asset) => asset.id);
      }
      if (ids.length === 0) {
        break;
      }
      for (const id of ids) {
        if (this.stopped) {
          return;
        }
        try {
          changed = (await this.scan(family.id, id)) || changed;
        } catch (error) {
          // one unreadable photo must not stop the rest; it's marked so the catch-up doesn't loop on it
          this.logger.warn(`Pet recognition could not read asset ${id}: ${error}`);
          await this.familyRepository.markPetScanned(id, PET_MODEL_VERSION);
        }
      }
    }
    // animals seen too few times to start a pet of their own may have enough company now
    changed = (await this.groupLeftovers(family.id)) || changed;
    if (changed) {
      this.reconcileSoon(family.id);
    }
  }

  /** Finds the pets in one photo; returns whether anything changed. */
  async scan(familyId: string, assetId: string): Promise<boolean> {
    const settings = petSettings();
    const asset = await this.familyRepository.getAssetForPetScan(familyId, assetId);
    if (!asset?.previewPath) {
      return false;
    }
    const { width, height, pets } = await this.getModels().detect(asset.previewPath, settings.minScore);
    const existingFaces = await this.familyRepository.getPetFaces(assetId);

    const keep = new Set<string>();
    const facesToAdd: (Insertable<AssetFaceTable> & { id: string; assetId: string })[] = [];
    const embeddings: { faceId: string; embedding: string }[] = [];
    const replaced: { faceId: string; embedding: string }[] = [];

    for (const pet of pets) {
      const embedding = JSON.stringify(await this.getModels().embed(asset.previewPath, pet.box));
      const box = { ...pet.box, width, height };
      // the same animal found again (a rescan): keep its face and whoever it was assigned to
      const same = existingFaces.find(
        (face) =>
          !keep.has(face.id) &&
          overlap(box, {
            x1: face.boundingBoxX1,
            y1: face.boundingBoxY1,
            x2: face.boundingBoxX2,
            y2: face.boundingBoxY2,
            width: face.imageWidth,
            height: face.imageHeight,
          }) > 0.5,
      );
      if (same) {
        keep.add(same.id);
        replaced.push({ faceId: same.id, embedding });
        continue;
      }
      const faceId = this.cryptoRepository.randomUUID();
      facesToAdd.push({ id: faceId, assetId, sourceType: SourceType.Pet, imageWidth: width, imageHeight: height, ...boxColumns(pet.box) });
      embeddings.push({ faceId, embedding });
    }
    const removed = existingFaces.filter((face) => !keep.has(face.id)).map((face) => face.id);

    if (facesToAdd.length > 0 || removed.length > 0 || embeddings.length > 0) {
      await this.personRepository.refreshFaces(facesToAdd, removed, embeddings);
    }
    for (const { faceId, embedding } of replaced) {
      await this.familyRepository.replaceFaceEmbedding(faceId, embedding);
    }
    await this.familyRepository.markPetScanned(assetId, PET_MODEL_VERSION);

    let grouped = false;
    for (const face of facesToAdd) {
      grouped = (await this.group(face.id)) || grouped;
    }
    if (facesToAdd.length > 0 || removed.length > 0) {
      this.logger.log(`Pets in asset ${assetId}: ${facesToAdd.length} new, ${keep.size} kept, ${removed.length} removed`);
    }
    return grouped || removed.length > 0;
  }

  /**
  Gives a pet face to a pet: the nearest pet face within the match distance that already belongs to
  one, else a new pet when enough photos of this animal exist. Like face recognition, but only among
  pet faces. Returns whether the face was assigned.
  */
  async group(faceId: string): Promise<boolean> {
    const { maxDistance, minPhotos } = petSettings();
    const face = await this.familyRepository.getPetFaceForGrouping(faceId);
    if (!face || face.personGroupId) {
      return false;
    }
    const search = { clusterGroupId: face.clusterGroupId, embedding: face.embedding, maxDistance, pets: true };
    const [nearestPet] = await this.searchRepository.searchFaces({ ...search, numResults: 1, hasPerson: true });
    let personGroupId = nearestPet?.personGroupId ?? null;

    if (!personGroupId) {
      // `similar` includes this face itself
      const similar = await this.searchRepository.searchFaces({ ...search, numResults: minPhotos });
      if (similar.length < minPhotos) {
        return false;
      }
      const group = await this.personRepository.createGroup(face.ownerId);
      personGroupId = group.id;
      this.logger.log(`New pet ${personGroupId}, first seen in face ${faceId}`);
    }

    const person = await this.personRepository.getByGroupId({ ownerId: face.ownerId, personGroupId });
    if (!person) {
      await this.personRepository.create({ ownerId: face.ownerId, faceAssetId: face.id, personGroupId });
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId: face.ownerId, personGroupId } });
    }
    await this.personRepository.reassignFaces({ faceIds: [faceId], newPersonGroupId: personGroupId });
    return true;
  }

  /** Tries the ungrouped pet faces again until a pass assigns nothing more. */
  private async groupLeftovers(familyId: string): Promise<boolean> {
    let any = false;
    for (;;) {
      const faces = await this.familyRepository.getUngroupedPetFaceIds(familyId);
      let assigned = false;
      for (const { id } of faces) {
        if (this.stopped) {
          return any;
        }
        assigned = (await this.group(id)) || assigned;
      }
      any ||= assigned;
      if (!assigned) {
        return any;
      }
    }
  }

  /** New pets become family people (shared with every member) shortly after, once per burst. */
  private reconcileSoon(familyId: string) {
    if (this.reconcileTimer) {
      return;
    }
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void BaseService.create(FamilyPeopleService, this)
        .reconcile(familyId)
        .catch((error) => this.logger.error(`Family people reconcile after pets failed: ${error}`));
    }, RECONCILE_DELAY_MS);
  }
}

const boxColumns = (box: PetBox) => ({
  boundingBoxX1: box.x1,
  boundingBoxY1: box.y1,
  boundingBoxX2: box.x2,
  boundingBoxY2: box.y2,
});
