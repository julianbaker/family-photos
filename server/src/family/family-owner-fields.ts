import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { FamilyHistoryAction } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';

/** Fields that stay personal to a photo's owner, even though other family members may edit the photo. */
const OWNER_ONLY_FIELDS = ['isFavorite', 'visibility', 'rating', 'livePhotoVideoId', 'duplicateId'] as const;

/** Fields recorded in the family history, so an edit can be reviewed and reverted. */
const HISTORY_FIELDS = [
  'description',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
  'rating',
  'isFavorite',
  'visibility',
  'duplicateId',
  'livePhotoVideoId',
] as const;

type AssetUpdateFields = Partial<Record<(typeof HISTORY_FIELDS)[number], unknown>>;

type Deps = { access: AccessRepository; family: FamilyRepository };

const pick = (source: Record<string, unknown>, fields: readonly string[]) =>
  Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));

/**
Runs before a photo update. Family members can edit each other's photos (dates, places, captions),
but favourites, archive, hidden/locked, ratings, Live Photo links and duplicate choices belong to
the owner, so changing those on someone else's photo is refused. Every edit by a family member is
recorded in the family history with the values before and after.
*/
export const familyBeforeAssetUpdate = async (
  { access, family }: Deps,
  auth: AuthDto,
  ids: string[],
  dto: AssetUpdateFields,
): Promise<void> => {
  if (!isFamilyEnabled() || ids.length === 0) {
    return;
  }

  const ownerOnly = OWNER_ONLY_FIELDS.filter((field) => dto[field] !== undefined);
  if (ownerOnly.length > 0) {
    const owned = await access.asset.checkOwnerAccess(auth.user.id, new Set(ids), auth.session?.hasElevatedPermission);
    if (ids.some((id) => !owned.has(id))) {
      throw new BadRequestException(`Only the owner can change ${ownerOnly.join(', ')}`);
    }
  }

  const membership = await family.getMembership(auth.user.id);
  const after = pick(dto, HISTORY_FIELDS);
  if (!membership || Object.keys(after).length === 0) {
    return;
  }

  const snapshots = await family.getAssetSnapshots(ids);
  await family.addHistoryMany(
    snapshots.map((snapshot) => ({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.AssetUpdate,
      entityType: 'asset',
      entityId: snapshot.id,
      before: pick(snapshot, Object.keys(after)),
      after,
    })),
  );
};

/**
Runs before photos are deleted. A family admin may trash another member's photo, but permanent deletion
skips the owner's trash and so can't be undone: it stays with the owner.
*/
export const familySplitAssetDelete = async (
  { access }: Pick<Deps, 'access'>,
  auth: AuthDto,
  ids: string[],
  force: boolean | undefined,
): Promise<{ forever: string[]; trash: string[] }> => {
  if (!force) {
    return { forever: [], trash: ids };
  }
  if (!isFamilyEnabled() || ids.length === 0) {
    return { forever: ids, trash: [] };
  }
  // only the owner deletes a photo for good; anyone else's permanent delete (an admin's) goes to the
  // owner's trash instead, so the owner can still restore it (owner decision 2026-11-25)
  const owned = await access.asset.checkOwnerAccess(auth.user.id, new Set(ids), auth.session?.hasElevatedPermission);
  return { forever: ids.filter((id) => owned.has(id)), trash: ids.filter((id) => !owned.has(id)) };
};

/**
Public sharing is off in a family archive (owner decision 2026-11-25): photos leave the family by being
downloaded, never through a public link. Refuses creating links or adding photos to one.
*/
export const familyRefuseSharedLinks = () => {
  if (isFamilyEnabled()) {
    throw new ForbiddenException('Public sharing is turned off. Download the photos to share them.');
  }
};
