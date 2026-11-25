import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { FamilyMembership, FamilyRepository } from 'src/family/family.repository.js';

export const requireFamilyEnabled = () => {
  if (!isFamilyEnabled()) {
    throw new BadRequestException('Family features are not enabled on this server');
  }
};

/** The caller's family membership; refused when they aren't in a family or their role isn't allowed. */
export const requireFamilyRole = async (
  family: FamilyRepository,
  auth: AuthDto,
  roles: FamilyRole[] = [FamilyRole.Admin, FamilyRole.Member, FamilyRole.Viewer],
): Promise<FamilyMembership> => {
  requireFamilyEnabled();
  const membership = await family.getMembership(auth.user.id);
  if (!membership) {
    throw new BadRequestException('You are not in a family');
  }
  if (!roles.includes(membership.role)) {
    throw new ForbiddenException(
      roles.length === 1 && roles[0] === FamilyRole.Admin
        ? 'Only a family admin can do this'
        : 'Viewers can look but not change anything',
    );
  }
  return membership;
};

export const CONTRIBUTOR_ROLES = [FamilyRole.Admin, FamilyRole.Member];

/**
Stock cluster-group changes (a request to join, accepting one, leaving) must not cross the family's
boundary: members stay in the family's face-recognition group until an admin removes them, and nobody
joins that group except by joining the family. Otherwise a nonmember would share the family's people.
*/
export const requireNoFamilyClusterChange = async (
  family: FamilyRepository,
  userId: string,
  joinClusterGroupId?: string,
) => {
  if (!isFamilyEnabled()) {
    return;
  }
  if (await family.getMembership(userId)) {
    throw new BadRequestException(
      "Family members stay in the family's face-recognition group; a family admin can remove someone from the family",
    );
  }
  if (joinClusterGroupId && (await family.getFamilyByClusterGroup(joinClusterGroupId))) {
    throw new BadRequestException('That group belongs to the family; people join the family by invitation');
  }
};
