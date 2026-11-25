import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { AuthDto, LoginResponseDto } from 'src/dtos/auth.dto.js';
import { mapNotification } from 'src/dtos/notification.dto.js';
import { NotificationLevel, NotificationType } from 'src/enum.js';
import {
  FamilyInviteAcceptDto,
  FamilyInviteCreateDto,
  FamilyInvitePreviewDto,
  FamilyInviteRequestApproveDto,
  FamilyInviteRequestCreateDto,
  FamilyInviteRequestResponseDto,
  FamilyInviteResponseDto,
  FamilyInviteTokenDto,
} from 'src/family/family-invite.dto.js';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import {
  FamilyHistoryAction,
  FamilyInviteRequestStatus,
  FamilyInviteStatus,
  FamilyRole,
} from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { FamilyMembership } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { FamilyInviteRequestTable } from 'src/family/schema/family-invite-request.table.js';
import { FamilyInviteTable } from 'src/family/schema/family-invite.table.js';
import type { LoginDetails } from 'src/services/auth.service.js';
import { BaseService } from 'src/services/base.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const invitePath = (token: string) => `/invite/${token}`;

type InviteRow = Selectable<FamilyInviteTable>;
type PersonName = { personName?: string | null };

export const getInviteStatus = (invite: InviteRow, now = new Date()): FamilyInviteStatus => {
  if (invite.revokedAt) {
    return FamilyInviteStatus.Revoked;
  }
  if (new Date(invite.expiresAt) <= now) {
    return FamilyInviteStatus.Expired;
  }
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) {
    return FamilyInviteStatus.UsedUp;
  }
  return FamilyInviteStatus.Active;
};

/** Invite links: admins create them; members ask for one; anyone with a valid link can join. */
@Injectable()
export class FamilyInviteService extends BaseService {
  async create(auth: AuthDto, dto: FamilyInviteCreateDto): Promise<FamilyInviteResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    const person = dto.personId ? await this.people().requireInvitablePerson(membership.familyId, dto.personId) : null;
    const { invite, token } = await this.createInvite(
      membership,
      auth.user.id,
      dto,
      dto.label ?? null,
      person?.personGroupId ?? null,
    );
    return {
      ...this.mapInvite({ ...invite, personName: person?.name ?? null, usedBy: [] }),
      token,
      path: invitePath(token),
    };
  }

  async getAll(auth: AuthDto): Promise<FamilyInviteResponseDto[]> {
    const membership = await this.requireFamilyAdmin(auth);
    const invites = await this.familyRepository.getInvites(membership.familyId);
    return invites.map((invite) => this.mapInvite(invite));
  }

  async revoke(auth: AuthDto, id: string): Promise<void> {
    const membership = await this.requireFamilyAdmin(auth);
    const invite = await this.familyRepository.revokeInvite(id, membership.familyId);
    if (!invite) {
      throw new BadRequestException('Invite not found or already revoked');
    }

    // the link no longer works, so the copy kept for the member who asked has no use either
    await this.familyRepository.clearRequestTokens(id);
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.InviteRevoke,
      entityType: 'invite',
      entityId: id,
      before: null,
      after: null,
    });
  }

  /** What the invite page shows before someone signs up. Public. */
  async preview({ token }: FamilyInviteTokenDto): Promise<FamilyInvitePreviewDto> {
    const invite = await this.findInvite(token);
    const status = getInviteStatus(invite);
    return {
      familyName: invite.familyName,
      role: invite.role,
      valid: status === FamilyInviteStatus.Active,
      status,
      expiresAt: invite.expiresAt as unknown as Date,
      appUrl: process.env.IMMICH_FAMILY_APP_URL || null,
      personName: invite.personId ? (invite.personName ?? null) : null,
    };
  }

  /** Creates the account inside the family and signs the new member in. Public. */
  async accept(dto: FamilyInviteAcceptDto, loginDetails: LoginDetails): Promise<LoginResponseDto> {
    const invite = await this.findInvite(dto.token);
    if (getInviteStatus(invite) !== FamilyInviteStatus.Active) {
      throw new BadRequestException('This invite link is no longer valid');
    }

    if (await this.userRepository.getByEmail(dto.email)) {
      throw new BadRequestException('Email is not available');
    }

    // take the use first, so two people can't both be the last use of a link
    const consumed = await this.familyRepository.consumeInvite(invite.id);
    if (!consumed) {
      throw new BadRequestException('This invite link is no longer valid');
    }

    // The account, the membership and the use are written by different repositories, so they can't share
    // one transaction. If any step fails, undo the ones already done: give the use back and remove the
    // half-joined account, so the person can try the same link again with the same email.
    let userId: string | undefined;
    let user;
    try {
      user = await this.createUser({
        email: dto.email,
        name: dto.name,
        password: dto.password,
        isAdmin: false,
        shouldChangePassword: false,
      });
      userId = user.id;

      const membership: FamilyMembership = {
        familyId: invite.familyId,
        clusterGroupId: invite.clusterGroupId,
        role: invite.role,
      };
      await BaseService.create(FamilyService, this).addUserToFamily(membership, user.id, invite.role, {
        userId: invite.createdById,
      });
      await this.familyRepository.addInviteUse(invite.id, user.id);
      await this.familyRepository.addHistory({
        familyId: invite.familyId,
        userId: user.id,
        action: FamilyHistoryAction.InviteAccept,
        entityType: 'invite',
        entityId: invite.id,
        before: null,
        after: { userId: user.id, role: invite.role },
      });
    } catch (error) {
      await this.familyRepository.releaseInvite(invite.id);
      if (userId) {
        await this.userRepository.delete({ id: userId }, true);
      }
      throw error;
    }

    await this.linkInvitedPerson(invite, user.id);

    return this.createLoginResponse(user, loginDetails);
  }

  async createRequest(auth: AuthDto, dto: FamilyInviteRequestCreateDto): Promise<FamilyInviteRequestResponseDto> {
    const membership = await this.requireMembership(auth);
    if (membership.role === FamilyRole.Viewer) {
      throw new ForbiddenException('Viewers cannot ask for invites');
    }

    const person = dto.personId ? await this.people().requireInvitablePerson(membership.familyId, dto.personId) : null;
    const request = await this.familyRepository.createInviteRequest({
      familyId: membership.familyId,
      requestedById: auth.user.id,
      name: dto.name,
      note: dto.note || null,
      personId: person?.personGroupId ?? null,
    });
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.InviteRequestCreate,
      entityType: 'invite-request',
      entityId: request.id,
      before: null,
      after: { name: dto.name, personId: request.personId },
    });
    await this.notifyAdmins(membership.familyId, auth.user.name, dto.name);

    return this.mapRequest({ ...request, requestedByName: auth.user.name, personName: person?.name ?? null });
  }

  /** Admins see every request; other members see their own. */
  async getRequests(auth: AuthDto): Promise<FamilyInviteRequestResponseDto[]> {
    const membership = await this.requireMembership(auth);
    const requests = await this.familyRepository.getInviteRequests(membership.familyId, {
      requestedById: membership.role === FamilyRole.Admin ? undefined : auth.user.id,
    });
    return requests.map((request) => this.mapRequest(request));
  }

  async approveRequest(
    auth: AuthDto,
    id: string,
    dto: FamilyInviteRequestApproveDto,
  ): Promise<FamilyInviteRequestResponseDto> {
    const membership = await this.requireFamilyAdmin(auth);
    const request = await this.familyRepository.getInviteRequest(id, membership.familyId);
    if (!request || request.status !== FamilyInviteRequestStatus.Pending) {
      throw new BadRequestException('Request not found or already decided');
    }

    // the person may have been linked to an account since the request was made
    const person = request.personId
      ? await this.people().requireInvitablePerson(membership.familyId, request.personId)
      : null;
    const requester = await this.userRepository.get(request.requestedById, {});
    const { invite, token } = await this.createInvite(
      membership,
      auth.user.id,
      dto,
      `For ${request.name}`,
      request.personId,
    );
    const decided = await this.familyRepository.decideInviteRequest(id, {
      status: FamilyInviteRequestStatus.Approved,
      decidedById: auth.user.id,
      inviteId: invite.id,
      inviteToken: token,
    });
    if (!decided) {
      throw new BadRequestException('Request not found or already decided');
    }

    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.InviteRequestApprove,
      entityType: 'invite-request',
      entityId: id,
      before: { status: FamilyInviteRequestStatus.Pending },
      after: { status: FamilyInviteRequestStatus.Approved, inviteId: invite.id },
    });

    return this.mapRequest({ ...decided, requestedByName: requester?.name ?? '', personName: person?.name ?? null });
  }

  async declineRequest(auth: AuthDto, id: string): Promise<void> {
    const membership = await this.requireFamilyAdmin(auth);
    const request = await this.familyRepository.getInviteRequest(id, membership.familyId);
    const decided =
      request &&
      (await this.familyRepository.decideInviteRequest(id, {
        status: FamilyInviteRequestStatus.Declined,
        decidedById: auth.user.id,
      }));
    if (!decided) {
      throw new BadRequestException('Request not found or already decided');
    }

    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: auth.user.id,
      action: FamilyHistoryAction.InviteRequestDecline,
      entityType: 'invite-request',
      entityId: id,
      before: { status: FamilyInviteRequestStatus.Pending },
      after: { status: FamilyInviteRequestStatus.Declined },
    });
  }

  private async createInvite(
    membership: FamilyMembership,
    createdById: string,
    options: { role: FamilyRole; maxUses: number | null; expiresInDays: number },
    label: string | null,
    personId: string | null = null,
  ) {
    const token = this.cryptoRepository.randomBytesAsText(24);
    const invite = await this.familyRepository.createInvite({
      familyId: membership.familyId,
      tokenHash: this.cryptoRepository.hashSha256(token),
      label,
      role: options.role,
      maxUses: options.maxUses,
      expiresAt: new Date(Date.now() + options.expiresInDays * DAY_MS),
      createdById,
      personId,
    });
    await this.familyRepository.addHistory({
      familyId: membership.familyId,
      userId: createdById,
      action: FamilyHistoryAction.InviteCreate,
      entityType: 'invite',
      entityId: invite.id,
      before: null,
      after: { role: options.role, maxUses: options.maxUses, expiresAt: invite.expiresAt, label, personId },
    });
    return { invite, token };
  }

  private async findInvite(token: string) {
    if (!isFamilyEnabled()) {
      throw new BadRequestException('Family features are not enabled on this server');
    }

    const invite = await this.familyRepository.getInviteByTokenHash(this.cryptoRepository.hashSha256(token));
    if (!invite) {
      throw new BadRequestException('Invite link not found');
    }
    return invite;
  }

  private people() {
    return BaseService.create(FamilyPeopleService, this);
  }

  /**
  After someone joins with an invite for a family person, links their new account to that person. The
  sign-up has already happened, so a person who was linked or removed in the meantime (or any other
  failure here) just leaves the new member unlinked; they can still say "this is me" later.
  */
  private async linkInvitedPerson(
    invite: { familyId: string; clusterGroupId: string; role: FamilyRole; personId: string | null },
    userId: string,
  ) {
    if (!invite.personId) {
      return;
    }
    try {
      await this.people().requireInvitablePerson(invite.familyId, invite.personId);
      await this.people().linkInvitedMember(
        { familyId: invite.familyId, clusterGroupId: invite.clusterGroupId, role: invite.role },
        invite.personId,
        userId,
      );
    } catch (error) {
      this.logger.warn(`Could not link the new member to the invite's person: ${error}`);
    }
  }

  private async notifyAdmins(familyId: string, requestedBy: string, name: string) {
    const members = await this.familyRepository.getMembers(familyId);
    for (const admin of members) {
      if (admin.role !== FamilyRole.Admin) {
        continue;
      }

      const item = await this.notificationRepository.create({
        userId: admin.userId,
        type: NotificationType.Custom,
        level: NotificationLevel.Info,
        title: 'Invite request',
        description: `${requestedBy} asked to invite ${name}.`,
      });
      this.websocketRepository.clientSend('on_notification', admin.userId, mapNotification(item));
    }
  }

  private async requireMembership(auth: AuthDto): Promise<FamilyMembership> {
    if (!isFamilyEnabled()) {
      throw new BadRequestException('Family features are not enabled on this server');
    }

    const membership = await this.familyRepository.getMembership(auth.user.id);
    if (!membership) {
      throw new BadRequestException('You are not in a family');
    }
    return membership;
  }

  private async requireFamilyAdmin(auth: AuthDto): Promise<FamilyMembership> {
    const membership = await this.requireMembership(auth);
    if (membership.role !== FamilyRole.Admin) {
      throw new ForbiddenException('Only a family admin can do this');
    }
    return membership;
  }

  private mapInvite(
    invite: InviteRow & PersonName & { usedBy: Array<{ userId: string; name: string; usedAt: unknown }> },
  ): FamilyInviteResponseDto {
    return {
      id: invite.id,
      label: invite.label,
      role: invite.role,
      maxUses: invite.maxUses,
      uses: invite.uses,
      expiresAt: invite.expiresAt as unknown as Date,
      revokedAt: invite.revokedAt as unknown as Date | null,
      createdAt: invite.createdAt as unknown as Date,
      status: getInviteStatus(invite),
      usedBy: invite.usedBy.map(({ userId, name, usedAt }) => ({ userId, name, usedAt: new Date(usedAt as string) })),
      personId: invite.personId ?? null,
      personName: invite.personId ? (invite.personName ?? null) : null,
    };
  }

  private mapRequest(
    request: Selectable<FamilyInviteRequestTable> & PersonName & { requestedByName: string },
  ): FamilyInviteRequestResponseDto {
    return {
      id: request.id,
      name: request.name,
      note: request.note,
      status: request.status,
      requestedById: request.requestedById,
      requestedByName: request.requestedByName,
      personId: request.personId ?? null,
      personName: request.personId ? (request.personName ?? null) : null,
      createdAt: request.createdAt as unknown as Date,
      decidedAt: request.decidedAt as unknown as Date | null,
      path: request.inviteToken ? invitePath(request.inviteToken) : null,
    };
  }
}
