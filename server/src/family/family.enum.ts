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
}
