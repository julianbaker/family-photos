export enum FamilyRole {
  /** Manages members, invites and settings; can delete any family photo. */
  Admin = 'admin',
  /** Sees everything, uploads, and edits photos, people and faces; deletes only their own uploads. */
  Member = 'member',
  /** Sees and downloads everything; changes nothing. */
  Viewer = 'viewer',
}

export enum FamilyHistoryAction {
  FamilyCreate = 'family.create',
  MemberAdd = 'member.add',
  MemberRemove = 'member.remove',
  MemberRoleUpdate = 'member.role.update',
  AssetUpdate = 'asset.update',
  InviteCreate = 'invite.create',
  InviteRevoke = 'invite.revoke',
  InviteAccept = 'invite.accept',
  InviteRequestCreate = 'invite-request.create',
  InviteRequestApprove = 'invite-request.approve',
  InviteRequestDecline = 'invite-request.decline',
  PersonCreate = 'person.create',
  PersonUpdate = 'person.update',
  RelationCreate = 'relation.create',
  RelationDelete = 'relation.delete',
  CommentDelete = 'comment.delete',
}

export enum FamilyInviteRequestStatus {
  Pending = 'pending',
  Approved = 'approved',
  Declined = 'declined',
}

export enum FamilyInviteStatus {
  Active = 'active',
  UsedUp = 'used-up',
  Expired = 'expired',
  Revoked = 'revoked',
}
