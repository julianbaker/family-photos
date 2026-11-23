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
