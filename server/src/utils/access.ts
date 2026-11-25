import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthSharedLink } from 'src/database.js';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { PersonUserRole } from 'src/dtos/person.dto.js';
import { AlbumUserRole, Permission } from 'src/enum.js';
import { withFamilyAccess } from 'src/family/family-access.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { PersonId } from 'src/repositories/person.repository.js';

export type GrantedRequest = {
  requested: Permission[];
  current: Permission[];
};

export const isGranted = ({ requested, current }: GrantedRequest) => {
  if (current.includes(Permission.All)) {
    return true;
  }

  return new Set(current).isSupersetOf(new Set(requested));
};

export const areSetsEqual = <T>(setA: Set<T>, setB: Set<T>): boolean => {
  return setA.size === setB.size && setA.isSupersetOf(setB);
};

export type AccessRequest = {
  auth: AuthDto;
  permission: Permission;
  ids: Set<string> | string[];
  /**
  Family fork: also grant `AssetUpdate` (or, for `AssetDelete`, trashing) on other members' photos. Off
  unless a caller asks for it, so stacks, tags, asset metadata, jobs, memories and the trash stay
  owner-only; only the metadata edits the family intends (see familyBeforeAssetUpdate), face
  identification and an admin's trashing opt in.
  */
  familyGrant?: boolean;
};

export type AccessPersonRequest = {
  auth: AuthDto;
  permission: Permission;
  ids: Set<PersonId> | PersonId[];
};

type SharedLinkAccessRequest = { sharedLink: AuthSharedLink; permission: Permission; ids: Set<string> };
type OtherAccessRequest = { auth: AuthDto; permission: Permission; ids: Set<string>; familyGrant?: boolean };

export const requireUploadAccess = (auth: AuthDto | null): AuthDto => {
  if (!auth || (auth.sharedLink && !auth.sharedLink.allowUpload)) {
    throw new UnauthorizedException();
  }
  return auth;
};

/**
Family fork: Viewers see and download everything and change nothing. These are refused before any stock
owner grant, so a photo a Viewer owns (uploaded before being demoted, or added as a Viewer) is not
writable either. Adding photos to albums (`AssetShare`, `AlbumAssetCreate`) is deliberately not here.
*/
const VIEWER_BLOCKED_PERMISSIONS = new Set<Permission>([
  Permission.AssetUpdate,
  Permission.AssetDelete,
  Permission.AssetUpload,
  Permission.AssetCopy,
  Permission.AssetDerive,
  Permission.AssetEditCreate,
  Permission.AssetEditDelete,
  Permission.AssetFileDelete,
  Permission.FaceDelete,
  Permission.PersonCreate,
  Permission.PersonReassign,
  Permission.PersonDelete,
  Permission.PersonMerge,
  Permission.StackCreate,
  Permission.StackUpdate,
  Permission.StackDelete,
  Permission.TagAsset,
]);

export const requireFamilyWriter = async (access: AccessRepository, auth: AuthDto) => {
  if (!auth.sharedLink && (await access.family.isViewer(auth.user.id))) {
    throw new ForbiddenException('Viewers can look but not change anything');
  }
};

export const requireAccess = async (access: AccessRepository, request: AccessRequest) => {
  const allowedIds = await checkAccess(access, request);
  if (areSetsEqual(new Set(request.ids), allowedIds)) {
    return;
  }
  if (VIEWER_BLOCKED_PERMISSIONS.has(request.permission)) {
    await requireFamilyWriter(access, request.auth);
  }
  throw new BadRequestException(`Not found or no ${request.permission} access`);
};

const PERSON_READ_ROLES = [PersonUserRole.Read, PersonUserRole.Write, PersonUserRole.Admin];
const PERSON_WRITE_ROLES = [PersonUserRole.Write, PersonUserRole.Admin];
const PERSON_ADMIN_ROLES = [PersonUserRole.Admin];

const asStringSet = (source: Set<PersonId>): Set<string> =>
  new Set(source.values().map((item) => `${item.personGroupId}/$${item.ownerId}`));

export const requirePersonAccess = async (access: AccessRepository, request: AccessPersonRequest) => {
  const allowedIds = await checkPersonAccess(access, request);
  if (!areSetsEqual(asStringSet(new Set(request.ids)), asStringSet(allowedIds))) {
    throw new BadRequestException(`Not found or no ${request.permission} access`);
  }
};

export const checkPersonAccess = async (
  access: AccessRepository,
  { ids, auth, permission }: AccessPersonRequest,
): Promise<Set<PersonId>> => {
  const idSet = Array.isArray(ids) ? new Set(ids) : ids;
  if (idSet.size === 0) {
    return new Set<PersonId>();
  }

  // family fork: Viewers change nothing
  if (VIEWER_BLOCKED_PERMISSIONS.has(permission) && (await access.family.isViewer(auth.user.id))) {
    return new Set<PersonId>();
  }

  switch (permission) {
    case Permission.PersonRead: {
      return access.person.checkAccess(auth.user.id, idSet, PERSON_READ_ROLES);
    }

    case Permission.PersonUpdate: {
      return access.person.checkAccess(auth.user.id, idSet, PERSON_WRITE_ROLES);
    }

    case Permission.PersonDelete:
    case Permission.PersonMerge: {
      return access.person.checkAccess(auth.user.id, idSet, PERSON_ADMIN_ROLES);
    }

    default: {
      return new Set();
    }
  }
};

export const checkAccess = async (
  access: AccessRepository,
  { ids, auth, permission, familyGrant }: AccessRequest,
): Promise<Set<string>> => {
  const idSet = Array.isArray(ids) ? new Set(ids) : ids;
  if (idSet.size === 0) {
    return new Set<string>();
  }

  // family fork: a Viewer's writes are refused before any stock owner grant
  if (!auth.sharedLink && VIEWER_BLOCKED_PERMISSIONS.has(permission) && (await access.family.isViewer(auth.user.id))) {
    return new Set<string>();
  }

  return auth.sharedLink
    ? checkSharedLinkAccess(access, { sharedLink: auth.sharedLink, permission, ids: idSet })
    : checkOtherAccess(access, { auth, permission, ids: idSet, familyGrant });
};

const checkSharedLinkAccess = async (
  access: AccessRepository,
  request: SharedLinkAccessRequest,
): Promise<Set<string>> => {
  const { sharedLink, permission, ids } = request;
  const sharedLinkId = sharedLink.id;

  switch (permission) {
    case Permission.AssetRead: {
      return await access.asset.checkSharedLinkAccess(sharedLinkId, ids);
    }

    case Permission.AssetView: {
      return await access.asset.checkSharedLinkAccess(sharedLinkId, ids);
    }

    case Permission.AssetDownload: {
      return sharedLink.allowDownload ? await access.asset.checkSharedLinkAccess(sharedLinkId, ids) : new Set();
    }

    case Permission.AssetUpload: {
      return sharedLink.allowUpload ? ids : new Set();
    }

    case Permission.AlbumRead: {
      return await access.album.checkSharedLinkAccess(sharedLinkId, ids);
    }

    case Permission.AlbumDownload: {
      return sharedLink.allowDownload ? await access.album.checkSharedLinkAccess(sharedLinkId, ids) : new Set();
    }

    case Permission.AlbumAssetCreate: {
      return sharedLink.allowUpload ? await access.album.checkSharedLinkAccess(sharedLinkId, ids) : new Set();
    }

    default: {
      return new Set<string>();
    }
  }
};

const checkOtherAccess = async (access: AccessRepository, request: OtherAccessRequest): Promise<Set<string>> => {
  const { auth, permission, ids, familyGrant } = request;

  switch (permission) {
    // uses album id
    case Permission.ActivityCreate: {
      return await access.activity.checkCreateAccess(auth.user.id, ids);
    }

    // uses activity id
    case Permission.ActivityDelete: {
      const isOwner = await access.activity.checkOwnerAccess(auth.user.id, ids);
      const isAlbumOwner = await access.activity.checkAlbumOwnerAccess(auth.user.id, ids.difference(isOwner));
      return isOwner.union(isAlbumOwner);
    }

    case Permission.AssetRead: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      const isPartner = await access.asset.checkPartnerAccess(
        auth.user.id,
        ids.difference(isOwner).difference(isAlbum),
      );
      // family fork: the family's photos (timeline and archive, live) are readable by every member
      return withFamilyAccess(isOwner.union(isAlbum).union(isPartner), ids, (rest) =>
        access.family.checkAssetReadAccess(auth.user.id, rest),
      );
    }

    case Permission.AssetShare: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, false);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      const isPartner = await access.asset.checkPartnerAccess(
        auth.user.id,
        ids.difference(isOwner).difference(isAlbum),
      );
      // family fork: any member may add family photos to albums; public links are off (familyRefuseSharedLinks)
      return isOwner.union(isAlbum).union(isPartner);
    }

    case Permission.AssetFileDownload: {
      return access.assetFile.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetView: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      const isPartner = await access.asset.checkPartnerAccess(
        auth.user.id,
        ids.difference(isOwner).difference(isAlbum),
      );
      // family fork: the family's photos (timeline and archive, live) are readable by every member
      return withFamilyAccess(isOwner.union(isAlbum).union(isPartner), ids, (rest) =>
        access.family.checkAssetReadAccess(auth.user.id, rest),
      );
    }

    case Permission.AssetDownload: {
      const isOwner = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      const isAlbum = await access.asset.checkAlbumAccess(auth.user.id, ids.difference(isOwner));
      const isPartner = await access.asset.checkPartnerAccess(
        auth.user.id,
        ids.difference(isOwner).difference(isAlbum),
      );
      // family fork: the family's photos (timeline and archive, live) are readable by every member
      return withFamilyAccess(isOwner.union(isAlbum).union(isPartner), ids, (rest) =>
        access.family.checkAssetReadAccess(auth.user.id, rest),
      );
    }

    case Permission.AssetUpdate: {
      const owned = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      return familyGrant
        ? withFamilyAccess(owned, ids, (rest) => access.family.checkAssetEditAccess(auth.user.id, rest))
        : owned;
    }

    case Permission.AssetDelete: {
      // family fork: an admin may trash another member's photo (into the owner's trash), only where the
      // caller sets `familyGrant`; restoring from the trash, duplicates and the rest stay owner-only
      const owned = await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
      return familyGrant
        ? withFamilyAccess(owned, ids, (rest) => access.family.checkAssetTrashAccess(auth.user.id, rest))
        : owned;
    }

    case Permission.AssetCopy: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetEditGet: {
      // family fork: the edits of a photo are part of seeing it, so every member may read them
      return withFamilyAccess(
        await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission),
        ids,
        (rest) => access.family.checkAssetReadAccess(auth.user.id, rest),
      );
    }

    // family fork: crop and rotate replace or erase the owner's edits; they stay with the owner
    case Permission.AssetEditCreate:
    case Permission.AssetEditDelete: {
      return await access.asset.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AssetFileRead:
    case Permission.AssetFileDelete: {
      return await access.assetFile.checkOwnerAccess(auth.user.id, ids, auth.session?.hasElevatedPermission);
    }

    case Permission.AlbumRead: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Viewer,
      );
      return isOwner.union(isShared);
    }

    case Permission.AlbumAssetCreate: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Editor,
      );
      return isOwner.union(isShared);
    }

    case Permission.AlbumUpdate: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Editor,
      );
      return isOwner.union(isShared);
    }

    case Permission.AlbumDelete: {
      return await access.album.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.AlbumShare: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Editor,
      );
      return isOwner.union(isShared);
    }

    case Permission.AlbumDownload: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Viewer,
      );
      return isOwner.union(isShared);
    }

    case Permission.AlbumAssetDelete: {
      const isOwner = await access.album.checkOwnerAccess(auth.user.id, ids);
      const isShared = await access.album.checkSharedAlbumAccess(
        auth.user.id,
        ids.difference(isOwner),
        AlbumUserRole.Editor,
      );
      return isOwner.union(isShared);
    }

    case Permission.AssetUpload: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set<string>();
    }

    case Permission.ArchiveRead: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set();
    }

    case Permission.DuplicateRead:
    case Permission.DuplicateDelete: {
      return access.duplicate.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.AuthDeviceDelete: {
      return await access.authDevice.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.FaceDelete: {
      return withFamilyAccess(await access.person.checkFaceOwnerAccess(auth.user.id, ids), ids, (rest) =>
        access.family.checkFaceEditAccess(auth.user.id, rest),
      );
    }

    case Permission.NotificationRead:
    case Permission.NotificationUpdate:
    case Permission.NotificationDelete: {
      return access.notification.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.TagAsset:
    case Permission.TagRead:
    case Permission.TagUpdate:
    case Permission.TagDelete: {
      return await access.tag.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.TimelineRead: {
      const isOwner = ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set<string>();
      const isPartner = await access.timeline.checkPartnerAccess(auth.user.id, ids.difference(isOwner));
      return isOwner.union(isPartner);
    }

    case Permission.TimelineDownload: {
      return ids.has(auth.user.id) ? new Set([auth.user.id]) : new Set();
    }

    case Permission.MemoryRead: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.MemoryUpdate: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.MemoryDelete: {
      return access.memory.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.PersonCreate: {
      return withFamilyAccess(await access.person.checkFaceOwnerAccess(auth.user.id, ids), ids, (rest) =>
        access.family.checkFaceEditAccess(auth.user.id, rest),
      );
    }

    case Permission.PersonReassign: {
      return withFamilyAccess(await access.person.checkFaceOwnerAccess(auth.user.id, ids), ids, (rest) =>
        access.family.checkFaceEditAccess(auth.user.id, rest),
      );
    }

    case Permission.ClusterGroupAdmin: {
      return access.clusterGroup.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.ClusterGroupRead: {
      const isMember = await access.clusterGroup.checkOwnerAccess(auth.user.id, ids);
      const isInvited = await access.clusterGroup.checkInviteAccess(auth.user.id, ids.difference(isMember));
      return isMember.union(isInvited);
    }

    case Permission.ClusterGroupLeave:
    case Permission.ClusterGroupRequestCreate: {
      return access.clusterGroup.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.ClusterGroupRequestDelete: {
      const isOwner = await access.clusterGroupRequest.checkOwnerAccess(auth.user.id, ids);
      const isGroupMember = await access.clusterGroupRequest.checkGroupAccess(auth.user.id, ids);
      return isOwner.union(isGroupMember);
    }

    case Permission.ClusterGroupRequestRead: {
      return access.clusterGroupRequest.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.PartnerUpdate: {
      return access.partner.checkUpdateAccess(auth.user.id, ids);
    }

    case Permission.PasskeyRead:
    case Permission.PasskeyUpdate:
    case Permission.PasskeyDelete: {
      return access.passkey.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.SessionRead:
    case Permission.SessionUpdate:
    case Permission.SessionDelete:
    case Permission.SessionLock: {
      return access.session.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackRead: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackUpdate: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.StackDelete: {
      return access.stack.checkOwnerAccess(auth.user.id, ids);
    }

    case Permission.WorkflowRead:
    case Permission.WorkflowUpdate:
    case Permission.WorkflowDelete:
    case Permission.WorkflowLogs: {
      return access.workflow.checkOwnerAccess(auth.user.id, ids);
    }

    default: {
      return new Set<string>();
    }
  }
};

export const requireElevatedPermission = (auth: AuthDto) => {
  if (!auth.session?.hasElevatedPermission) {
    throw new UnauthorizedException('Elevated permission is required');
  }
};
