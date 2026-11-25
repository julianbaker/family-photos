import { Kysely } from 'kysely';
import { ChunkedSet, DummyValue, GenerateSql } from 'src/decorators.js';
import { AssetVisibility } from 'src/enum.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { DB } from 'src/schema/index.js';

const EDIT_ROLES = [FamilyRole.Admin, FamilyRole.Member];
const DELETE_OTHERS_ROLES = [FamilyRole.Admin];

/**
Access checks that let family members act on each other's photos. Stock checks grant the owner;
these grant other members of the owner's family, by role. Photos in an owner's locked folder are
never granted. Reads need nothing here: the managed partner mesh already grants them.
*/
export class FamilyAccess {
  constructor(private db: Kysely<DB>) {}

  /** Metadata edits (dates, places, captions, edits) on other members' photos: admins and members. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  checkAssetEditAccess(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    return this.checkAssetAccess(userId, assetIds, EDIT_ROLES);
  }

  /** Deleting other members' photos: admins only. Members delete only their own (stock owner check). */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID_SET] })
  @ChunkedSet({ paramIndex: 1 })
  checkAssetDeleteAccess(userId: string, assetIds: Set<string>): Promise<Set<string>> {
    return this.checkAssetAccess(userId, assetIds, DELETE_OTHERS_ROLES);
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
      .where('asset.visibility', '!=', AssetVisibility.Locked)
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
      .where('asset.visibility', '!=', AssetVisibility.Locked)
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
