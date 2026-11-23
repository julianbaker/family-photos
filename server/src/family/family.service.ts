import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { OnEvent } from 'src/decorators.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { ImmichWorker } from 'src/enum.js';
import {
  FamilyBrandingResponseDto,
  FamilyCreateDto,
  FamilyHistoryQueryDto,
  FamilyHistoryResponseDto,
  FamilyMemberCreateDto,
  FamilyMemberUpdateDto,
  FamilyResponseDto,
  FamilyUpdateDto,
} from 'src/family/family.dto.js';
import { FamilyHistoryAction, FamilyRole } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { FamilyMembership, FamilyReport } from 'src/family/family.repository.js';
import type { ArgOf } from 'src/repositories/event.repository.js';
import { BaseService } from 'src/services/base.service.js';

type Actor = { userId: string | null };

@Injectable()
export class FamilyService extends BaseService {
  async getMyFamily(auth: AuthDto): Promise<FamilyResponseDto> {
    const membership = await this.requireMembership(auth);
    return this.mapFamily(membership);
  }

  /** A server admin turns their own cluster group into the family and becomes its first family admin. */
  async create(auth: AuthDto, dto: FamilyCreateDto): Promise<FamilyResponseDto> {
    this.requireEnabled();
    if (!auth.user.isAdmin) {
      throw new ForbiddenException('Only a server admin can create the family');
    }

    if (await this.familyRepository.getAnyFamily()) {
      throw new BadRequestException('A family already exists on this server');
    }

    const user = await this.userRepository.get(auth.user.id, {});
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const family = await this.familyRepository.createFamily(user.clusterGroupId, dto.name);
    await this.familyRepository.addMember({
      userId: user.id,
      familyId: family.id,
      role: FamilyRole.Admin,
      addedById: user.id,
    });
    // the admin's named people (names, birth dates) become the family's
    await this.familyRepository.seedFamilyPeople(family.id);
    await this.familyRepository.mirrorFamilyPeople(family.id);
    await this.familyRepository.addHistory({
      familyId: family.id,
      userId: user.id,
      action: FamilyHistoryAction.FamilyCreate,
      entityType: 'family',
      entityId: family.id,
      before: null,
      after: { name: family.name },
    });

    return this.mapFamily({ familyId: family.id, clusterGroupId: family.clusterGroupId, role: FamilyRole.Admin });
  }

  /**
  For `immich-admin family-setup`: turns an existing server admin's library into the family, e.g. when
  switching a stock Immich server over to the fork. Safe to run again: it then only reports.
  */
  async setupFromCli({ email, name }: { email: string; name?: string }): Promise<FamilyReport> {
    this.requireEnabled();
    const user = await this.userRepository.getByEmail(email);
    if (!user) {
      throw new BadRequestException(`No user with the email ${email}`);
    }
    const existing = await this.familyRepository.getMembership(user.id);
    if (!existing) {
      await this.create(
        { user: { id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin } } as AuthDto,
        { name },
      );
    }
    const membership = await this.familyRepository.getMembership(user.id);
    if (!membership) {
      throw new BadRequestException('The family could not be created');
    }
    await this.familyRepository.ensurePartnerMesh(membership.familyId);
    await this.familyRepository.ensureAlbumUsers(membership.familyId);
    await this.familyRepository.seedFamilyPeople(membership.familyId);
    await this.familyRepository.mirrorFamilyPeople(membership.familyId);
    return this.familyRepository.getReport(membership.familyId);
  }

  /** For `immich-admin family-add-member`: brings an existing account into the family. */
  async addMemberFromCli({ email, role }: { email: string; role: FamilyRole }): Promise<FamilyReport> {
    this.requireEnabled();
    const family = await this.familyRepository.getAnyFamily();
    if (!family) {
      throw new BadRequestException('Create the family first: immich-admin family-setup --email <admin email>');
    }
    const user = await this.userRepository.getByEmail(email);
    if (!user) {
      throw new BadRequestException(`No user with the email ${email}`);
    }
    if (!(await this.familyRepository.getMembership(user.id))) {
      await this.addUserToFamily({ familyId: family.id, clusterGroupId: family.clusterGroupId, role }, user.id, role, {
        userId: null,
      });
    }
    return this.familyRepository.getReport(family.id);
  }

  async addMember(auth: AuthDto, dto: FamilyMemberCreateDto): Promise<FamilyResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    await this.addUserToFamily(membership, dto.userId, dto.role, { userId: auth.user.id });
    return this.mapFamily(membership);
  }

  async updateMember(auth: AuthDto, userId: string, dto: FamilyMemberUpdateDto): Promise<FamilyResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    const members = await this.familyRepository.getMembers(membership.familyId);
    const member = members.find((item) => item.userId === userId);
    if (!member) {
      throw new BadRequestException('Not a member of this family');
    }

    if (member.role === dto.role) {
      return this.mapFamily(membership);
    }

    if (member.role === FamilyRole.Admin && this.countAdmins(members) === 1) {
      throw new BadRequestException('The family needs at least one admin');
    }

    await this.familyRepository.updateRole(userId, dto.role);
    await this.familyRepository.ensureAlbumUsers(membership.familyId, { refreshRoles: true });
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.MemberRoleUpdate,
      entityType: 'user',
      entityId: userId,
      before: { role: member.role },
      after: { role: dto.role },
    });

    // the caller may have changed their own role
    const updated = userId === auth.user.id ? { ...membership, role: dto.role } : membership;
    return this.mapFamily(updated);
  }

  async removeMember(auth: AuthDto, userId: string): Promise<void> {
    const membership = await this.requireFamilyAdmin(auth);
    const members = await this.familyRepository.getMembers(membership.familyId);
    const member = members.find((item) => item.userId === userId);
    if (!member) {
      throw new BadRequestException('Not a member of this family');
    }

    if (member.role === FamilyRole.Admin && this.countAdmins(members) === 1) {
      throw new BadRequestException('The family needs at least one admin');
    }

    const otherIds = members.map((item) => item.userId).filter((id) => id !== userId);
    await this.familyRepository.removePartnerMesh(userId, otherIds);
    await this.familyRepository.removeAlbumUsers(userId, otherIds);
    await this.familyRepository.removeMember(userId);

    // like leaving a cluster group: the user's people move to a new group of their own
    const clusterGroup = await this.clusterGroupRepository.create();
    await this.personRepository.reassignCluster({ userId, newClusterId: clusterGroup.id });
    await this.userRepository.update(userId, { clusterGroupId: clusterGroup.id });

    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.MemberRemove,
      entityType: 'user',
      entityId: userId,
      before: { role: member.role },
      after: null,
    });
  }

  async getHistory(auth: AuthDto, dto: FamilyHistoryQueryDto): Promise<FamilyHistoryResponseDto[]> {
    const membership = await this.requireFamilyAdmin(auth);
    return this.familyRepository.getHistory(membership.familyId, dto);
  }

  /**
  Adds an existing user to the family: moves them into the family's cluster group (so faces cluster
  across everyone), shares every member's library and albums with them, and theirs with everyone.
  Invite acceptance uses this too.
  */
  async addUserToFamily(membership: FamilyMembership, userId: string, role: FamilyRole, actor: Actor) {
    this.requireEnabled();
    if (await this.familyRepository.getMembership(userId)) {
      throw new BadRequestException('User is already in a family');
    }

    const user = await this.userRepository.get(userId, {});
    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.clusterGroupId !== membership.clusterGroupId) {
      await this.personRepository.reassignCluster({ userId, newClusterId: membership.clusterGroupId });
      await this.userRepository.update(userId, { clusterGroupId: membership.clusterGroupId });
    }

    await this.familyRepository.addMember({ userId, familyId: membership.familyId, role, addedById: actor.userId });
    await this.familyRepository.ensurePartnerMesh(membership.familyId);
    await this.familyRepository.ensureAlbumUsers(membership.familyId);
    // the new member's people join the family's, and they get the family's names
    await this.familyRepository.seedFamilyPeople(membership.familyId);
    await this.familyRepository.mirrorFamilyPeople(membership.familyId);
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: actor.userId,
      action: FamilyHistoryAction.MemberAdd,
      entityType: 'user',
      entityId: userId,
      before: null,
      after: { role },
    });
  }

  /** Repairs the managed sharing at startup, e.g. after a restore or a partner row removed by hand. */
  @OnEvent({ name: 'AppBootstrap', workers: [ImmichWorker.Api] })
  async onBootstrap() {
    if (!isFamilyEnabled()) {
      return;
    }

    const family = await this.familyRepository.getAnyFamily();
    if (!family) {
      return;
    }

    await this.familyRepository.ensurePartnerMesh(family.id);
    await this.familyRepository.ensureAlbumUsers(family.id);
  }

  @OnEvent({ name: 'AlbumCreate' })
  async onAlbumCreate({ id, userId }: ArgOf<'AlbumCreate'>) {
    if (!isFamilyEnabled()) {
      return;
    }

    const membership = await this.familyRepository.getMembership(userId);
    if (membership) {
      await this.familyRepository.ensureAlbumUsers(membership.familyId, { albumId: id });
    }
  }

  private requireEnabled() {
    if (!isFamilyEnabled()) {
      throw new BadRequestException('Family features are not enabled on this server');
    }
  }

  private async requireMembership(auth: AuthDto): Promise<FamilyMembership> {
    this.requireEnabled();
    const membership = await this.familyRepository.getMembership(auth.user.id);
    if (!membership) {
      throw new BadRequestException('You are not in a family');
    }
    return membership;
  }

  /** Family admins rename the family and set the website's wordmark. */
  async update(auth: AuthDto, dto: FamilyUpdateDto): Promise<FamilyResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    const before = await this.familyRepository.getFamily(membership.familyId);
    const changes: { name?: string; wordmark?: string | null } = {};
    if (dto.name !== undefined) {
      changes.name = dto.name;
    }
    if (dto.wordmark !== undefined) {
      changes.wordmark = dto.wordmark?.trim() || null;
    }
    if (Object.keys(changes).length > 0) {
      await this.familyRepository.updateFamily(membership.familyId, changes);
      await this.familyRepository.addHistory({
        familyId: membership.familyId,
        userId: auth.user.id,
        action: FamilyHistoryAction.FamilyUpdate,
        entityType: 'family',
        entityId: membership.familyId,
        before: { name: before?.name, wordmark: before?.wordmark ?? null },
        after: changes,
      });
    }
    return this.mapFamily(membership);
  }

  /** Public: the website shows the wordmark on the sign-in page, before anyone signs in. */
  async getBranding(): Promise<FamilyBrandingResponseDto> {
    const family = isFamilyEnabled() ? await this.familyRepository.getAnyFamily() : undefined;
    return { wordmark: family?.wordmark?.trim() || 'sibred' };
  }

  private async requireFamilyAdmin(auth: AuthDto): Promise<FamilyMembership> {
    const membership = await this.requireMembership(auth);
    if (membership.role !== FamilyRole.Admin) {
      throw new ForbiddenException('Only a family admin can do this');
    }
    return membership;
  }

  private countAdmins(members: Array<{ role: FamilyRole }>) {
    return members.filter((member) => member.role === FamilyRole.Admin).length;
  }

  private async mapFamily(membership: FamilyMembership): Promise<FamilyResponseDto> {
    const family = await this.familyRepository.getFamily(membership.familyId);
    if (!family) {
      throw new BadRequestException('Family not found');
    }

    const members = await this.familyRepository.getMembers(membership.familyId);
    return {
      id: family.id,
      name: family.name,
      wordmark: family.wordmark,
      role: membership.role,
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        joinedAt: member.createdAt,
      })),
    };
  }
}
