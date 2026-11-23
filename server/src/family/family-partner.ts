import { BadRequestException } from '@nestjs/common';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { FamilyRepository } from 'src/family/family.repository.js';

/**
The partner rows between family members are managed by the server and never shown: they are how
every member sees the whole family library. These helpers hide them from the partner endpoints.
*/

/** The other members of the user's family, or an empty set. */
export const getFamilyPeerIds = async (family: FamilyRepository, userId: string): Promise<Set<string>> => {
  if (!isFamilyEnabled()) {
    return new Set();
  }

  const membership = await family.getMembership(userId);
  if (!membership) {
    return new Set();
  }

  const memberIds = await family.getMemberIds(membership.familyId);
  return new Set(memberIds.filter((id) => id !== userId));
};

/** Refuses to change sharing between two family members. */
export const requireNotFamilyPartner = async (family: FamilyRepository, userId: string, otherId: string) => {
  const peers = await getFamilyPeerIds(family, userId);
  if (peers.has(otherId)) {
    throw new BadRequestException('Sharing within the family is automatic and cannot be changed');
  }
};
