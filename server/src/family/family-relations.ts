/**
Works out how two people in the family are related, from the stored relations only: parent (directed),
spouse, sibling, godparent (directed), friend and custom. Grandparents, cousins, in-laws and the rest
are computed here and never stored. Pure functions, no database.
*/


/** Close family: whose pets count as your relations (and whose people count as a pet's). */
const CLOSE_FAMILY = new Set([
  'parent',
  'adoptive-parent',
  'step-parent',
  'spouse',
  'sibling',
  'half-sibling',
  'step-sibling',
  'child',
  'adopted-child',
  'step-child',
  'grandparent',
  'grandchild',
]);

export type Gender = 'female' | 'male' | null;

export enum RelationType {
  Parent = 'parent',
  Spouse = 'spouse',
  Sibling = 'sibling',
  Godparent = 'godparent',
  Friend = 'friend',
  Custom = 'custom',
}

export enum RelationQualifier {
  Step = 'step',
  Adopted = 'adopted',
  Half = 'half',
  Former = 'former',
}

export type StoredRelation = {
  id: string;
  personId: string;
  relatedPersonId: string;
  type: RelationType;
  qualifier: RelationQualifier | null;
  label: string | null;
};

/** `pet`: a dog or cat. Pets hang from their owners (a parent relation) but never link people together. */
export type RelationPerson = { id: string; gender: Gender; pet?: boolean };

/** How `to` is related to `from`, e.g. { key: 'grandparent', label: 'grandmother' }. */
export type Relationship = { key: string; label: string };

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinal = (n: number) => ORDINALS[n - 1] ?? `${n}th`;
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
const greats = (n: number) => 'great-'.repeat(Math.max(0, n));

const WORDS: Record<string, [female: string, male: string, neutral: string]> = {
  parent: ['mother', 'father', 'parent'],
  child: ['daughter', 'son', 'child'],
  sibling: ['sister', 'brother', 'sibling'],
  'half-sibling': ['half-sister', 'half-brother', 'half-sibling'],
  grandparent: ['grandmother', 'grandfather', 'grandparent'],
  grandchild: ['granddaughter', 'grandson', 'grandchild'],
  'aunt-uncle': ['aunt', 'uncle', 'aunt or uncle'],
  'niece-nephew': ['niece', 'nephew', 'niece or nephew'],
  spouse: ['wife', 'husband', 'spouse'],
  'former-spouse': ['former wife', 'former husband', 'former spouse'],
  'parent-in-law': ['mother-in-law', 'father-in-law', 'parent-in-law'],
  'child-in-law': ['daughter-in-law', 'son-in-law', 'child-in-law'],
  'sibling-in-law': ['sister-in-law', 'brother-in-law', 'sibling-in-law'],
  'step-parent': ['stepmother', 'stepfather', 'step-parent'],
  'step-child': ['stepdaughter', 'stepson', 'stepchild'],
  'step-sibling': ['stepsister', 'stepbrother', 'step-sibling'],
  'adoptive-parent': ['adoptive mother', 'adoptive father', 'adoptive parent'],
  'adopted-child': ['adopted daughter', 'adopted son', 'adopted child'],
  godparent: ['godmother', 'godfather', 'godparent'],
  godchild: ['goddaughter', 'godson', 'godchild'],
};

/** Two people with the same relationship, in one phrase: "grandparents", "children", "aunt and uncle". */
const PLURALS: Record<string, string> = {
  parent: 'parents',
  grandparent: 'grandparents',
  child: 'children',
  grandchild: 'grandchildren',
};
const plural = (key: string, labels: string[]) => {
  const base = key.replace(/^(great-)+/, '');
  const phrase = PLURALS[base];
  return phrase ? `${greats(key.split('great-').length - 1)}${phrase}` : [...new Set(labels)].join(' and ');
};

const word = (key: string, gender: Gender) => {
  const words = WORDS[key];
  if (!words) {
    return key;
  }
  return gender === 'female' ? words[0] : gender === 'male' ? words[1] : words[2];
};

/** Blood relationship from the number of generations each person is below their nearest common ancestor. */
export const bloodRelationship = (up: number, down: number, gender: Gender): Relationship | null => {
  if (up === 0 && down === 0) {
    return { key: 'self', label: 'self' };
  }
  if (down === 0) {
    if (up === 1) {
      return { key: 'parent', label: word('parent', gender) };
    }
    return { key: `${greats(up - 2)}grandparent`, label: greats(up - 2) + word('grandparent', gender) };
  }
  if (up === 0) {
    if (down === 1) {
      return { key: 'child', label: word('child', gender) };
    }
    return { key: `${greats(down - 2)}grandchild`, label: greats(down - 2) + word('grandchild', gender) };
  }
  if (up === 1 && down === 1) {
    return { key: 'sibling', label: word('sibling', gender) };
  }
  if (down === 1) {
    // a sibling of an ancestor
    return { key: `${greats(up - 2)}aunt-uncle`, label: greats(up - 2) + word('aunt-uncle', gender) };
  }
  if (up === 1) {
    // a descendant of a sibling
    return { key: `${greats(down - 2)}niece-nephew`, label: greats(down - 2) + word('niece-nephew', gender) };
  }
  const degree = Math.min(up, down) - 1;
  const removed = Math.abs(up - down);
  return {
    key: 'cousin',
    label: `${ordinal(degree)} cousin${removed > 0 ? ` ${times(removed)} removed` : ''}`,
  };
};

/** How many generations up an ancestor key is: parent 1, grandparent 2, great-grandparent 3; else null. */
const ancestorLevel = (key: string) =>
  key === 'parent' ? 1 : key.endsWith('grandparent') ? 2 + key.split('great-').length - 1 : null;

const IN_LAW_KEYS: Record<string, string> = {
  parent: 'parent-in-law',
  sibling: 'sibling-in-law',
  'half-sibling': 'sibling-in-law',
  child: 'child-in-law',
};

const add = <V>(map: Map<string, Map<string, V>>, a: string, b: string, value: V) => {
  if (!map.has(a)) {
    map.set(a, new Map());
  }
  map.get(a)!.set(b, value);
};

const addSet = (map: Map<string, Set<string>>, a: string, b: string) => {
  if (!map.has(a)) {
    map.set(a, new Set());
  }
  map.get(a)!.add(b);
};

export class FamilyGraph {
  private people = new Map<string, RelationPerson>();
  /** child -> parents counted for blood (biological and adopted), with the qualifier */
  private parents = new Map<string, Map<string, RelationQualifier | null>>();
  private stepParents = new Map<string, Set<string>>();
  private spouses = new Map<string, Map<string, RelationQualifier | null>>();
  /** explicit sibling links, with the qualifier */
  private siblings = new Map<string, Map<string, RelationQualifier | null>>();
  private godparents = new Map<string, Set<string>>();
  private friends = new Map<string, Set<string>>();
  private custom: StoredRelation[] = [];
  /** explicit sibling groups share a virtual parent, so their families link up even without parents */
  private virtualParent = new Map<string, string>();
  private ancestorCache = new Map<string, Map<string, number>>();
  /** pet -> its owners (people recorded as its parents) */
  private petOwners = new Map<string, Set<string>>();

  constructor(people: RelationPerson[], relations: StoredRelation[]) {
    for (const person of people) {
      this.people.set(person.id, person);
    }

    for (const relation of relations) {
      const { personId: a, relatedPersonId: b, qualifier } = relation;
      // a pet's relations only say who its owners are; they never make people relatives of each other
      if (this.isPet(a) || this.isPet(b)) {
        if (relation.type === RelationType.Parent && this.isPet(b) && !this.isPet(a)) {
          addSet(this.petOwners, b, a);
        }
        continue;
      }
      switch (relation.type) {
        case RelationType.Parent: {
          if (qualifier === RelationQualifier.Step) {
            addSet(this.stepParents, b, a);
          } else {
            add(this.parents, b, a, qualifier);
          }
          break;
        }
        case RelationType.Spouse: {
          add(this.spouses, a, b, qualifier);
          add(this.spouses, b, a, qualifier);
          break;
        }
        case RelationType.Sibling: {
          add(this.siblings, a, b, qualifier);
          add(this.siblings, b, a, qualifier);
          break;
        }
        case RelationType.Godparent: {
          addSet(this.godparents, b, a);
          break;
        }
        case RelationType.Friend: {
          addSet(this.friends, a, b);
          addSet(this.friends, b, a);
          break;
        }
        case RelationType.Custom: {
          this.custom.push(relation);
          break;
        }
      }
    }

    this.buildVirtualParents();
  }

  /** Union explicit (non-step) siblings into groups; each group gets one virtual parent. */
  private buildVirtualParents() {
    const root = new Map<string, string>();
    const find = (id: string): string => {
      const parent = root.get(id) ?? id;
      if (parent === id) {
        return id;
      }
      const top = find(parent);
      root.set(id, top);
      return top;
    };
    for (const [a, others] of this.siblings) {
      for (const [b, qualifier] of others) {
        if (qualifier !== RelationQualifier.Step) {
          root.set(find(a), find(b));
        }
      }
    }
    for (const id of this.siblings.keys()) {
      const top = find(id);
      if (top !== id || this.siblings.keys().some((other) => other !== id && find(other) === top)) {
        this.virtualParent.set(id, `virtual:${top}`);
      }
    }
  }

  private parentsOf(id: string): string[] {
    const result = [...(this.parents.get(id)?.keys() ?? [])];
    const virtual = this.virtualParent.get(id);
    if (virtual) {
      result.push(virtual);
    }
    return result;
  }

  /** Every ancestor (including the person, at 0) with the fewest generations up to it. */
  private ancestors(id: string): Map<string, number> {
    const cached = this.ancestorCache.get(id);
    if (cached) {
      return cached;
    }
    const result = new Map<string, number>([[id, 0]]);
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const distance = result.get(current)!;
      for (const parent of this.parentsOf(current)) {
        if (result.has(parent)) {
          continue;
        }

        result.set(parent, distance + 1);
        queue.push(parent);
      }
    }
    this.ancestorCache.set(id, result);
    return result;
  }

  private gender(id: string): Gender {
    return this.people.get(id)?.gender ?? null;
  }

  /** The nearest blood relationship of `to` relative to `from`, if any. */
  blood(from: string, to: string): Relationship | null {
    const fromAncestors = this.ancestors(from);
    const toAncestors = this.ancestors(to);
    let best: { up: number; down: number } | null = null;
    for (const [ancestor, up] of fromAncestors) {
      const down = toAncestors.get(ancestor);
      if (down !== undefined && (!best || up + down < best.up + best.down)) {
        best = { up, down };
      }
    }
    if (!best) {
      return null;
    }

    const relationship = bloodRelationship(best.up, best.down, this.gender(to));
    if (!relationship) {
      return null;
    }

    if (relationship.key === 'sibling' && this.isHalfSibling(from, to)) {
      return { key: 'half-sibling', label: word('half-sibling', this.gender(to)) };
    }

    if (best.up === 1 && best.down === 0 && this.parents.get(from)?.get(to) === RelationQualifier.Adopted) {
      return { key: 'adoptive-parent', label: word('adoptive-parent', this.gender(to)) };
    }
    if (best.up === 0 && best.down === 1 && this.parents.get(to)?.get(from) === RelationQualifier.Adopted) {
      return { key: 'adopted-child', label: word('adopted-child', this.gender(to)) };
    }

    return relationship;
  }

  private isHalfSibling(a: string, b: string): boolean {
    if (this.siblings.get(a)?.get(b) === RelationQualifier.Half) {
      return true;
    }
    const parentsA = new Set(this.parents.get(a)?.keys());
    const parentsB = new Set(this.parents.get(b)?.keys());
    const shared = [...parentsA].filter((parent) => parentsB.has(parent)).length;
    return parentsA.size === 2 && parentsB.size === 2 && shared === 1;
  }

  private spousesOf(id: string, includeFormer = false): string[] {
    return [...(this.spouses.get(id) ?? [])]
      .filter(([, qualifier]) => includeFormer || qualifier !== RelationQualifier.Former)
      .map(([spouse]) => spouse);
  }

  /** How `to` is related to `from`, using the closest kind of link; null when they aren't related. */
  relationship(from: string, to: string): Relationship | null {
    if (from === to) {
      return { key: 'self', label: 'self' };
    }
    if (this.isPet(to)) {
      return this.petRelationship(from, to);
    }
    if (this.isPet(from)) {
      return this.ownerSideRelationship(from, to);
    }

    const spouseQualifier = this.spouses.get(from)?.get(to);
    if (spouseQualifier !== undefined) {
      const key = spouseQualifier === RelationQualifier.Former ? 'former-spouse' : 'spouse';
      return { key, label: word(key, this.gender(to)) };
    }

    const blood = this.blood(from, to);
    if (blood) {
      return blood;
    }

    const step = this.stepRelationship(from, to);
    if (step) {
      return step;
    }

    const inLaw = this.inLawRelationship(from, to);
    if (inLaw) {
      return inLaw;
    }

    if (this.godparents.get(from)?.has(to)) {
      return { key: 'godparent', label: word('godparent', this.gender(to)) };
    }
    if (this.godparents.get(to)?.has(from)) {
      return { key: 'godchild', label: word('godchild', this.gender(to)) };
    }
    if (this.friends.get(from)?.has(to)) {
      return { key: 'friend', label: 'friend' };
    }

    // custom: the label says what `personId` is to `relatedPersonId`
    const custom = this.custom.find((relation) => relation.personId === to && relation.relatedPersonId === from);
    if (custom?.label) {
      return { key: 'custom', label: custom.label };
    }
    const reverse = this.custom.find((relation) => relation.personId === from && relation.relatedPersonId === to);
    if (reverse?.label) {
      return { key: 'custom', label: `(you are their ${reverse.label})` };
    }

    return null;
  }

  private stepParentsOf(id: string): Set<string> {
    const result = new Set(this.stepParents.get(id));
    // a parent's current spouse who isn't also a parent
    const parents = new Set(this.parents.get(id)?.keys());
    for (const parent of parents) {
      for (const spouse of this.spousesOf(parent)) {
        if (!parents.has(spouse)) {
          result.add(spouse);
        }
      }
    }
    return result;
  }

  private stepRelationship(from: string, to: string): Relationship | null {
    if (this.stepParentsOf(from).has(to)) {
      return { key: 'step-parent', label: word('step-parent', this.gender(to)) };
    }
    if (this.stepParentsOf(to).has(from)) {
      return { key: 'step-child', label: word('step-child', this.gender(to)) };
    }
    if (this.siblings.get(from)?.get(to) === RelationQualifier.Step) {
      return { key: 'step-sibling', label: word('step-sibling', this.gender(to)) };
    }
    // a step-parent's child who isn't a blood sibling
    for (const stepParent of this.stepParentsOf(from)) {
      if (this.parents.get(to)?.has(stepParent)) {
        return { key: 'step-sibling', label: word('step-sibling', this.gender(to)) };
      }
    }
    return null;
  }

  private inLawRelationship(from: string, to: string): Relationship | null {
    // a blood relative of my spouse
    for (const spouse of this.spousesOf(from)) {
      const blood = this.blood(spouse, to);
      if (blood && blood.key !== 'self') {
        // my spouse's grandchildren are my step-grandchildren, not in-laws
        if (blood.key.endsWith('grandchild')) {
          return { key: blood.key, label: `step-${blood.label}` };
        }
        // a partner's nieces and nephews are your nieces and nephews too, not "in-laws"
        if (blood.key.endsWith('niece-nephew')) {
          return blood;
        }
        const key = IN_LAW_KEYS[blood.key];
        if (key) {
          return { key, label: word(key, this.gender(to)) };
        }
        return { key: `${blood.key}-in-law`, label: `${blood.label}-in-law` };
      }
    }
    // the spouse of my blood relative
    for (const spouse of this.spousesOf(to)) {
      const blood = this.blood(from, spouse);
      if (blood && blood.key !== 'self') {
        if (blood.key === 'child') {
          return { key: 'child-in-law', label: word('child-in-law', this.gender(to)) };
        }
        if (blood.key === 'sibling' || blood.key === 'half-sibling') {
          return { key: 'sibling-in-law', label: word('sibling-in-law', this.gender(to)) };
        }
        if (blood.key.endsWith('aunt-uncle')) {
          const prefix = blood.key.slice(0, -'aunt-uncle'.length);
          return { key: blood.key, label: `${prefix}${word('aunt-uncle', this.gender(to))} by marriage` };
        }
        // a grandparent's (or great-grandparent's) spouse is a step-grandparent, with the grandparents
        if (blood.key.endsWith('grandparent')) {
          const prefix = blood.key.slice(0, -'grandparent'.length);
          return { key: blood.key, label: `step-${prefix}${word('grandparent', this.gender(to))}` };
        }
        return { key: `${blood.key}-spouse`, label: `${blood.label}'s ${word('spouse', this.gender(to))}` };
      }
    }
    // a step-grandparent's own child: a step-aunt or step-uncle (a step-parent's child is a step-sibling)
    for (const parent of this.parents.get(to)?.keys() ?? []) {
      const level = this.stepAncestorLevel(from, parent);
      if (level !== null && level >= 2) {
        const relation = bloodRelationship(level, 1, this.gender(to))!;
        return { key: relation.key, label: `step-${relation.label}` };
      }
    }
    // a sibling's (or my partner's sibling's) stepchild: a step-niece or step-nephew
    for (const parent of this.parents.get(to)?.keys() ?? []) {
      for (const stepParent of this.spousesOf(parent)) {
        if (this.parents.get(to)?.has(stepParent)) {
          continue;
        }
        const viaMe = this.blood(from, stepParent);
        const viaPartner = this.spousesOf(from).map((spouse) => this.blood(spouse, stepParent));
        if ([viaMe, ...viaPartner].some((blood) => blood?.key === 'sibling' || blood?.key === 'half-sibling')) {
          return { key: 'niece-nephew', label: `step-${word('niece-nephew', this.gender(to))}` };
        }
      }
    }
    // the other way: I'm a step-grandparent's child, so `to` is my step-niece or step-nephew
    for (const parent of this.parents.get(from)?.keys() ?? []) {
      const level = this.stepAncestorLevel(to, parent);
      if (level !== null && level >= 2) {
        const relation = bloodRelationship(1, level, this.gender(to))!;
        return { key: relation.key, label: `step-${relation.label}` };
      }
    }
    return null;
  }

  /**
  How many generations up `person` is as `id`'s step-ancestor: the current spouse of a blood parent
  (1), grandparent (2) and so on, who isn't a blood relative; null when they aren't one.
  */
  private stepAncestorLevel(id: string, person: string): number | null {
    if (this.blood(id, person)) {
      return null;
    }
    for (const spouse of this.spousesOf(person)) {
      const blood = this.blood(id, spouse);
      const level = blood ? ancestorLevel(blood.key) : null;
      if (level !== null) {
        return level;
      }
    }
    return null;
  }

  /** Everyone related to `from`, closest first. */
  relatives(from: string): Array<{ personId: string } & Relationship> {
    const result: Array<{ personId: string } & Relationship> = [];
    for (const id of this.people.keys()) {
      if (id === from) {
        continue;
      }
      const relationship = this.relationship(from, id);
      if (relationship) {
        result.push({ personId: id, ...relationship });
      }
    }
    return result;
  }

  ownerCount(pet: string): number {
    return this.petOwners.get(pet)?.size ?? 0;
  }

  isPet(id: string): boolean {
    return this.people.get(id)?.pet === true;
  }

  /**
  A pet, seen by someone: "pet" to its owners, else through them ("grandmother's pet"), but only when
  an owner is close family: a cousin's or great-aunt's dog isn't a relation.
  */
  private petRelationship(from: string, pet: string): Relationship | null {
    const owners = [...(this.petOwners.get(pet) ?? [])];
    if (owners.includes(from)) {
      return { key: 'pet', label: 'pet' };
    }
    const through = owners
      .map((owner) => this.relationship(from, owner))
      .filter((relationship): relationship is Relationship => relationship !== null && CLOSE_FAMILY.has(relationship.key));
    if (through.length === 0) {
      return null;
    }
    // both owners the same to you (your grandparents): one plural word; else the first owner's
    const sameKey = through.length > 1 && through.every((relationship) => relationship.key === through[0].key);
    const owner = sameKey ? plural(through[0].key, through.map((relationship) => relationship.label)) : through[0].label;
    const whose = owner.endsWith('s') ? `${owner}'` : `${owner}'s`;
    return { key: 'pet', label: `${whose} pet` };
  }

  /** Someone, seen from a pet's page: its "owner", or the owner's relative ("owner's son"). */
  private ownerSideRelationship(pet: string, to: string): Relationship | null {
    const owners = [...(this.petOwners.get(pet) ?? [])];
    if (owners.includes(to)) {
      return { key: 'owner', label: 'owner' };
    }
    for (const owner of owners) {
      const relationship = this.relationship(owner, to);
      // only the owner's close family (and their pets), like a pet seen from the other side
      if (relationship && relationship.key !== 'self' && (relationship.key === 'pet' || CLOSE_FAMILY.has(relationship.key))) {
        // another pet: "owner's pet" when it's the owner's own, else through the owner ("owner's parents' pet")
        if (relationship.key === 'pet') {
          return { key: 'pet', label: relationship.label === 'pet' ? "owner's pet" : `owner's ${relationship.label}` };
        }
        return { key: 'owner-relative', label: `owner's ${relationship.label}` };
      }
    }
    return null;
  }

  /** People who are `key` to `from`, e.g. all of someone's children or grandparents. */
  relativesByKey(from: string, keys: string[]): string[] {
    return this.relatives(from)
      .filter((relative) => keys.includes(relative.key))
      .map((relative) => relative.personId);
  }

  /** True when `ancestor` is `id` or one of its blood ancestors. */
  isAncestor(ancestor: string, id: string): boolean {
    return this.ancestors(id).has(ancestor);
  }

  /** True when they are recorded as siblings (any kind) or share a parent. */
  areSiblings(a: string, b: string): boolean {
    if (this.siblings.get(a)?.has(b)) {
      return true;
    }
    const parentsA = this.parents.get(a);
    return !!parentsA && parentsA.keys().some((parent) => this.parents.get(b)?.has(parent));
  }

  areSpouses(a: string, b: string): boolean {
    return this.spouses.get(a)?.has(b) ?? false;
  }

  bloodParentCount(id: string): number {
    return this.parents.get(id)?.size ?? 0;
  }
}

/** Refuses relations that can't be true: cycles, a third parent, and the like. Returns an error message or null. */
export const validateRelation = (
  graph: FamilyGraph,
  relation: Pick<StoredRelation, 'personId' | 'relatedPersonId' | 'type' | 'qualifier' | 'label'>,
): string | null => {
  const { personId, relatedPersonId, type, qualifier, label } = relation;
  if (personId === relatedPersonId) {
    return 'A person cannot be related to themselves';
  }
  if (type === RelationType.Custom && !label?.trim()) {
    return 'A custom relation needs a label';
  }
  if (type !== RelationType.Custom && label) {
    return 'Only a custom relation has a label';
  }

  const allowed: Record<RelationType, Array<RelationQualifier | null>> = {
    [RelationType.Parent]: [null, RelationQualifier.Step, RelationQualifier.Adopted],
    [RelationType.Sibling]: [null, RelationQualifier.Step, RelationQualifier.Half, RelationQualifier.Adopted],
    [RelationType.Spouse]: [null, RelationQualifier.Former],
    [RelationType.Godparent]: [null],
    [RelationType.Friend]: [null],
    [RelationType.Custom]: [null],
  };
  if (!allowed[type].includes(qualifier)) {
    return `"${qualifier}" doesn't apply to a ${type} relation`;
  }

  // a pet's people are its owners: at most two, like parents, so the tree can draw them. Nothing else
  // (godparent, partner, sibling, friend...) makes sense for a pet, and the graph ignores it anyway.
  if (graph.isPet(relatedPersonId) || graph.isPet(personId)) {
    if (type !== RelationType.Parent) {
      return `A pet can only have owners, not a ${type} relation`;
    }
    if (graph.isPet(personId)) {
      return graph.isPet(relatedPersonId) ? 'A pet cannot own a pet' : 'A pet cannot be anyone\'s parent';
    }
    if (graph.ownerCount(relatedPersonId) >= 2) {
      return 'This pet already has two owners';
    }
    return null;
  }

  if (type === RelationType.Parent && qualifier !== RelationQualifier.Step) {
    if (graph.isAncestor(relatedPersonId, personId)) {
      return 'That would make someone their own ancestor';
    }
    if (graph.bloodParentCount(relatedPersonId) >= 2) {
      return 'This person already has two parents; add a step-parent instead';
    }
  }

  if (
    (type === RelationType.Sibling || type === RelationType.Spouse) &&
    (graph.isAncestor(personId, relatedPersonId) || graph.isAncestor(relatedPersonId, personId))
  ) {
    return 'One of them is already an ancestor of the other';
  }

  // siblings who are also partners would sit in the family tree twice
  if (type === RelationType.Spouse && graph.areSiblings(personId, relatedPersonId)) {
    return 'They are siblings, so they cannot also be partners';
  }
  if (type === RelationType.Sibling && graph.areSpouses(personId, relatedPersonId)) {
    return 'They are partners, so they cannot also be siblings';
  }

  return null;
};
