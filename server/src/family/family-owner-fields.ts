import { BadRequestException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { AccessRepository } from 'src/repositories/access.repository.js';

/** Fields that stay personal to a photo's owner, even though other family members may edit the photo. */
const OWNER_ONLY_FIELDS = ['isFavorite', 'visibility', 'rating', 'livePhotoVideoId', 'duplicateId'] as const;

/**
Family members can edit each other's photos (dates, places, captions), but favourites, archive,
hidden/locked, ratings, Live Photo links and duplicate choices belong to the owner. Throws when the
request changes one of those on a photo the user doesn't own.
*/
export const requireOwnerForPersonalFields = async (
  access: AccessRepository,
  auth: AuthDto,
  ids: string[],
  dto: Partial<Record<(typeof OWNER_ONLY_FIELDS)[number], unknown>>,
): Promise<void> => {
  if (!isFamilyEnabled() || ids.length === 0) {
    return;
  }

  const changed = OWNER_ONLY_FIELDS.filter((field) => dto[field] !== undefined);
  if (changed.length === 0) {
    return;
  }

  const owned = await access.asset.checkOwnerAccess(auth.user.id, new Set(ids), auth.session?.hasElevatedPermission);
  if (ids.some((id) => !owned.has(id))) {
    throw new BadRequestException(`Only the owner can change ${changed.join(', ')}`);
  }
};
