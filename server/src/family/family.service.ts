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

    // the family reuses the admin's cluster group, so everyone in it must be going into the family:
    // stop with a diagnostic instead of importing a non-member's people
    const outsiders = await this.familyRepository.getClusterOutsiders(user.clusterGroupId);
    const others = outsiders.filter((outsider) => outsider.id !== user.id);
    if (others.length > 0) {
      throw new BadRequestException(
        `The face-recognition group of ${user.email} is shared with ${others.map((outsider) => outsider.email).join(', ')}, who would not be in the family. ` +
          `Ask them to leave the group (People, Leave group) or add them to the family, then set up the family again.`,
      );
    }

    // family, first admin and history in one transaction: a failure leaves nothing that blocks a retry
    const family = await this.familyRepository.createFamilyWithAdmin(user.clusterGroupId, dto.name, user.id);
    // the admin's named people (names, birth dates) become the family's; repeated at startup and by setup
    await this.reconcileSharing(family.id);

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

  /**
  For `immich-admin family-release-sharing`: takes back the partner and album sharing the family wrote,
  restoring what existed before (rows the users made themselves stay). The explicit way out of managed
  sharing, e.g. before going back to stock Immich; while the family features run, startup writes the
  sharing again.
  */
  releaseSharingFromCli() {
    return this.familyRepository.releaseManagedSharing();
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

  /**
  Adding an existing account moves its faces into the family and shares its whole library with everyone,
  without the account's consent, so only a server admin may do it. Everyone else joins by accepting an invite.
  */
  async addMember(auth: AuthDto, dto: FamilyMemberCreateDto): Promise<FamilyResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    if (!auth.user.isAdmin) {
      throw new ForbiddenException('Only a server admin can add an existing account; invite the person instead');
    }
    await this.addUserToFamily(membership, dto.userId, dto.role, { userId: auth.user.id });
    return this.mapFamily(membership);
  }

  async updateMember(auth: AuthDto, userId: string, dto: FamilyMemberUpdateDto): Promise<FamilyResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    // checked and written under a lock on the family: two admins cannot both demote themselves
    const change = await this.familyRepository.changeMemberRole(membership.familyId, userId, dto.role, auth.user.id);
    if (change.result === 'not-a-member') {
      throw new BadRequestException('Not a member of this family');
    }
    if (change.result === 'last-admin') {
      throw new BadRequestException('The family needs at least one admin');
    }
    if (change.result === 'changed') {
      await this.reconcileSharing(membership.familyId, { refreshRoles: true });
    }

    // the caller may have changed their own role
    const updated = userId === auth.user.id ? { ...membership, role: dto.role } : membership;
    return this.mapFamily(updated);
  }

  async removeMember(auth: AuthDto, userId: string): Promise<void> {
    const membership = await this.requireFamilyAdmin(auth);
    // one transaction under a lock on the family: sharing the family wrote is restored, the
    // membership goes, and the last admin can never be removed
    const removal = await this.familyRepository.removeMemberChecked(membership.familyId, userId, auth.user.id);
    if (removal.result === 'not-a-member') {
      throw new BadRequestException('Not a member of this family');
    }
    if (removal.result === 'last-admin') {
      throw new BadRequestException('The family needs at least one admin');
    }

    // like leaving a cluster group: the user's people move to a new group of their own. If this fails
    // the next startup finds the user outside the family in its cluster group and does it again.
    await this.isolateUser(userId);
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

    // membership and history in one transaction, as the last step that can fail: whatever happens
    // before it can simply be retried, and what follows is repaired by `reconcileSharing`
    const added = await this.familyRepository.addMemberWithHistory(
      { userId, familyId: membership.familyId, role, addedById: actor.userId },
      actor.userId,
    );
    if (!added) {
      throw new BadRequestException('User is already in a family');
    }
    await this.reconcileSharing(membership.familyId);
  }

  /**
  Brings the managed sharing and shared people up to date with the members. Every step is repeatable, a
  failure is logged and does not undo the membership change, and startup runs it again.
  */
  private async reconcileSharing(familyId: string, options: { refreshRoles?: boolean } = {}) {
    try {
      await this.familyRepository.ensurePartnerMesh(familyId);
      await this.familyRepository.ensureAlbumUsers(familyId, options);
      // new members' people join the family's, and they get the family's names
      await this.familyRepository.seedFamilyPeople(familyId);
      await this.familyRepository.mirrorFamilyPeople(familyId);
    } catch (error) {
      this.logger.error(`Family sharing could not be brought up to date (it is retried at startup): ${error}`);
    }
  }

  /** Gives a user who is no longer a member a cluster group of their own, with their people. */
  private async isolateUser(userId: string) {
    const clusterGroup = await this.clusterGroupRepository.create();
    await this.personRepository.reassignCluster({ userId, newClusterId: clusterGroup.id });
    await this.userRepository.update(userId, { clusterGroupId: clusterGroup.id });
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

    await this.reconcileSharing(family.id);

    // anyone left in the family's cluster group without being a member (a removal that stopped halfway)
    for (const outsider of await this.familyRepository.getClusterOutsiders(family.clusterGroupId)) {
      this.logger.warn(`Moving ${outsider.email} out of the family's face-recognition group`);
      await this.isolateUser(outsider.id);
    }
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
    // without the family features the site shows stock Immich branding: an empty wordmark says so
    if (!isFamilyEnabled()) {
      return { wordmark: '', appUrl: null };
    }
    const family = await this.familyRepository.getAnyFamily();
    // the same app link the invite page shows, for pages that have no invite (a sign-in link opened
    // on a computer, or on a phone without the app)
    return { wordmark: family?.wordmark?.trim() || 'sibred', appUrl: process.env.IMMICH_FAMILY_APP_URL || null };
  }

  private async requireFamilyAdmin(auth: AuthDto): Promise<FamilyMembership> {
    const membership = await this.requireMembership(auth);
    if (membership.role !== FamilyRole.Admin) {
      throw new ForbiddenException('Only a family admin can do this');
    }
    return membership;
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
