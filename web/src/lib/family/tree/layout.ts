// family fork: lays out the family tree around one person, as an hourglass: ancestors above,
// the person with their siblings and partners in the middle, descendants below. Pure functions, so
// the tree can re-centre instantly in the browser and the layout can be tested on its own.

export type TreePerson = {
  id: string;
  name: string;
  gender?: string | null;
  birthDate?: string | null;
  deathDate?: string | null;
};

export type TreeRelation = {
  id: string;
  /** For "parent" and "godparent": personId is the parent of relatedPersonId. */
  personId: string;
  relatedPersonId: string;
  type: string;
  qualifier?: string | null;
};

export type AddKind = 'father' | 'mother' | 'parent' | 'partner' | 'child';

export type TreeTile =
  | { key: string; kind: 'person'; personId: string; x: number; y: number; generation: number; focus: boolean }
  | { key: string; kind: 'add'; add: AddKind; forId: string; x: number; y: number; generation: number };

export type TreeLine = { key: string; points: Array<[number, number]>; dashed: boolean };

export type TreeLayout = {
  tiles: TreeTile[];
  lines: TreeLine[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

export const TILE = { width: 132, height: 184, gapX: 32, gapY: 72 };
const UNIT = TILE.width + TILE.gapX;
const ROW = TILE.height + TILE.gapY;

// ---------------------------------------------------------------------------------------------
// the family graph

export type FamilyGraph = {
  people: Map<string, TreePerson>;
  /** child → parents, with whether the link is step or adopted */
  parents: Map<string, Map<string, { indirect: boolean }>>;
  /** parent → children */
  children: Map<string, Set<string>>;
  /** person → partners, with whether the partnership is former */
  partners: Map<string, Map<string, { former: boolean }>>;
  /** recorded siblings (both ways) */
  siblings: Map<string, Set<string>>;
};

const add = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  const set = map.get(key) ?? new Set<V>();
  set.add(value);
  map.set(key, set);
};

export const buildGraph = (people: TreePerson[], relations: TreeRelation[]): FamilyGraph => {
  const graph: FamilyGraph = {
    people: new Map(people.map((person) => [person.id, person])),
    parents: new Map(),
    children: new Map(),
    partners: new Map(),
    siblings: new Map(),
  };
  for (const relation of relations) {
    const { personId: a, relatedPersonId: b } = relation;
    if (!graph.people.has(a) || !graph.people.has(b)) {
      continue;
    }
    switch (relation.type) {
      case 'parent': {
        const indirect = relation.qualifier === 'step' || relation.qualifier === 'adopted';
        const parents = graph.parents.get(b) ?? new Map<string, { indirect: boolean }>();
        parents.set(a, { indirect });
        graph.parents.set(b, parents);
        add(graph.children, a, b);
        break;
      }
      case 'spouse': {
        const former = relation.qualifier === 'former';
        for (const [x, y] of [
          [a, b],
          [b, a],
        ]) {
          const partners = graph.partners.get(x) ?? new Map<string, { former: boolean }>();
          partners.set(y, { former });
          graph.partners.set(x, partners);
        }
        break;
      }
      case 'sibling': {
        add(graph.siblings, a, b);
        add(graph.siblings, b, a);
        break;
      }
      // godparents, friends and other relations show on the person, not in the tree's shape
    }
  }
  return graph;
};

const byBirth = (graph: FamilyGraph) => (a: string, b: string) => {
  const da = graph.people.get(a)?.birthDate ?? '';
  const db = graph.people.get(b)?.birthDate ?? '';
  if (da && db && da !== db) {
    return da < db ? -1 : 1;
  }
  if (da !== db) {
    return da ? -1 : 1;
  }
  return (graph.people.get(a)?.name ?? '').localeCompare(graph.people.get(b)?.name ?? '');
};

export const parentsOf = (graph: FamilyGraph, id: string) => {
  const parents = [...(graph.parents.get(id)?.keys() ?? [])];
  // birth parents before step and adoptive ones; fathers before mothers, like most charts
  const rank = (parent: string) =>
    (graph.parents.get(id)?.get(parent)?.indirect ? 2 : 0) + (graph.people.get(parent)?.gender === 'female' ? 1 : 0);
  return parents.sort((a, b) => rank(a) - rank(b));
};

export const childrenOf = (graph: FamilyGraph, id: string) => [...(graph.children.get(id) ?? [])].sort(byBirth(graph));

export const partnersOf = (graph: FamilyGraph, id: string) =>
  [...(graph.partners.get(id)?.keys() ?? [])].sort((a, b) => {
    // current partners next to the person, former ones further out
    const fa = graph.partners.get(id)?.get(a)?.former ? 1 : 0;
    const fb = graph.partners.get(id)?.get(b)?.former ? 1 : 0;
    return fa - fb || byBirth(graph)(a, b);
  });

/** Recorded siblings plus anyone sharing a parent. */
export const siblingsOf = (graph: FamilyGraph, id: string) => {
  const siblings = new Set(graph.siblings.get(id));
  for (const parent of graph.parents.get(id)?.keys() ?? []) {
    for (const child of graph.children.get(parent) ?? []) {
      siblings.add(child);
    }
  }
  siblings.delete(id);
  return [...siblings].sort(byBirth(graph));
};

// ---------------------------------------------------------------------------------------------
// layout

export type LayoutOptions = {
  up?: number;
  down?: number;
  editable?: boolean;
  /** Pets hang from their owners: no parent, partner or child slots for them. */
  isPet?: (id: string) => boolean;
};

export const layoutTree = (graph: FamilyGraph, focusId: string, options: LayoutOptions = {}): TreeLayout => {
  const up = options.up ?? 3;
  const down = options.down ?? 2;
  const editable = options.editable ?? true;
  const isPet = options.isPet ?? (() => false);
  const tiles: TreeTile[] = [];
  const lines: TreeLine[] = [];
  const placed = new Set<string>();

  const person = (id: string, x: number, generation: number, focus = false) => {
    tiles.push({ key: `p:${id}`, kind: 'person', personId: id, x, y: generation * ROW, generation, focus });
    placed.add(id);
  };
  const slot = (addKind: AddKind, forId: string, x: number, generation: number) => {
    tiles.push({
      key: `add:${addKind}:${forId}`,
      kind: 'add',
      add: addKind,
      forId,
      x,
      y: generation * ROW,
      generation,
    });
  };
  const top = (y: number) => y - TILE.height / 2;
  /** Couple lines run between the tiles; partners beyond the first two share a side, a little lower. */
  const coupleY = (index: number) => (index < 2 ? 0 : (index - 1) * 14);
  const bottom = (y: number) => y + TILE.height / 2;

  /** The parent slots a person shows when parents are missing: father and mother, or the one missing. */
  const missingParents = (id: string): AddKind[] => {
    if (isPet(id)) {
      return [];
    }
    const parents = parentsOf(graph, id).filter((parent) => !graph.parents.get(id)?.get(parent)?.indirect);
    if (parents.length >= 2) {
      return [];
    }
    if (parents.length === 0) {
      return ['father', 'mother'];
    }
    const gender = graph.people.get(parents[0])?.gender;
    return [gender === 'male' ? 'mother' : gender === 'female' ? 'father' : 'parent'];
  };

  // ---- the wider family: aunts and uncles beside the parents, nieces and nephews under the siblings
  // (people only: a grandparent's dog isn't an aunt, a sister's cat isn't a niece)
  const focusParentIds = new Set(parentsOf(graph, focusId));
  /** A parent's brothers and sisters, shown beside them. */
  const auntsAndUncles = (parent: string) =>
    siblingsOf(graph, parent).filter(
      (sibling) => sibling !== focusId && !focusParentIds.has(sibling) && !isPet(sibling),
    );
  /** A sibling's children, shown one row under them. */
  const niecesAndNephews = (sibling: string) =>
    down > 0 ? childrenOf(graph, sibling).filter((child) => child !== focusId && !isPet(child)) : [];

  // ---- ancestors: each person's parents centred above them, widths from their own ancestry
  const unitsAbove = (id: string, depth: number, seen: Set<string>): number => {
    if (depth >= up || seen.has(id)) {
      return 1;
    }
    const parents = parentsOf(graph, id).filter((parent) => !seen.has(parent));
    const slots = editable && depth < 2 ? missingParents(id).length : 0;
    let units = slots;
    const next = new Set(seen).add(id);
    for (const parent of parents) {
      units += unitsAbove(parent, depth + 1, next);
    }
    // the focus's parents also make room for their brothers and sisters beside them
    const row = depth === 1 ? 1 + auntsAndUncles(id).length : 1;
    return Math.max(row, units);
  };

  const placeAncestors = (id: string, x: number, depth: number, seen: Set<string>, childXs: number[]) => {
    if (depth >= up || seen.has(id)) {
      return;
    }
    const parents = parentsOf(graph, id).filter((parent) => !seen.has(parent) && !placed.has(parent));
    const slots = editable && depth < 2 ? missingParents(id) : [];
    if (parents.length === 0 && slots.length === 0) {
      // brothers and sisters with no parents recorded still share a bracket above them
      if (childXs.length > 1) {
        const barY = top(-depth * ROW) - TILE.gapY / 2;
        lines.push({
          key: `bracket:${id}:${depth}`,
          points: [
            [Math.min(...childXs), barY],
            [Math.max(...childXs), barY],
          ],
          dashed: false,
        });
        for (const cx of childXs) {
          lines.push({
            key: `bracket:${id}:${cx}`,
            points: [
              [cx, barY],
              [cx, top(-depth * ROW)],
            ],
            dashed: false,
          });
        }
      }
      return;
    }
    const next = new Set(seen).add(id);
    const widths = parents.map((parent) => unitsAbove(parent, depth + 1, next));
    const total = widths.reduce((a, b) => a + b, 0) + slots.length;
    let cursor = x - (total * UNIT) / 2;
    const generation = -(depth + 1);
    const xs: number[] = [];
    const dashedXs = new Set<number>();
    for (const [index, parent] of parents.entries()) {
      const centre = cursor + (widths[index] * UNIT) / 2;
      // the focus's parents: their brothers and sisters on the outer side (the first parent's to the
      // left, the others' to the right), the group centred in the parent's share of the row
      const aunts = depth === 0 ? auntsAndUncles(parent).filter((aunt) => !placed.has(aunt)) : [];
      const outward = index === 0 && parents.length + slots.length > 1 ? -1 : 1;
      const groupLeft = centre - ((aunts.length + 1) * UNIT) / 2;
      const px = outward < 0 ? groupLeft + (aunts.length + 0.5) * UNIT : groupLeft + UNIT / 2;
      person(parent, px, generation);
      const auntXs = aunts.map((aunt, i) => {
        const ax = outward < 0 ? groupLeft + (i + 0.5) * UNIT : groupLeft + (i + 1.5) * UNIT;
        person(aunt, ax, generation);
        return ax;
      });
      xs.push(px);
      if (graph.parents.get(id)?.get(parent)?.indirect) {
        dashedXs.add(px);
      }
      cursor += widths[index] * UNIT;
      // grandparents centred over the parent and their brothers and sisters, joined to all of them
      placeAncestors(parent, aunts.length > 0 ? centre : px, depth + 1, next, [px, ...auntXs]);
    }
    for (const kind of slots) {
      const sx = cursor + UNIT / 2;
      slot(kind, id, sx, generation);
      xs.push(sx);
      cursor += UNIT;
    }
    // parents joined by a bar, with one line down to their children
    const y = generation * ROW;
    const barY = bottom(y) + TILE.gapY / 2;
    // each step or adoptive parent's own line is dashed; the line down to the child only when all are
    const indirect = parents.length > 0 && parents.every((parent) => graph.parents.get(id)?.get(parent)?.indirect);
    for (const px of xs) {
      lines.push({
        key: `up:${id}:${px}`,
        points: [
          [px, bottom(y)],
          [px, barY],
        ],
        dashed: dashedXs.has(px),
      });
    }
    const allXs = [...xs, ...childXs];
    lines.push({
      key: `bar:${id}:${depth}`,
      points: [
        [Math.min(...allXs), barY],
        [Math.max(...allXs), barY],
      ],
      dashed: false,
    });
    for (const cx of childXs) {
      lines.push({
        key: `down:${id}:${cx}`,
        points: [
          [cx, barY],
          [cx, top(y + ROW)],
        ],
        dashed: indirect,
      });
    }
  };

  // ---- the middle row: siblings, the person, partners
  // The first partner sits to the right and a second to the left, so each couple's line (and the
  // line down to their children) runs only between the two of them; any further partners go right.
  const siblings = siblingsOf(graph, focusId);
  const partners = partnersOf(graph, focusId);
  const partnerX = new Map<string, number>();
  let right = 0;
  let left = 0;
  for (const [index, partner] of partners.entries()) {
    partnerX.set(partner, index === 1 ? -++left * UNIT : ++right * UNIT);
  }
  person(focusId, 0, 0, true);
  for (const [index, partner] of partners.entries()) {
    const px = partnerX.get(partner)!;
    person(partner, px, 0);
    const former = graph.partners.get(focusId)?.get(partner)?.former ?? false;
    const y = coupleY(index);
    const from = px > 0 ? TILE.width / 2 : -TILE.width / 2;
    const to = px > 0 ? px - TILE.width / 2 : px + TILE.width / 2;
    lines.push({
      key: `couple:${partner}`,
      points: [
        [from, y],
        [to, y],
      ],
      dashed: former,
    });
  }
  // an empty slot only when there's no partner yet; otherwise partners are added from the panel
  if (editable && partners.length === 0 && !isPet(focusId)) {
    slot('partner', focusId, UNIT, 0);
  }

  // ---- the focus's children, planned now (placed further down) so the siblings' children can sit
  // clear of them: grouped by the other parent, each group under its couple
  const unitsBelow = (id: string, depth: number, seen: Set<string>): number => {
    if (depth >= down || seen.has(id)) {
      return 1;
    }
    const next = new Set(seen).add(id);
    const kids = childrenOf(graph, id).filter((child) => !seen.has(child));
    return Math.max(
      1,
      kids.reduce((sum, child) => sum + unitsBelow(child, depth + 1, next), 0),
    );
  };
  const focusKids = down > 0 ? childrenOf(graph, focusId) : [];
  const kidGroups: Array<{ anchor: number; startY: number; kids: string[]; left: number; width: number }> = [];
  {
    const remaining = new Set(focusKids);
    const partnerGroups: Array<{ anchor: number; startY: number; kids: string[] }> = [];
    for (const [index, partner] of partners.entries()) {
      const shared = focusKids.filter((kid) => graph.parents.get(kid)?.has(partner));
      for (const kid of shared) remaining.delete(kid);
      if (shared.length > 0) {
        partnerGroups.push({ anchor: partnerX.get(partner)! / 2, startY: coupleY(index), kids: shared });
      }
    }
    const groups = [
      ...(remaining.size > 0 ? [{ anchor: 0, startY: TILE.height / 2, kids: [...remaining] }] : []),
      ...partnerGroups,
    ].sort((a, b) => a.anchor - b.anchor);
    // groups side by side without overlapping, each as close to its parents as it can be
    let lastRight = -Infinity;
    for (const group of groups) {
      const width = group.kids.reduce((sum, kid) => sum + unitsBelow(kid, 1, new Set([focusId])), 0);
      if (width === 0) {
        continue;
      }
      const groupLeft = Math.max(group.anchor - (width * UNIT) / 2, lastRight);
      kidGroups.push({ ...group, left: groupLeft, width });
      lastRight = groupLeft + width * UNIT;
    }
  }
  const kidsLeft = kidGroups.length > 0 ? kidGroups[0].left : Infinity;

  // ---- siblings to the left, nearest first, each with room under them for their children
  const nieces = new Map(siblings.map((sibling) => [sibling, niecesAndNephews(sibling)]));
  const anyNieces = siblings.some((sibling) => (nieces.get(sibling)?.length ?? 0) > 0);
  let siblingRight = -left * UNIT - UNIT / 2;
  if (anyNieces) {
    siblingRight = Math.min(siblingRight, kidsLeft - TILE.gapX);
  }
  for (const sibling of [...siblings].reverse()) {
    const width = Math.max(1, nieces.get(sibling)!.length);
    person(sibling, siblingRight - (width * UNIT) / 2, 0);
    siblingRight -= width * UNIT;
  }

  // Full siblings (the same birth parents, or recorded siblings with no parents recorded) hang from
  // the parents' bar; half-siblings hang from their own line from the parent they share.
  const xOf = (id: string) => tiles.find((tile) => tile.kind === 'person' && tile.personId === id)?.x;
  const birthParents = (id: string) =>
    new Set(parentsOf(graph, id).filter((parent) => !graph.parents.get(id)?.get(parent)?.indirect));
  const focusParents = birthParents(focusId);
  const full: string[] = [];
  const half: string[] = [];
  for (const sibling of siblings) {
    const theirs = birthParents(sibling);
    // not Set#intersection: relatives' older browsers (e.g. Chrome 109) don't have it
    // eslint-disable-next-line unicorn/prefer-set-methods
    const shared = [...theirs].filter((parent) => focusParents.has(parent));
    if (shared.length > 0 && shared.length === focusParents.size && theirs.size === focusParents.size) {
      full.push(sibling);
    } else if (shared.length > 0) {
      half.push(sibling);
    } else if (theirs.size === 0 && focusParents.size > 0) {
      full.push(sibling);
    }
  }
  placeAncestors(focusId, 0, 0, new Set(), [0, ...full.map((sibling) => xOf(sibling)!)]);

  const halfBarY = top(0) - TILE.gapY / 2 + 12;
  for (const parent of focusParents) {
    const px = xOf(parent);
    const theirs = half.filter((sibling) => birthParents(sibling).has(parent));
    if (px === undefined || theirs.length === 0) {
      continue;
    }
    const xs = theirs.map((sibling) => xOf(sibling)!);
    lines.push(
      {
        key: `half:${parent}`,
        points: [
          [px - 14, bottom(-ROW)],
          [px - 14, halfBarY],
          [Math.min(...xs), halfBarY],
        ],
        dashed: false,
      },
      ...xs.map((sx) => ({
        key: `half:${parent}:${sx}`,
        points: [
          [sx, halfBarY],
          [sx, top(0)],
        ] as Array<[number, number]>,
        dashed: false,
      })),
    );
  }

  // ---- descendants: children grouped by their other parent, under that couple

  /**
  Children centred on `centerX` one row below `parentY`, hanging from a bar. `stem` is the line
  from the parent (or couple) to the bar; by default straight down from the parent tile.
  */
  const placeChildren = (
    kids: string[],
    centerX: number,
    parentY: number,
    depth: number,
    seen: Set<string>,
    stem?: Array<[number, number]>,
    /** False for nieces and nephews: just them, not their children. */
    descend = true,
  ) => {
    const fresh = kids.filter((kid) => !placed.has(kid));
    const next = new Set(seen);
    const widths = fresh.map((kid) => (descend ? unitsBelow(kid, depth, next) : 1));
    const total = widths.reduce((a, b) => a + b, 0);
    if (total === 0) {
      return;
    }
    let cursor = centerX - (total * UNIT) / 2;
    const generation = depth;
    const xs: number[] = [];
    for (const [index, kid] of fresh.entries()) {
      const kx = cursor + (widths[index] * UNIT) / 2;
      person(kid, kx, generation);
      xs.push(kx);
      cursor += widths[index] * UNIT;
      if (descend && depth < down) {
        placeChildren(childrenOf(graph, kid), kx, generation * ROW, depth + 1, new Set(next).add(kid));
      }
    }
    const barY = bottom(parentY) + TILE.gapY / 2;
    lines.push(
      {
        key: `stem:${centerX}:${parentY}`,
        points: stem ?? [
          [centerX, bottom(parentY)],
          [centerX, barY],
        ],
        dashed: false,
      },
      {
        key: `kidsbar:${centerX}:${parentY}`,
        points: [
          [Math.min(centerX, ...xs), barY],
          [Math.max(centerX, ...xs), barY],
        ],
        dashed: false,
      },
    );
    for (const kx of xs) {
      lines.push({
        key: `kid:${kx}:${parentY}`,
        points: [
          [kx, barY],
          [kx, top(generation * ROW)],
        ],
        dashed: false,
      });
    }
  };

  if (down > 0) {
    const kids = focusKids;
    const barY = TILE.height / 2 + TILE.gapY / 2;
    const elbowY = TILE.height / 2 + TILE.gapY / 4;
    for (const group of kidGroups) {
      const { left, width } = group;
      const center = left + (width * UNIT) / 2;
      const stem: Array<[number, number]> =
        center === group.anchor
          ? [
              [group.anchor, group.startY],
              [group.anchor, barY],
            ]
          : [
              [group.anchor, group.startY],
              [group.anchor, elbowY],
              [center, elbowY],
              [center, barY],
            ];
      placeChildren(group.kids, center, 0, 1, new Set([focusId]), stem);
    }
    // the siblings' children, one row under each sibling
    for (const sibling of siblings) {
      const sx = xOf(sibling);
      const theirs = nieces.get(sibling) ?? [];
      if (sx !== undefined && theirs.length > 0) {
        placeChildren(theirs, sx, 0, 1, new Set([focusId, sibling]), undefined, false);
      }
    }
    // an empty slot only when there are no children yet; otherwise children are added from the panel
    if (editable && kids.length === 0 && !isPet(focusId)) {
      slot('child', focusId, 0, 1);
      lines.push({
        key: 'add-child',
        points: [
          [0, bottom(0)],
          [0, top(ROW)],
        ],
        dashed: false,
      });
    }
  }

  // ---- bounds, for Fit
  const xs = tiles.map((tile) => tile.x);
  const ys = tiles.map((tile) => tile.y);
  return {
    tiles,
    lines,
    bounds: {
      minX: Math.min(...xs) - TILE.width / 2,
      maxX: Math.max(...xs) + TILE.width / 2,
      minY: Math.min(...ys) - TILE.height / 2,
      maxY: Math.max(...ys) + TILE.height / 2,
    },
  };
};

/** Neighbours for keyboard navigation: up = a parent, down = a child, left/right = along the row. */
export const neighbour = (layout: TreeLayout, fromId: string, direction: 'up' | 'down' | 'left' | 'right') => {
  const people = layout.tiles.filter((tile): tile is Extract<TreeTile, { kind: 'person' }> => tile.kind === 'person');
  const from = people.find((tile) => tile.personId === fromId);
  if (!from) {
    return null;
  }
  const generation = from.generation + (direction === 'up' ? -1 : direction === 'down' ? 1 : 0);
  const candidates = people.filter((tile) => tile.generation === generation && tile.personId !== fromId);
  const side =
    direction === 'left'
      ? candidates.filter((tile) => tile.x < from.x)
      : direction === 'right'
        ? candidates.filter((tile) => tile.x > from.x)
        : candidates;
  side.sort((a, b) => Math.abs(a.x - from.x) - Math.abs(b.x - from.x));
  return side[0]?.personId ?? null;
};
