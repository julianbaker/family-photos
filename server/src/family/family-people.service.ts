import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Selectable, Updateable } from 'kysely';
import { OnEvent } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ImmichWorker, JobName } from 'src/enum.js';
import { CONTRIBUTOR_ROLES, requireFamilyRole } from 'src/family/family-membership.js';
import {
  FamilyAssetPersonResponseDto,
  FamilyCommentCreateDto,
  FamilyCommentResponseDto,
  FamilyPersonCoverDto,
  FamilyPersonCreateDto,
  FamilyPersonResponseDto,
  FamilyPersonUpdateDto,
  FamilyRelationCreateDto,
  FamilyRelationResponseDto,
  FamilyRelativeCreateDto,
  FamilyRelativeCreatedDto,
  FamilyRelativeResponseDto,
  FamilyRelativesQueryDto,
} from 'src/family/family-people.dto.js';
import {
  FamilyGraph,
  Gender,
  RelationQualifier,
  RelationType,
  Relationship,
  StoredRelation,
  validateRelation,
} from 'src/family/family-relations.js';
import { FamilyHistoryAction, FamilyRole } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { ageOnPartial, endOfPeriod, isPartialDate, stockBirthDateChange } from 'src/family/partial-date.js';
import { FamilyMembership } from 'src/family/family.repository.js';
import { FamilyPersonTable } from 'src/family/schema/family-person.table.js';
import { FamilyRelationTable } from 'src/family/schema/family-relation.table.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';

type PersonRow = Selectable<FamilyPersonTable> & {
  faceCount?: number | string | null;
  hasPetFaces?: boolean | number | null;
  pictureAt?: Date | string | null;
};

/** 'YYYY-MM-DD' from a date column, whatever form the driver returns it in. */
export const toDateString = (value: unknown): string | null => {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
};

/** A date as given ('1938', '1938-03' or '1938-03-14'), checked to be real; stored exactly as given. */
const checkedDate = (which: 'birth' | 'death', value: string | null) => {
  if (value !== null && !isPartialDate(value)) {
    throw new BadRequestException(`That ${which} date isn't a real date`);
  }
  return value;
};

/** Spouse, sibling and friend are stored once, smaller ID first. */
const UNDIRECTED = new Set([RelationType.Spouse, RelationType.Sibling, RelationType.Friend]);
const isUndirected = (type: RelationType) => UNDIRECTED.has(type);

const RECONCILE_DELAY_MS = 15_000;

@Injectable()
export class FamilyPeopleService extends BaseService {
  private reconcileTimer?: NodeJS.Timeout;

  async getAll(auth: AuthDto): Promise<FamilyPersonResponseDto[]> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    const [people, graph] = await Promise.all([
      this.familyRepository.getFamilyPeople(membership.familyId),
      this.getGraph(membership.familyId),
    ]);
    const me = people.find((person) => person.linkedUserId === auth.user.id)?.personGroupId;
    return people.map((person) => this.mapPerson(person, graph, me));
  }

  async get(auth: AuthDto, id: string): Promise<FamilyPersonResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    const person = await this.requirePerson(membership, id);
    const people = await this.familyRepository.getFamilyPeople(membership.familyId);
    const me = people.find((item) => item.linkedUserId === auth.user.id)?.personGroupId;
    const withCount = people.find((item) => item.personGroupId === id) ?? person;
    return this.mapPerson(withCount, await this.getGraph(membership.familyId), me);
  }

  /** Someone with no photos yet, usually an ancestor. */
  async create(auth: AuthDto, dto: FamilyPersonCreateDto): Promise<FamilyPersonResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    const person = await this.familyRepository.createFamilyPerson(
      { id: membership.familyId, clusterGroupId: membership.clusterGroupId },
      {
        name: dto.name,
        birthDate: checkedDate('birth', dto.birthDate ?? null),
        deathDate: checkedDate('death', dto.deathDate ?? null),
        gender: dto.gender ?? null,
        bio: dto.bio ?? null,
        kind: dto.kind ?? null,
        updatedById: auth.user.id,
      },
    );
    await this.familyRepository.mirrorFamilyPeople(membership.familyId, person.personGroupId);
    await this.recordHistory(membership, auth, FamilyHistoryAction.PersonCreate, person.personGroupId, null, {
      name: person.name,
    });
    return this.get(auth, person.personGroupId);
  }

  async update(auth: AuthDto, id: string, dto: FamilyPersonUpdateDto): Promise<FamilyPersonResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    const before = await this.requirePerson(membership, id);

    if (dto.linkedUserId !== undefined) {
      await this.checkLink(membership, auth, before, dto.linkedUserId);
    }

    const birthDate = dto.birthDate === undefined ? before.birthDate : checkedDate('birth', dto.birthDate);
    const deathDate = dto.deathDate === undefined ? before.deathDate : checkedDate('death', dto.deathDate);
    // "died March 1951" can't be before "born 14 March 1951": compare the last day the death could be
    if (deathDate && birthDate && endOfPeriod(deathDate) < birthDate) {
      throw new BadRequestException('The date of death is before the birth date');
    }

    const changes = Object.fromEntries(
      Object.entries({
        name: dto.name,
        birthDate: dto.birthDate,
        deathDate: dto.deathDate,
        gender: dto.gender,
        bio: dto.bio,
        kind: dto.kind,
        linkedUserId: dto.linkedUserId,
        isHidden: dto.isHidden,
      }).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(changes).length === 0) {
      return this.get(auth, id);
    }

    await this.familyRepository.updateFamilyPerson(id, { ...changes, updatedById: auth.user.id });
    if (dto.name !== undefined || dto.birthDate !== undefined) {
      await this.familyRepository.mirrorFamilyPeople(membership.familyId, id);
    }
    if (dto.isHidden !== undefined && dto.isHidden !== before.isHidden) {
      await this.familyRepository.mirrorHidden(membership.familyId, id, dto.isHidden);
    }

    const previous = Object.fromEntries(
      Object.keys(changes).map((key) => {
        const value = before[key as keyof typeof before];
        return [key, value];
      }),
    );
    await this.recordHistory(membership, auth, FamilyHistoryAction.PersonUpdate, id, previous, changes);
    return this.get(auth, id);
  }

  /**
  Called after the stock "update person" endpoint changed a name or birth date: makes that the family's
  value and copies it to every member, so edits from stock screens and the mobile app are shared too.
  */
  async onStockPersonUpdate(auth: AuthDto, id: string, values: { name?: string; birthDate?: Date | string | null }) {
    if (!isFamilyEnabled()) {
      return;
    }
    const membership = await this.familyRepository.getMembership(auth.user.id);
    if (!membership || membership.role === FamilyRole.Viewer) {
      return;
    }
    const before = await this.familyRepository.getFamilyPerson(membership.familyId, id);
    if (!before) {
      return;
    }

    const changes: { name?: string; birthDate?: string | null } = {};
    if (values.name !== undefined && values.name !== before.name) {
      changes.name = values.name;
    }
    if (values.birthDate !== undefined) {
      // the stock screens set an exact day
      const birthDate = stockBirthDateChange(toDateString(values.birthDate), before.birthDate);
      if (birthDate !== undefined) {
        changes.birthDate = birthDate;
      }
    }
    if (Object.keys(changes).length === 0) {
      return;
    }

    await this.familyRepository.updateFamilyPerson(id, { ...changes, updatedById: auth.user.id });
    await this.familyRepository.mirrorFamilyPeople(membership.familyId, id);
    await this.recordHistory(
      membership,
      auth,
      FamilyHistoryAction.PersonUpdate,
      id,
      { name: before.name, birthDate: before.birthDate },
      changes,
    );
  }

  /**
  Called by the stock merge before it runs. In a family every member has a copy of each person (a
  mirror of the family's record), so a merge is a family-wide change: the stock code must merge every
  member's copy, not stop at the first name clash between two mirrors. This folds the sources' details
  and relations into the target first, since the sources' records go with their person groups.
  Returns true when the merge is family-wide.
  */
  async beforeStockMerge(auth: AuthDto, targetId: string, sourceIds: string[]): Promise<boolean> {
    if (!isFamilyEnabled() || sourceIds.length === 0) {
      return false;
    }
    const membership = await this.familyRepository.getMembership(auth.user.id);
    if (!membership || !CONTRIBUTOR_ROLES.includes(membership.role)) {
      return false;
    }
    const target = await this.familyRepository.getFamilyPerson(membership.familyId, targetId);
    const found = await Promise.all(
      sourceIds.map((id) => this.familyRepository.getFamilyPerson(membership.familyId, id)),
    );
    const sources = found.filter((person) => person !== undefined);
    if (!target || sources.length === 0) {
      return false;
    }

    // the target's own details win; a source only fills what the target lacks
    const values: Updateable<FamilyPersonTable> = {};
    const first = <T>(pick: (person: (typeof sources)[number]) => T | null | undefined): T | undefined =>
      sources
        .map((person) => pick(person))
        .find((value): value is T => value !== null && value !== undefined && value !== '');
    if (!target.name) {
      values.name = first((person) => person.name);
    }
    if (!target.birthDate) {
      values.birthDate = first((person) => person.birthDate);
    }
    if (!target.deathDate) {
      values.deathDate = first((person) => person.deathDate);
    }
    if (!target.gender) {
      values.gender = first((person) => person.gender);
    }
    if (!target.linkedUserId) {
      values.linkedUserId = first((person) => person.linkedUserId);
    }
    const bios = [target.bio, ...sources.map((person) => person.bio)].filter((bio) => !!bio?.trim());
    if (bios.length > 1 || (!target.bio && bios.length === 1)) {
      values.bio = bios.join('\n\n');
    }
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      if (values[key] === undefined) {
        delete values[key];
      }
    }
    if (Object.keys(values).length > 0) {
      values.updatedById = auth.user.id;
    }

    await this.familyRepository.mergeFamilyPeople(
      membership.familyId,
      targetId,
      sources.map((person) => person.personGroupId),
      values,
    );
    await this.recordHistory(
      membership,
      auth,
      FamilyHistoryAction.PersonMerge,
      targetId,
      { merged: sources.map(({ personGroupId, name }) => ({ personGroupId, name })) },
      values,
    );
    return true;
  }

  /**
  Called by the stock person cleanup, which deletes every person without faces. Family people
  without photos (ancestors, relatives added by name) are kept on purpose: deleting them would also
  delete their relations. Returns the person groups the cleanup must leave alone.
  */
  async getPeopleToKeep(personGroupIds: string[]): Promise<Set<string>> {
    if (!isFamilyEnabled()) {
      return new Set();
    }
    return this.familyRepository.getFamilyPersonGroupIds(personGroupIds);
  }

  /** Called by the stock thumbnail endpoint when the viewer's own copy has no face crop. */
  async getThumbnailFallback(auth: AuthDto, personGroupId: string): Promise<string | undefined> {
    if (!isFamilyEnabled()) {
      return undefined;
    }
    const membership = await this.familyRepository.getMembership(auth.user.id);
    return membership ? this.familyRepository.getFamilyThumbnailPath(membership.familyId, personGroupId) : undefined;
  }

  /** Called by the stock merge when it has finished: copies the merged person to every member. */
  async afterStockMerge(auth: AuthDto, targetId: string) {
    const membership = await this.familyRepository.getMembership(auth.user.id);
    if (!membership) {
      return;
    }

    await this.familyRepository.mirrorFamilyPeople(membership.familyId, targetId);
    await this.repairCovers(membership.familyId, targetId);
  }

  /**
  The family's choice of someone's picture: their clearest face in one photo, on every member's copy
  (the family shares one picture of each person). The photo must be one the family may see.
  */
  async setCover(auth: AuthDto, id: string, dto: FamilyPersonCoverDto): Promise<FamilyPersonResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    await this.requirePerson(membership, id);
    const face = await this.familyRepository.getShareableFaceInAsset(membership.familyId, id, dto.assetId);
    if (!face) {
      throw new BadRequestException('They are not recognised in a photo the family can see');
    }
    const owners = await this.familyRepository.setGroupCover(id, face.id);
    // the picture's version (updatedAt) changes again when the job has written the new picture
    for (const { ownerId } of owners) {
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId: id } });
    }
    await this.recordHistory(membership, auth, FamilyHistoryAction.PersonUpdate, id, null, { cover: dto.assetId });
    return this.get(auth, id);
  }

  /**
  Gives a shareable picture to anyone who has none: a merge kept a photo-less duplicate, the cover's photo
  was locked or trashed, its face was moved to someone else, or its owner left the family.
  */
  async repairCovers(familyId: string, personGroupId?: string) {
    const missing = await this.familyRepository.getPeopleWithoutCover(familyId, personGroupId);
    for (const { ownerId, personGroupId: groupId, faceId } of missing) {
      await this.familyRepository.setPersonCover(ownerId, groupId, faceId);
      await this.jobRepository.queue({ name: JobName.PersonGenerateThumbnail, data: { ownerId, personGroupId: groupId } });
    }
    if (missing.length > 0) {
      this.logger.log(`Gave ${missing.length} family people records a cover face`);
    }
  }

  async getRelatives(auth: AuthDto, id: string, dto: FamilyRelativesQueryDto): Promise<FamilyRelativeResponseDto[]> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    await this.requirePerson(membership, id);
    const [people, graph] = await Promise.all([
      this.familyRepository.getFamilyPeople(membership.familyId),
      this.getGraph(membership.familyId),
    ]);
    const names = new Map(people.map((person) => [person.personGroupId, person.name]));
    const keys = dto.keys
      ?.split(',')
      .map((key) => key.trim())
      .filter(Boolean);
    return graph
      .relatives(id)
      .filter((relative) => !keys || keys.includes(relative.key))
      .map((relative) => ({ ...relative, name: names.get(relative.personId) ?? '' }));
  }

  async getRelations(auth: AuthDto): Promise<FamilyRelationResponseDto[]> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    const relations = await this.familyRepository.getRelations(membership.familyId);
    return relations.map((relation) => this.mapRelation(relation));
  }

  async createRelation(auth: AuthDto, dto: FamilyRelationCreateDto): Promise<FamilyRelationResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    await this.requirePerson(membership, dto.personId);
    await this.requirePerson(membership, dto.relatedPersonId);

    let { personId, relatedPersonId } = dto;
    if (isUndirected(dto.type) && personId > relatedPersonId) {
      [personId, relatedPersonId] = [relatedPersonId, personId];
    }
    const candidate = {
      personId,
      relatedPersonId,
      type: dto.type,
      qualifier: dto.qualifier ?? null,
      label: dto.label ?? null,
    };

    const error = validateRelation(await this.getGraph(membership.familyId), candidate);
    if (error) {
      throw new BadRequestException(error);
    }

    const existing = await this.familyRepository.getRelations(membership.familyId);
    if (
      existing.some(
        (relation) =>
          relation.personGroupId === personId &&
          relation.relatedPersonGroupId === relatedPersonId &&
          relation.type === dto.type,
      )
    ) {
      throw new BadRequestException('That relation is already recorded');
    }

    const relation = await this.familyRepository.createRelation({
      familyId: membership.familyId,
      personGroupId: personId,
      relatedPersonGroupId: relatedPersonId,
      type: dto.type,
      qualifier: candidate.qualifier,
      label: candidate.label,
      createdById: auth.user.id,
    });
    await this.recordHistory(
      membership,
      auth,
      FamilyHistoryAction.RelationCreate,
      relation.id,
      null,
      candidate,
      'relation',
    );
    return this.mapRelation(relation);
  }

  /**
  Adds a father, mother, parent, partner, child, sibling, godparent, godchild, pet or (for a pet) owner: someone already in
  the family or a new person, plus the one companion relation asked for. Every relation is checked
  against the family's rules first and everything is written in one transaction, so a rejected relation
  never leaves a new person behind.
  */
  async addRelative(auth: AuthDto, id: string, dto: FamilyRelativeCreateDto): Promise<FamilyRelativeCreatedDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    await this.requirePerson(membership, id);
    if (dto.existingId) {
      await this.requirePerson(membership, dto.existingId);
    }
    if (dto.alsoWith) {
      await this.requirePerson(membership, dto.alsoWith);
    }
    const [people, stored] = await Promise.all([
      this.familyRepository.getFamilyPeople(membership.familyId),
      this.familyRepository.getRelations(membership.familyId),
    ]);
    const isPet = (personId: string) => {
      const person = people.find((item) => item.personGroupId === personId);
      return !!person && (person.kind === 'pet' || (person.kind === null && !!person.hasPetFaces));
    };
    if (dto.kind === 'owner' && !isPet(id)) {
      throw new BadRequestException('Only a pet has companions');
    }
    if (dto.kind !== 'owner' && isPet(id)) {
      throw new BadRequestException("A pet's people are its companions");
    }

    const other = dto.existingId ?? 'NEW';
    const gender =
      dto.kind === 'father' || dto.kind === 'godfather'
        ? 'male'
        : dto.kind === 'mother' || dto.kind === 'godmother'
          ? 'female'
          : null;
    const parent = (from: string, to: string) => ({ personId: from, relatedPersonId: to, type: RelationType.Parent });
    const planned: Array<{ personId: string; relatedPersonId: string; type: RelationType }> = [];
    switch (dto.kind) {
      case 'father':
      case 'mother':
      case 'parent':
      case 'owner': {
        planned.push(parent(other, id));
        if (dto.alsoWith && dto.kind !== 'owner') {
          planned.push({ personId: dto.alsoWith, relatedPersonId: other, type: RelationType.Spouse });
        }
        break;
      }
      case 'child':
      case 'pet': {
        planned.push(parent(id, other));
        if (dto.alsoWith) {
          planned.push(parent(dto.alsoWith, other));
        }
        break;
      }
      case 'partner': {
        planned.push({ personId: id, relatedPersonId: other, type: RelationType.Spouse });
        break;
      }
      case 'godfather':
      case 'godmother':
      case 'godparent': {
        // a godparent relation runs from the godparent to the godchild
        planned.push({ personId: other, relatedPersonId: id, type: RelationType.Godparent });
        break;
      }
      case 'godchild': {
        planned.push({ personId: id, relatedPersonId: other, type: RelationType.Godparent });
        break;
      }
      default: {
        planned.push({ personId: id, relatedPersonId: other, type: RelationType.Sibling });
      }
    }

    // check each relation against the family as it would be with the ones before it, new person included
    const graphPeople = [
      ...people.map((person) => ({
        id: person.personGroupId,
        gender: (person.gender as Gender) ?? null,
        pet: isPet(person.personGroupId),
      })),
      ...(dto.existingId ? [] : [{ id: 'NEW', gender: gender as Gender, pet: dto.kind === 'pet' }]),
    ];
    const accepted: StoredRelation[] = stored.map((relation) => this.toStored(relation));
    const toWrite: Array<{ personId: string; relatedPersonId: string; type: RelationType }> = [];
    for (const relation of planned) {
      let { personId, relatedPersonId } = relation;
      if (isUndirected(relation.type) && personId !== 'NEW' && relatedPersonId !== 'NEW' && personId > relatedPersonId) {
        [personId, relatedPersonId] = [relatedPersonId, personId];
      }
      const candidate = { personId, relatedPersonId, type: relation.type, qualifier: null, label: null };
      const error = validateRelation(new FamilyGraph(graphPeople, accepted), candidate);
      if (error) {
        throw new BadRequestException(error);
      }
      if (accepted.some((item) => item.personId === personId && item.relatedPersonId === relatedPersonId && item.type === relation.type)) {
        throw new BadRequestException('That relation is already recorded');
      }
      accepted.push({ id: `planned-${accepted.length}`, ...candidate });
      toWrite.push({ personId, relatedPersonId, type: relation.type });
    }

    const { newId, relations } = await this.familyRepository.addRelative(
      { id: membership.familyId, clusterGroupId: membership.clusterGroupId },
      dto.newName
        ? { name: dto.newName, gender, kind: dto.kind === 'pet' ? 'pet' : null, updatedById: auth.user.id }
        : null,
      toWrite.map((relation) => ({
        personGroupId: relation.personId,
        relatedPersonGroupId: relation.relatedPersonId,
        type: relation.type,
        qualifier: null,
        label: null,
        createdById: auth.user.id,
      })),
      (type) => isUndirected(type as RelationType),
    );
    const relativeId = newId ?? dto.existingId!;
    if (newId) {
      await this.familyRepository.mirrorFamilyPeople(membership.familyId, newId);
      await this.recordHistory(membership, auth, FamilyHistoryAction.PersonCreate, newId, null, { name: dto.newName });
    }
    for (const relation of relations) {
      await this.recordHistory(
        membership,
        auth,
        FamilyHistoryAction.RelationCreate,
        relation.id,
        null,
        this.toStored(relation),
        'relation',
      );
    }
    const latest = await this.familyRepository.getRelations(membership.familyId);
    return {
      personId: relativeId,
      relations: latest
        .filter((relation) => relations.some((created) => created.id === relation.id))
        .map((relation) => this.mapRelation(relation)),
    };
  }

  async deleteRelation(auth: AuthDto, id: string): Promise<void> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    const relation = await this.familyRepository.deleteRelation(id, membership.familyId);
    if (!relation) {
      throw new BadRequestException('Relation not found');
    }
    await this.recordHistory(
      membership,
      auth,
      FamilyHistoryAction.RelationDelete,
      id,
      this.mapRelation(relation) as unknown as Record<string, unknown>,
      null,
      'relation',
    );
  }

  /** The people in a photo, with their age when it was taken and how they're related to the viewer. */
  async getAssetPeople(auth: AuthDto, assetId: string): Promise<FamilyAssetPersonResponseDto[]> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    await this.requireFamilyAsset(membership, assetId);
    const [rows, people, graph] = await Promise.all([
      this.familyRepository.getAssetPeople(membership.familyId, assetId),
      this.familyRepository.getFamilyPeople(membership.familyId),
      this.getGraph(membership.familyId),
    ]);
    const me = people.find((person) => person.linkedUserId === auth.user.id)?.personGroupId;
    return rows.map((row) => ({
      faceId: row.faceId,
      personId: row.personGroupId,
      name: row.name,
      age: ageOnPartial(row.birthDate, toDateString(row.localDateTime)),
      relationToMe: me ? graph.relationship(me, row.personGroupId) : null,
    }));
  }

  async getComments(auth: AuthDto, assetId: string): Promise<FamilyCommentResponseDto[]> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    await this.requireFamilyAsset(membership, assetId);
    const comments = await this.familyRepository.getComments(membership.familyId, assetId);
    return comments.map((comment) => ({
      id: comment.id,
      assetId: comment.assetId,
      userId: comment.userId,
      userName: comment.userName,
      text: comment.text,
      createdAt: comment.createdAt as unknown as Date,
      canDelete: comment.userId === auth.user.id || membership.role === FamilyRole.Admin,
    }));
  }

  async createComment(auth: AuthDto, assetId: string, dto: FamilyCommentCreateDto): Promise<FamilyCommentResponseDto> {
    const membership = await requireFamilyRole(this.familyRepository, auth, CONTRIBUTOR_ROLES);
    await this.requireFamilyAsset(membership, assetId);
    const comment = await this.familyRepository.createComment({
      familyId: membership.familyId,
      assetId,
      userId: auth.user.id,
      text: dto.text,
    });
    return {
      id: comment.id,
      assetId,
      userId: auth.user.id,
      userName: auth.user.name,
      text: comment.text,
      createdAt: comment.createdAt as unknown as Date,
      canDelete: true,
    };
  }

  async deleteComment(auth: AuthDto, id: string): Promise<void> {
    const membership = await requireFamilyRole(this.familyRepository, auth);
    const comment = await this.familyRepository.getComment(id, membership.familyId);
    if (!comment) {
      throw new BadRequestException('Comment not found');
    }
    if (comment.userId !== auth.user.id && membership.role !== FamilyRole.Admin) {
      throw new ForbiddenException('Only the author or a family admin can delete a comment');
    }
    await this.familyRepository.deleteComment(id);
    await this.recordHistory(
      membership,
      auth,
      FamilyHistoryAction.CommentDelete,
      id,
      { text: comment.text, assetId: comment.assetId, userId: comment.userId },
      null,
      'comment',
    );
  }

  /** Brings shared people up to date: new people from face recognition, new members, a restore. */
  async reconcile(familyId: string) {
    await this.familyRepository.seedFamilyPeople(familyId);
    await this.familyRepository.mirrorFamilyPeople(familyId);
    await this.repairCovers(familyId);
  }

  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async onBootstrap() {
    if (!isFamilyEnabled()) {
      return;
    }
    const family = await this.familyRepository.getAnyFamily();
    if (family) {
      await this.reconcile(family.id);
    }
  }

  /** Face recognition creates new people; share them with the family shortly after, once per burst. */
  @OnEvent({ name: 'JobSuccess', workers: [ImmichWorker.Microservices] })
  onJobSuccess({ job }: ArgOf<'JobSuccess'>) {
    if (!isFamilyEnabled() || job.name !== JobName.FacialRecognition || this.reconcileTimer) {
      return;
    }
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.reconcileAll().catch((error) => this.logger.error(`Family people reconcile failed: ${error}`));
    }, RECONCILE_DELAY_MS);
  }

  private async reconcileAll() {
    const family = await this.familyRepository.getAnyFamily();
    if (family) {
      await this.reconcile(family.id);
    }
  }

  private async checkLink(
    membership: FamilyMembership,
    auth: AuthDto,
    person: Selectable<FamilyPersonTable>,
    linkedUserId: string | null,
  ) {
    const isAdmin = membership.role === FamilyRole.Admin;
    const touchesSomeoneElse =
      (linkedUserId !== null && linkedUserId !== auth.user.id) ||
      (person.linkedUserId !== null && person.linkedUserId !== auth.user.id);
    if (touchesSomeoneElse && !isAdmin) {
      throw new ForbiddenException('You can only link yourself; ask an admin to link someone else');
    }
    if (!linkedUserId) {
      return;
    }
    const members = await this.familyRepository.getMemberIds(membership.familyId);
    if (!members.includes(linkedUserId)) {
      throw new BadRequestException('That user is not in the family');
    }
    const people = await this.familyRepository.getFamilyPeople(membership.familyId);
    const other = people.find(
      (item) => item.linkedUserId === linkedUserId && item.personGroupId !== person.personGroupId,
    );
    if (other) {
      throw new BadRequestException(`That account is already linked to ${other.name || 'another person'}`);
    }
  }

  private async requirePerson(membership: FamilyMembership, id: string) {
    const person = await this.familyRepository.getFamilyPerson(membership.familyId, id);
    if (!person) {
      throw new BadRequestException('Person not found in the family');
    }
    return person;
  }

  private async requireFamilyAsset(membership: FamilyMembership, assetId: string) {
    const ids = await this.familyRepository.getFamilyAssetIds(membership.familyId, [assetId]);
    if (!ids.has(assetId)) {
      throw new BadRequestException('Photo not found in the family library');
    }
  }

  private async getGraph(familyId: string): Promise<FamilyGraph> {
    const [people, relations] = await Promise.all([
      this.familyRepository.getFamilyPeople(familyId),
      this.familyRepository.getRelations(familyId),
    ]);
    return new FamilyGraph(
      people.map((person) => ({
        id: person.personGroupId,
        gender: (person.gender as Gender) ?? null,
        pet: person.kind === 'pet' || (person.kind === null && !!person.hasPetFaces),
      })),
      relations.map((relation) => this.toStored(relation)),
    );
  }

  private toStored(relation: Selectable<FamilyRelationTable>): StoredRelation {
    return {
      id: relation.id,
      personId: relation.personGroupId,
      relatedPersonId: relation.relatedPersonGroupId,
      type: relation.type as RelationType,
      qualifier: relation.qualifier as RelationQualifier | null,
      label: relation.label,
    };
  }

  private mapRelation(relation: Selectable<FamilyRelationTable>): FamilyRelationResponseDto {
    const stored = this.toStored(relation);
    return {
      id: stored.id,
      personId: stored.personId,
      relatedPersonId: stored.relatedPersonId,
      type: stored.type,
      qualifier: stored.qualifier,
      label: stored.label,
    };
  }

  private mapPerson(person: PersonRow, graph: FamilyGraph, me: string | undefined): FamilyPersonResponseDto {
    const relationToMe: Relationship | null = me ? graph.relationship(me, person.personGroupId) : null;
    return {
      id: person.personGroupId,
      name: person.name,
      birthDate: person.birthDate,
      deathDate: person.deathDate,
      gender: (person.gender as 'female' | 'male' | null) ?? null,
      bio: person.bio,
      linkedUserId: person.linkedUserId,
      faceCount: Number(person.faceCount ?? 0),
      // set by hand, or a pet because pet recognition found its photos
      kind: person.kind === 'pet' || person.kind === 'person' ? person.kind : person.hasPetFaces ? 'pet' : 'person',
      isHidden: person.isHidden,
      // the later of the family record and the picture: a new value means a new picture
      updatedAt: new Date(
        Math.max(new Date(person.updatedAt).getTime(), person.pictureAt ? new Date(person.pictureAt).getTime() : 0),
      ).toISOString(),
      relationToMe,
    };
  }

  private async recordHistory(
    membership: FamilyMembership,
    auth: AuthDto,
    action: FamilyHistoryAction,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    entityType = 'person',
  ) {
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action,
      entityType,
      entityId,
      before,
      after,
    });
  }
}
