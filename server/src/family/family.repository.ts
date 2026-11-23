import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AlbumUserRole } from 'src/enum.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyHistoryTable } from 'src/family/schema/family-history.table.js';
import { DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';

export type FamilyMembership = { familyId: string; clusterGroupId: string; role: FamilyRole };

@Injectable()
export class FamilyRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  @GenerateSql({ params: [DummyValue.UUID] })
  getMembership(userId: string): Promise<FamilyMembership | undefined> {
    return this.db
      .selectFrom('family_member')
      .innerJoin('family', 'family.id', 'family_member.familyId')
      .select(['family_member.familyId', 'family.clusterGroupId', 'family_member.role'])
      .where('family_member.userId', '=', userId)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFamily(id: string) {
    return this.db.selectFrom('family').selectAll().where('id', '=', id).executeTakeFirst();
  }

  @GenerateSql()
  getAnyFamily() {
    return this.db.selectFrom('family').selectAll().orderBy('createdAt', 'asc').executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMembers(familyId: string) {
    return this.db
      .selectFrom('family_member')
      .innerJoin('user', (join) => join.onRef('user.id', '=', 'family_member.userId').on('user.deletedAt', 'is', null))
      .select([
        'family_member.userId',
        'family_member.role',
        'family_member.createdAt',
        'family_member.addedById',
        'user.name',
        'user.email',
      ])
      .where('family_member.familyId', '=', familyId)
      .orderBy('family_member.createdAt', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getMemberIds(familyId: string): Promise<string[]> {
    return this.db
      .selectFrom('family_member')
      .select('userId')
      .where('familyId', '=', familyId)
      .execute()
      .then((rows) => rows.map(({ userId }) => userId));
  }

  createFamily(clusterGroupId: string, name?: string) {
    return this.db
      .insertInto('family')
      .values({ clusterGroupId, ...(name && { name }) })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  addMember(member: { userId: string; familyId: string; role: FamilyRole; addedById: string | null }) {
    return this.db.insertInto('family_member').values(member).returningAll().executeTakeFirstOrThrow();
  }

  updateRole(userId: string, role: FamilyRole) {
    return this.db
      .updateTable('family_member')
      .set({ role })
      .where('userId', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async removeMember(userId: string): Promise<void> {
    await this.db.deleteFrom('family_member').where('userId', '=', userId).execute();
  }

  /**
  Partner rows in both directions between every pair of members, all shown in the timeline. This is
  what makes stock timeline, search, map, people lists and the mobile sync (with backfill) include
  every member's photos.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  async ensurePartnerMesh(familyId: string): Promise<void> {
    await sql`
      insert into "partner" ("sharedById", "sharedWithId", "inTimeline")
      select a."userId", b."userId", true
      from "family_member" a
      join "family_member" b on b."familyId" = a."familyId" and b."userId" != a."userId"
      where a."familyId" = ${familyId}
      on conflict ("sharedById", "sharedWithId") do update set "inTimeline" = true
      where "partner"."inTimeline" = false
    `.execute(this.db);
  }

  /** Removes the partner rows between a leaving member and the rest of the family. */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async removePartnerMesh(userId: string, otherIds: string[]): Promise<void> {
    if (otherIds.length === 0) {
      return;
    }

    await this.db
      .deleteFrom('partner')
      .where((eb) =>
        eb.or([
          eb.and([eb('sharedById', '=', userId), eb('sharedWithId', '=', anyUuid(otherIds))]),
          eb.and([eb('sharedWithId', '=', userId), eb('sharedById', '=', anyUuid(otherIds))]),
        ]),
      )
      .execute();
  }

  /** True when both users are members of the same family (the pair is part of the managed mesh). */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async isSameFamily(userA: string, userB: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('family_member as a')
      .innerJoin('family_member as b', 'b.familyId', 'a.familyId')
      .select('a.familyId')
      .where('a.userId', '=', userA)
      .where('b.userId', '=', userB)
      .executeTakeFirst();
    return !!row;
  }

  /**
  Every member is an album user on every album owned by another member: Editor for admins and
  members, Viewer for viewers. Album ownership is the `album_user` row with role `owner`. Existing
  rows keep their role unless `refreshRoles` is set; owner rows are never touched.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  async ensureAlbumUsers(familyId: string, options: { albumId?: string; refreshRoles?: boolean } = {}) {
    const { albumId, refreshRoles } = options;
    await sql`
      insert into "album_user" ("albumId", "userId", "role")
      select album."id", m."userId",
        (case when m."role" = 'viewer' then ${AlbumUserRole.Viewer} else ${AlbumUserRole.Editor} end)::album_user_role_enum
      from "album"
      join "album_user" owner_row on owner_row."albumId" = album."id" and owner_row."role" = ${AlbumUserRole.Owner}
      join "family_member" owner on owner."userId" = owner_row."userId" and owner."familyId" = ${familyId}
      join "family_member" m on m."familyId" = ${familyId} and m."userId" != owner_row."userId"
      where album."deletedAt" is null
      ${albumId ? sql`and album."id" = ${albumId}` : sql``}
      on conflict ("albumId", "userId") do ${
        refreshRoles
          ? sql`update set "role" = excluded."role" where "album_user"."role" != excluded."role" and "album_user"."role" != ${AlbumUserRole.Owner}`
          : sql`nothing`
      }
    `.execute(this.db);
  }

  /** Removes a leaving member from albums owned by the rest of the family, and the family from theirs. */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async removeAlbumUsers(userId: string, otherIds: string[]): Promise<void> {
    if (otherIds.length === 0) {
      return;
    }

    await sql`
      delete from "album_user" au
      using "album_user" owner_row
      where owner_row."albumId" = au."albumId"
        and owner_row."role" = ${AlbumUserRole.Owner}
        and au."role" != ${AlbumUserRole.Owner}
        and (
          (au."userId" = ${userId} and owner_row."userId" = ${anyUuid(otherIds)})
          or (owner_row."userId" = ${userId} and au."userId" = ${anyUuid(otherIds)})
        )
    `.execute(this.db);
  }

  /** Assets owned by a member of `familyId`. */
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getFamilyAssetIds(familyId: string, assetIds: string[]): Promise<Set<string>> {
    if (assetIds.length === 0) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('asset')
      .innerJoin('family_member', 'family_member.userId', 'asset.ownerId')
      .select('asset.id')
      .where('family_member.familyId', '=', familyId)
      .where('asset.id', '=', anyUuid(assetIds))
      .execute();
    return new Set(rows.map(({ id }) => id));
  }

  /** The family whose cluster group this is, if any. */
  @GenerateSql({ params: [DummyValue.UUID] })
  getFamilyByClusterGroup(clusterGroupId: string) {
    return this.db.selectFrom('family').selectAll().where('clusterGroupId', '=', clusterGroupId).executeTakeFirst();
  }

  async addHistory(entry: Insertable<FamilyHistoryTable>): Promise<void> {
    await this.db.insertInto('family_history').values(entry).execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, { take: 50, skip: 0 }] })
  getHistory(familyId: string, { take, skip }: { take: number; skip: number }) {
    return this.db
      .selectFrom('family_history')
      .selectAll()
      .where('familyId', '=', familyId)
      .orderBy('createdAt', 'desc')
      .limit(take)
      .offset(skip)
      .execute();
  }
}
