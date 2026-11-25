// family fork: adding relatives from the tree, the way FamilySearch and Ancestry do it.
import { FamilyRelativeKind, addFamilyRelative } from '@immich/sdk';
import { parentsOf, partnersOf, type FamilyGraph } from './layout';

export type RelativeKind = 'father' | 'mother' | 'parent' | 'partner' | 'child' | 'sibling';

export const KIND_LABEL: Record<RelativeKind, string> = {
  father: 'father',
  mother: 'mother',
  parent: 'parent',
  partner: 'partner',
  child: 'child',
  sibling: 'brother or sister',
};

/** Who else the new relation can sensibly include, offered as a checkbox (on by default). */
export const companion = (
  graph: FamilyGraph,
  kind: RelativeKind,
  forId: string,
): { id: string; text: string } | null => {
  if (['father', 'mother', 'parent'].includes(kind)) {
    // the other parent, so the two parents are recorded as partners too
    const parents = parentsOf(graph, forId).filter((parent) => !graph.parents.get(forId)?.get(parent)?.indirect);
    if (parents.length === 1 && !graph.partners.get(parents[0])) {
      const name = graph.people.get(parents[0])?.name || 'the other parent';
      return { id: parents[0], text: `Also record them as ${name}'s partner` };
    }
  } else if (kind === 'child') {
    // a single current partner is most likely the other parent
    const current = partnersOf(graph, forId).filter((partner) => !graph.partners.get(forId)?.get(partner)?.former);
    if (current.length === 1) {
      const name = graph.people.get(current[0])?.name || 'their partner';
      return { id: current[0], text: `Also ${name}'s child` };
    }
  }
  return null;
};

/**
Records the new relative in one request: the server checks the family's rules first and writes the
new person (a new father is male, a new mother female) and the relations together, so a refused
relation never leaves a stray person behind. For a pet, a "parent" is a companion (the API value "owner"). Returns the relative's id.
*/
export const addRelative = async ({
  kind,
  forId,
  forIsPet = false,
  existingId,
  newName,
  withCompanion,
}: {
  kind: RelativeKind;
  forId: string;
  forIsPet?: boolean;
  existingId?: string;
  newName?: string;
  withCompanion?: string | null;
}) => {
  const relativeKind: FamilyRelativeKind = forIsPet
    ? FamilyRelativeKind.Owner
    : (kind as unknown as FamilyRelativeKind);
  const { personId } = await addFamilyRelative({
    id: forId,
    familyRelativeCreateDto: {
      kind: relativeKind,
      existingId,
      newName: newName?.trim() || undefined,
      alsoWith: forIsPet ? undefined : (withCompanion ?? undefined),
    },
  });
  return personId;
};
