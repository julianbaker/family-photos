// family fork: adding relatives from the tree, the way FamilySearch and Ancestry do it.
import { FamilyGender, FamilyRelationType, createFamilyPerson, createFamilyRelation } from '@immich/sdk';
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
Records the new relative: picks an existing person or creates one (a new father is male, a new
mother female), adds the relation, and the companion relation when asked. Returns the relative's id.
*/
export const addRelative = async ({
  kind,
  forId,
  existingId,
  newName,
  withCompanion,
}: {
  kind: RelativeKind;
  forId: string;
  existingId?: string;
  newName?: string;
  withCompanion?: string | null;
}) => {
  let otherId = existingId;
  if (!otherId) {
    const gender = kind === 'father' ? FamilyGender.Male : kind === 'mother' ? FamilyGender.Female : undefined;
    const created = await createFamilyPerson({ familyPersonCreateDto: { name: newName!.trim(), gender } });
    otherId = created.id;
  }
  const relation = (personId: string, relatedPersonId: string, type: FamilyRelationType) =>
    createFamilyRelation({ familyRelationCreateDto: { personId, relatedPersonId, type } });

  switch (kind) {
    case 'father':
    case 'mother':
    case 'parent': {
      await relation(otherId, forId, FamilyRelationType.Parent);
      if (withCompanion) {
        await relation(withCompanion, otherId, FamilyRelationType.Spouse);
      }

      break;
    }
    case 'child': {
      await relation(forId, otherId, FamilyRelationType.Parent);
      if (withCompanion) {
        await relation(withCompanion, otherId, FamilyRelationType.Parent);
      }

      break;
    }
    case 'partner': {
      await relation(forId, otherId, FamilyRelationType.Spouse);

      break;
    }
    default: {
      await relation(forId, otherId, FamilyRelationType.Sibling);
    }
  }
  return otherId;
};
