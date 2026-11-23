import { Injectable } from '@nestjs/common';
import { Insertable, Kysely, Updateable, sql } from 'kysely';
import { jsonArrayFrom } from 'kysely/helpers/postgres';
import { InjectKysely } from 'nestjs-kysely';
import { DummyValue, GenerateSql } from 'src/decorators.js';
import { AlbumUserRole } from 'src/enum.js';
import { FamilyInviteRequestStatus, FamilyRole } from 'src/family/family.enum.js';
import { FamilyCommentTable } from 'src/family/schema/family-comment.table.js';
import { FamilyHistoryTable } from 'src/family/schema/family-history.table.js';
import { FamilyInviteRequestTable } from 'src/family/schema/family-invite-request.table.js';
import { FamilyInviteTable } from 'src/family/schema/family-invite.table.js';
import { FamilyPersonTable } from 'src/family/schema/family-person.table.js';
import { FamilyRelationTable } from 'src/family/schema/family-relation.table.js';
import { DB } from 'src/schema/index.js';
import { anyUuid } from 'src/utils/database.js';

export type FamilyMembership = { familyId: string; clusterGroupId: string; role: FamilyRole };

export type FamilyReport = {
  familyId: string;
  familyName: string;
  members: number;
  assets: number;
  people: number;
  namedPeople: number;
  peopleWithBirthDate: number;
  faces: number;
  facesWithPerson: number;
};

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

  async addHistoryMany(entries: Insertable<FamilyHistoryTable>[]): Promise<void> {
    if (entries.length > 0) {
      await this.db.insertInto('family_history').values(entries).execute();
    }
  }

  /** The editable fields of these photos as they are now, for the history's "before" values. */
  @GenerateSql({ params: [[DummyValue.UUID]] })
  getAssetSnapshots(assetIds: string[]) {
    return this.db
      .selectFrom('asset')
      .leftJoin('asset_exif', 'asset_exif.assetId', 'asset.id')
      .select([
        'asset.id',
        'asset.isFavorite',
        'asset.visibility',
        'asset.duplicateId',
        'asset.livePhotoVideoId',
        'asset_exif.description',
        'asset_exif.dateTimeOriginal',
        'asset_exif.timeZone',
        'asset_exif.latitude',
        'asset_exif.longitude',
        'asset_exif.rating',
      ])
      .where('asset.id', '=', anyUuid(assetIds))
      .execute();
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

  // invites

  createInvite(invite: Insertable<FamilyInviteTable>) {
    return this.db.insertInto('family_invite').values(invite).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getInvites(familyId: string) {
    return this.db
      .selectFrom('family_invite')
      .selectAll('family_invite')
      .select((eb) =>
        jsonArrayFrom(
          eb
            .selectFrom('family_invite_use')
            .innerJoin('user', 'user.id', 'family_invite_use.userId')
            .select(['user.id as userId', 'user.name', 'family_invite_use.usedAt'])
            .whereRef('family_invite_use.inviteId', '=', 'family_invite.id')
            .orderBy('family_invite_use.usedAt', 'asc'),
        ).as('usedBy'),
      )
      .where('family_invite.familyId', '=', familyId)
      .orderBy('family_invite.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.BUFFER] })
  getInviteByTokenHash(tokenHash: Buffer) {
    return this.db
      .selectFrom('family_invite')
      .innerJoin('family', 'family.id', 'family_invite.familyId')
      .selectAll('family_invite')
      .select(['family.name as familyName', 'family.clusterGroupId'])
      .where('family_invite.tokenHash', '=', tokenHash)
      .executeTakeFirst();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  revokeInvite(id: string, familyId: string) {
    return this.db
      .updateTable('family_invite')
      .set({ revokedAt: new Date() })
      .where('id', '=', id)
      .where('familyId', '=', familyId)
      .where('revokedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  /** Takes one use of a still-valid invite, atomically. Returns nothing if the link can't be used. */
  @GenerateSql({ params: [DummyValue.UUID] })
  consumeInvite(id: string) {
    return this.db
      .updateTable('family_invite')
      .set((eb) => ({ uses: eb('uses', '+', 1) }))
      .where('id', '=', id)
      .where('revokedAt', 'is', null)
      .where('expiresAt', '>', new Date())
      .where((eb) => eb.or([eb('maxUses', 'is', null), eb('uses', '<', eb.ref('maxUses'))]))
      .returningAll()
      .executeTakeFirst();
  }

  /** Records who joined through an invite; once a link is used up, its copy on a request is cleared. */
  async addInviteUse(inviteId: string, userId: string): Promise<void> {
    await this.db.insertInto('family_invite_use').values({ inviteId, userId }).execute();
    await this.db
      .updateTable('family_invite_request')
      .set({ inviteToken: null })
      .where('inviteId', '=', inviteId)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('family_invite')
            .select('family_invite.id')
            .whereRef('family_invite.id', '=', 'family_invite_request.inviteId')
            .where('family_invite.maxUses', 'is not', null)
            .whereRef('family_invite.uses', '>=', 'family_invite.maxUses'),
        ),
      )
      .execute();
  }

  // invite requests

  createInviteRequest(request: Insertable<FamilyInviteRequestTable>) {
    return this.db.insertInto('family_invite_request').values(request).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, { requestedById: DummyValue.UUID }] })
  getInviteRequests(familyId: string, options: { requestedById?: string } = {}) {
    return this.db
      .selectFrom('family_invite_request')
      .innerJoin('user', 'user.id', 'family_invite_request.requestedById')
      .selectAll('family_invite_request')
      .select('user.name as requestedByName')
      .where('family_invite_request.familyId', '=', familyId)
      .$if(!!options.requestedById, (qb) =>
        qb.where('family_invite_request.requestedById', '=', options.requestedById!),
      )
      .orderBy('family_invite_request.createdAt', 'desc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getInviteRequest(id: string, familyId: string) {
    return this.db
      .selectFrom('family_invite_request')
      .selectAll()
      .where('id', '=', id)
      .where('familyId', '=', familyId)
      .executeTakeFirst();
  }

  /** Decides a pending request; returns nothing if it was already decided. */
  decideInviteRequest(
    id: string,
    decision: { status: FamilyInviteRequestStatus; decidedById: string; inviteId?: string; inviteToken?: string },
  ) {
    return this.db
      .updateTable('family_invite_request')
      .set({
        status: decision.status,
        decidedById: decision.decidedById,
        decidedAt: new Date(),
        inviteId: decision.inviteId ?? null,
        inviteToken: decision.inviteToken ?? null,
      })
      .where('id', '=', id)
      .where('status', '=', FamilyInviteRequestStatus.Pending)
      .returningAll()
      .executeTakeFirst();
  }

  // people

  /**
  Creates the family's shared record for every person group in the family's cluster group that has
  none yet, taking the name and birth date from the members' own copies: a named copy first, a family
  admin's first, one with a birth date first.
  */
  @GenerateSql({ params: [DummyValue.UUID] })
  async seedFamilyPeople(familyId: string): Promise<void> {
    await sql`
      insert into "family_person" ("personGroupId", "familyId", "name", "birthDate")
      select distinct on (p."personGroupId") p."personGroupId", f."id", p."name", p."birthDate"
      from "person" p
      join "person_group" pg on pg."id" = p."personGroupId"
      join "family" f on f."clusterGroupId" = pg."clusterGroupId" and f."id" = ${familyId}
      left join "family_member" m on m."userId" = p."ownerId" and m."familyId" = f."id"
      where not exists (select 1 from "family_person" fp where fp."personGroupId" = p."personGroupId")
      order by p."personGroupId", p."name" = '', m."role" = 'admin' desc, p."birthDate" is null
      on conflict ("personGroupId") do nothing
    `.execute(this.db);
  }

  /**
  Copies the family's names and birth dates into every member's own person rows, creating the rows
  members don't have yet. Stock screens, name search and the mobile sync read those rows.
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async mirrorFamilyPeople(familyId: string, personGroupId?: string): Promise<void> {
    await sql`
      insert into "person" ("ownerId", "personGroupId", "name", "birthDate")
      select m."userId", fp."personGroupId", fp."name", fp."birthDate"
      from "family_person" fp
      join "family_member" m on m."familyId" = fp."familyId"
      where fp."familyId" = ${familyId}
      ${personGroupId ? sql`and fp."personGroupId" = ${personGroupId}` : sql``}
      on conflict ("ownerId", "personGroupId") do update
        set "name" = excluded."name", "birthDate" = excluded."birthDate"
        where "person"."name" is distinct from excluded."name"
          or "person"."birthDate" is distinct from excluded."birthDate"
    `.execute(this.db);
  }

  @GenerateSql({ params: [DummyValue.UUID] })
  getFamilyPeople(familyId: string) {
    return this.db
      .selectFrom('family_person')
      .selectAll('family_person')
      .select((eb) =>
        eb
          .selectFrom('asset_face')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .whereRef('asset_face.personGroupId', '=', 'family_person.personGroupId')
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.isVisible', '=', true)
          .as('faceCount'),
      )
      .where('family_person.familyId', '=', familyId)
      .orderBy('family_person.name', 'asc')
      .execute();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getFamilyPerson(familyId: string, personGroupId: string) {
    return this.db
      .selectFrom('family_person')
      .selectAll()
      .where('familyId', '=', familyId)
      .where('personGroupId', '=', personGroupId)
      .executeTakeFirst();
  }

  updateFamilyPerson(personGroupId: string, values: Updateable<FamilyPersonTable>) {
    return this.db
      .updateTable('family_person')
      .set(values)
      .where('personGroupId', '=', personGroupId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** A person with no photos yet (an ancestor): a person group of their own in the family's cluster group. */
  async createFamilyPerson(
    family: { id: string; clusterGroupId: string },
    values: Omit<Insertable<FamilyPersonTable>, 'personGroupId' | 'familyId'>,
  ) {
    return this.db.transaction().execute(async (trx) => {
      const group = await trx
        .insertInto('person_group')
        .values({ clusterGroupId: family.clusterGroupId })
        .returning('id')
        .executeTakeFirstOrThrow();
      return trx
        .insertInto('family_person')
        .values({ ...values, personGroupId: group.id, familyId: family.id })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  /**
  Folds `sourceIds` into `targetId` before a merge: the target takes `values` (the combined details)
  and every relation of a source is re-pointed at the target. Relations that would point a person at
  themselves, or repeat one the target already has, are dropped. Symmetric relations (spouse, sibling,
  friend) keep the smaller ID first. The source records themselves go when the merge deletes their
  person groups.
  */
  async mergeFamilyPeople(
    familyId: string,
    targetId: string,
    sourceIds: string[],
    values: Updateable<FamilyPersonTable>,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      // "this is me" is unique: free it on the sources before the target takes it
      await trx
        .updateTable('family_person')
        .set({ linkedUserId: null })
        .where('familyId', '=', familyId)
        .where('personGroupId', '=', anyUuid(sourceIds))
        .execute();
      if (Object.keys(values).length > 0) {
        await trx
          .updateTable('family_person')
          .set(values)
          .where('familyId', '=', familyId)
          .where('personGroupId', '=', targetId)
          .execute();
      }
      await sql`
        insert into "family_relation"
          ("familyId", "personGroupId", "relatedPersonGroupId", "type", "qualifier", "label", "createdById")
        select r."familyId",
          case when r."type" in ('spouse', 'sibling', 'friend') then least(r.a, r.b) else r.a end,
          case when r."type" in ('spouse', 'sibling', 'friend') then greatest(r.a, r.b) else r.b end,
          r."type", r."qualifier", r."label", r."createdById"
        from (
          select fr.*,
            case when fr."personGroupId" = ${anyUuid(sourceIds)} then ${targetId}::uuid else fr."personGroupId" end as a,
            case when fr."relatedPersonGroupId" = ${anyUuid(sourceIds)} then ${targetId}::uuid else fr."relatedPersonGroupId" end as b
          from "family_relation" fr
          where fr."familyId" = ${familyId}
            and (fr."personGroupId" = ${anyUuid(sourceIds)} or fr."relatedPersonGroupId" = ${anyUuid(sourceIds)})
        ) r
        where r.a <> r.b
        on conflict ("personGroupId", "relatedPersonGroupId", "type") do nothing
      `.execute(trx);
      await trx
        .deleteFrom('family_relation')
        .where('familyId', '=', familyId)
        .where((eb) =>
          eb.or([eb('personGroupId', '=', anyUuid(sourceIds)), eb('relatedPersonGroupId', '=', anyUuid(sourceIds))]),
        )
        .execute();
    });
  }

  /**
  A face thumbnail for a family person from any member's copy. Members' copies made by the mirroring
  have no face crop of their own, so the stock lookup (the viewer's own copy, or one shared with
  them) finds nothing for people whose faces are in someone else's photos.
  */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  async getFamilyThumbnailPath(familyId: string, personGroupId: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom('person')
      .innerJoin('family_member', 'family_member.userId', 'person.ownerId')
      .innerJoin('family_person', 'family_person.personGroupId', 'person.personGroupId')
      .select('person.thumbnailPath')
      .where('family_member.familyId', '=', familyId)
      .where('family_person.familyId', '=', familyId)
      .where('person.personGroupId', '=', personGroupId)
      .where('person.thumbnailPath', '!=', '')
      .limit(1)
      .executeTakeFirst();
    return row?.thumbnailPath;
  }

  // relations

  @GenerateSql({ params: [DummyValue.UUID] })
  getRelations(familyId: string) {
    return this.db.selectFrom('family_relation').selectAll().where('familyId', '=', familyId).execute();
  }

  createRelation(relation: Insertable<FamilyRelationTable>) {
    return this.db.insertInto('family_relation').values(relation).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  deleteRelation(id: string, familyId: string) {
    return this.db
      .deleteFrom('family_relation')
      .where('id', '=', id)
      .where('familyId', '=', familyId)
      .returningAll()
      .executeTakeFirst();
  }

  // photos

  /** The named or recorded people in a photo, for ages and relation words. */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getAssetPeople(familyId: string, assetId: string) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('family_person', 'family_person.personGroupId', 'asset_face.personGroupId')
      .select([
        'asset_face.id as faceId',
        'family_person.personGroupId',
        'family_person.name',
        'family_person.birthDate',
        'family_person.deathDate',
        'asset.localDateTime',
      ])
      .where('asset_face.assetId', '=', assetId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('family_person.familyId', '=', familyId)
      .orderBy('asset_face.boundingBoxX1', 'asc')
      .execute();
  }

  // comments

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getComments(familyId: string, assetId: string) {
    return this.db
      .selectFrom('family_comment')
      .leftJoin('user', 'user.id', 'family_comment.userId')
      .selectAll('family_comment')
      .select('user.name as userName')
      .where('family_comment.familyId', '=', familyId)
      .where('family_comment.assetId', '=', assetId)
      .orderBy('family_comment.createdAt', 'asc')
      .execute();
  }

  createComment(comment: Insertable<FamilyCommentTable>) {
    return this.db.insertInto('family_comment').values(comment).returningAll().executeTakeFirstOrThrow();
  }

  @GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
  getComment(id: string, familyId: string) {
    return this.db
      .selectFrom('family_comment')
      .selectAll()
      .where('id', '=', id)
      .where('familyId', '=', familyId)
      .executeTakeFirst();
  }

  async deleteComment(id: string): Promise<void> {
    await this.db.deleteFrom('family_comment').where('id', '=', id).execute();
  }

  /** Counts for checking a migration: everything the family should now share. */
  @GenerateSql({ params: [DummyValue.UUID] })
  async getReport(familyId: string): Promise<FamilyReport> {
    const { rows } = await sql<FamilyReport>`
      select
        f."id" as "familyId",
        f."name" as "familyName",
        (select count(*)::int from "family_member" m where m."familyId" = f."id") as "members",
        (select count(*)::int from "asset" a join "family_member" m on m."userId" = a."ownerId"
          where m."familyId" = f."id" and a."deletedAt" is null) as "assets",
        (select count(*)::int from "family_person" fp where fp."familyId" = f."id") as "people",
        (select count(*)::int from "family_person" fp where fp."familyId" = f."id" and fp."name" != '') as "namedPeople",
        (select count(*)::int from "family_person" fp where fp."familyId" = f."id" and fp."birthDate" is not null)
          as "peopleWithBirthDate",
        (select count(*)::int from "asset_face" af join "asset" a on a."id" = af."assetId"
          join "family_member" m on m."userId" = a."ownerId"
          where m."familyId" = f."id" and af."deletedAt" is null) as "faces",
        (select count(*)::int from "asset_face" af join "asset" a on a."id" = af."assetId"
          join "family_member" m on m."userId" = a."ownerId"
          where m."familyId" = f."id" and af."deletedAt" is null and af."personGroupId" is not null) as "facesWithPerson"
      from "family" f where f."id" = ${familyId}
    `.execute(this.db);
    return rows[0];
  }
}
