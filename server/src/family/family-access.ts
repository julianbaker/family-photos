import { Kysely } from 'kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetVisibility } from 'src/enum.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { DB } from 'src/schema/index.js';

const EDIT_ROLES = [FamilyRole.Admin, FamilyRole.Member];
const TRASH_OTHERS_ROLES = [FamilyRole.Admin];
const ALL_ROLES = [FamilyRole.Admin, FamilyRole.Member, FamilyRole.Viewer];

/**
The one definition of a photo the family shares: in the owner's timeline or archive, and not trashed.
Locked and hidden photos are the owner's alone, whoever asks for them by id. Reads, downloads, edits,
comments, faces and cached face crops all use this.
*/
export const FAMILY_VISIBILITIES = [AssetVisibility.Timeline, AssetVisibility.Archive];

/**
Access checks that let family members act on each other's photos. Stock checks grant the owner;
these grant other members of the owner's family, by role, and only for photos the family shares
(FAMILY_VISIBILITIES). The stock partner check misses archived photos, so reads are granted here too.
*/
export class FamilyAccess {
  constructor(private db: Kysely<DB>) {}

  /** True when the user is a Viewer in a family: viewers see and download everything and change nothing. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async isViewer(userId: string): Promise<boolean> {
    if (!isFamilyEnabled()) {
      return false;
    }
    const row = await this.db
      .selectFrom('family_member')
      .select('family_member.userId')
      .where('family_member.userId', '=', userId)
      .where('family_member.role', '=', FamilyRole.Viewer)
      .executeTakeFirst();
    return !!row;
  }

  /** Reading, viewing and downloading the family's photos: every member, whatever their role. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  checkAssetReadAccess(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    return this.checkAssetAccess(userId, assetIds, ALL_ROLES);
  }

  /** Metadata edits (dates, places, captions) on other members' photos: admins and members. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  checkAssetEditAccess(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    return this.checkAssetAccess(userId, assetIds, EDIT_ROLES);
  }

  /**
  Trashing other members' photos (into their owner's trash): admins only. Members trash only their own
  (stock owner check). Restoring and emptying the trash are never granted.
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  checkAssetTrashAccess(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    return this.checkAssetAccess(userId, assetIds, TRASH_OTHERS_ROLES);
  }

  /** Identifying people: creating, reassigning and deleting faces on other members' photos. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  async checkFaceEditAccess(userId: string, assetFaceIds: Set<string>): Promise<Set<string>> {
    if (!isFamilyEnabled() || assetFaceIds.size === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('asset_face')
      .innerJoin('asset', (join) => join.onRef('asset.id', '=', 'asset_face.assetId').on('asset.deletedAt', 'is', null))
      .innerJoin('family_member as owner', 'owner.userId', 'asset.ownerId')
      .innerJoin('family_member as me', 'me.familyId', 'owner.familyId')
      .select('asset_face.id')
      .where('asset_face.id', 'in', [...assetFaceIds])
      .where('me.userId', '=', userId)
      .where('me.role', 'in', EDIT_ROLES)
      .where('asset.visibility', 'in', FAMILY_VISIBILITIES)
      .execute();
    return new Set(rows.map(({ id }) => id));
  }

  private async checkAssetAccess(userId: string, assetIds: Set<string>, roles: FamilyRole[]): Promise<Set<string>> {
    if (!isFamilyEnabled() || assetIds.size === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('asset')
      .innerJoin('family_member as owner', 'owner.userId', 'asset.ownerId')
      .innerJoin('family_member as me', 'me.familyId', 'owner.familyId')
      .select('asset.id')
      .where('asset.id', 'in', [...assetIds])
      .where('me.userId', '=', userId)
      .where('me.role', 'in', roles)
      .where('asset.deletedAt', 'is', null)
      .where('asset.visibility', 'in', FAMILY_VISIBILITIES)
      .execute();
    return new Set(rows.map(({ id }) => id));
  }
}

/** Adds the family grant to a stock grant, only for the ids the stock check didn't already allow. */
export const withFamilyAccess = async (
  granted: Set<string>,
  requested: Set<string>,
  familyCheck: (rest: Set<string>) => Promise<Set<string>>,
): Promise<Set<string>> => {
  const rest = requested.difference(granted);
  return rest.size === 0 ? granted : granted.union(await familyCheck(rest));
};
