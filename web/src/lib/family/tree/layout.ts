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
  parents: Map<string, Map<string, { indirect: boolean; step?: boolean }>>;
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
        const parents = graph.parents.get(b) ?? new Map<string, { indirect: boolean; step?: boolean }>();
        parents.set(a, { indirect, step: relation.qualifier === 'step' });
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
    // one tile per person: the page keys tiles by person, and a second one would crash the keyed each
    if (placed.has(id)) {
      return;
    }
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
  const placedTile = (id: string) =>
    tiles.find((tile): tile is Extract<TreeTile, { kind: 'person' }> => tile.kind === 'person' && tile.personId === id);
  const top = (y: number) => y - TILE.height / 2;
  /** Couple lines run between the tiles; partners beyond the first two share a side, a little lower. */
  const coupleY = (index: number) => (index < 2 ? 0 : (index - 1) * 14);
  const bottom = (y: number) => y + TILE.height / 2;

  /** The parent slots a person shows when parents are missing: father and mother, or the one missing. */
  const missingParents = (id: string): AddKind[] => {
    if (isPet(id)) {
      return [];
    }
    // a parent slot is taken by a birth or adoptive parent, as the server counts them; only step-parents
    // leave it free
    const parents = parentsOf(graph, id).filter((parent) => !graph.parents.get(id)?.get(parent)?.step);
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
  /** A sibling's stepchildren (their partner's children): step-nieces and step-nephews, also shown. */
  const stepNieces = (sibling: string) =>
    down > 0
      ? partnersOf(graph, sibling)
          .filter((partner) => !graph.partners.get(sibling)?.get(partner)?.former)
          .flatMap((partner) => childrenOf(graph, partner))
          .filter((child) => child !== focusId && !isPet(child) && !graph.parents.get(child)?.has(sibling))
      : [];
  /** Everyone shown under a sibling: their children, then their stepchildren (drawn dashed). */
  const underSibling = (sibling: string) => [...new Set([...niecesAndNephews(sibling), ...stepNieces(sibling)])];

  /** An ancestor's current partners who aren't also the child's parents: step-parents, step-grandparents. */
  const stepPartners = (ancestor: string, child: string) =>
    partnersOf(graph, ancestor).filter(
      (partner) =>
        !graph.partners.get(ancestor)?.get(partner)?.former &&
        !graph.parents.get(child)?.has(partner) &&
        partner !== focusId &&
        !isPet(partner),
    );
  /** Step-parents of the focus, placed with the parents, and where: their own children join the middle row. */
  const stepParentsPlaced: Array<{ id: string; x: number; side: -1 | 1 }> = [];

  // ---- ancestors: each person's parents centred above them, widths from their own ancestry
  const unitsAbove = (id: string, depth: number, seen: Set<string>, child?: string): number => {
    if (depth >= up || seen.has(id)) {
      return 1;
    }
    const parents = parentsOf(graph, id).filter((parent) => !seen.has(parent));
    const slots = editable && depth < 2 ? missingParents(id).length : 0;
    let units = slots;
    const next = new Set(seen).add(id);
    for (const parent of parents) {
      units += unitsAbove(parent, depth + 1, next, id);
    }
    // room beside them for their other partners (step-parents), and, for the focus's parents, their
    // brothers and sisters
    const row = 1 + (child ? stepPartners(id, child).length : 0) + (depth === 1 ? auntsAndUncles(id).length : 0);
    return Math.max(row, units);
  };

  const placeAncestors = (id: string, x: number, depth: number, seen: Set<string>, childXs: number[]) => {
    if (depth >= up || seen.has(id)) {
      return;
    }
    const generation = -(depth + 1);
    const allParents = parentsOf(graph, id).filter((parent) => !seen.has(parent));
    // a parent already placed by another branch (a shared grandparent) keeps their tile, and this
    // child's edge to them is still drawn, when they sit in the same row
    const sharedTiles = allParents
      .map((parent) => ({ parent, tile: placedTile(parent) }))
      .filter(({ tile }) => tile?.generation === generation)
      .map(({ parent, tile }) => ({ parent, x: tile!.x }));
    const parents = allParents.filter((parent) => !placed.has(parent));
    const slots = editable && depth < 2 ? missingParents(id) : [];
    if (parents.length === 0 && slots.length === 0 && sharedTiles.length === 0) {
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
    const widths = parents.map((parent) => unitsAbove(parent, depth + 1, next, id));
    const total = widths.reduce((a, b) => a + b, 0) + slots.length;
    let cursor = x - (total * UNIT) / 2;
    const xs: number[] = [];
    const dashedXs = new Set<number>();
    for (const [index, parent] of parents.entries()) {
      const centre = cursor + (widths[index] * UNIT) / 2;
      // the focus's parents: their brothers and sisters on the outer side (the first parent's to the
      // left, the others' to the right), the group centred in the parent's share of the row
      const aunts = depth === 0 ? auntsAndUncles(parent).filter((aunt) => !placed.has(aunt)) : [];
      // their other current partners (step-parents) right beside them, then their brothers and sisters
      const steps = stepPartners(parent, id).filter((partner) => !placed.has(partner) && !aunts.includes(partner));
      const outward = index === 0 && parents.length + slots.length > 1 ? -1 : 1;
      const group = outward < 0 ? [...aunts, ...[...steps].reverse(), parent] : [parent, ...steps, ...aunts];
      const groupLeft = centre - (group.length * UNIT) / 2;
      const xOfMember = (member: string) => groupLeft + (group.indexOf(member) + 0.5) * UNIT;
      const px = xOfMember(parent);
      person(parent, px, generation);
      const auntXs = aunts.map((aunt) => {
        const ax = xOfMember(aunt);
        person(aunt, ax, generation);
        return ax;
      });
      for (const [i, step] of steps.entries()) {
        const sx = xOfMember(step);
        person(step, sx, generation);
        // a couple line at mid height, each further partner a little lower
        const lineY = generation * ROW + i * 14;
        lines.push({
          key: `step-couple:${parent}:${step}`,
          points: [
            [px + (outward * TILE.width) / 2, lineY],
            [sx - (outward * TILE.width) / 2, lineY],
          ],
          dashed: false,
        });
        if (depth === 0) {
          stepParentsPlaced.push({ id: step, x: sx, side: outward < 0 ? -1 : 1 });
        }
      }
      xs.push(px);
      if (graph.parents.get(id)?.get(parent)?.indirect) {
        dashedXs.add(px);
      }
      cursor += widths[index] * UNIT;
      // grandparents centred over the parent's share of the row, joined to the parent and their brothers and sisters
      placeAncestors(parent, group.length > 1 ? centre : px, depth + 1, next, [px, ...auntXs]);
    }
    for (const { parent, x: sharedX } of sharedTiles) {
      xs.push(sharedX);
      if (graph.parents.get(id)?.get(parent)?.indirect) {
        dashedXs.add(sharedX);
      }
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
    const drawn = [...parents, ...sharedTiles.map(({ parent }) => parent)];
    const indirect = drawn.length > 0 && drawn.every((parent) => graph.parents.get(id)?.get(parent)?.indirect);
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
  const partners = partnersOf(graph, focusId);
  // someone recorded as both a partner and a sibling is shown once, as the partner
  const siblings = siblingsOf(graph, focusId).filter((sibling) => !partners.includes(sibling));
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
  // the focus's children, and their current partners' children too (stepchildren, drawn dashed)
  const ownKids = down > 0 ? childrenOf(graph, focusId) : [];
  const stepKids =
    down > 0
      ? partners
          .filter((partner) => !graph.partners.get(focusId)?.get(partner)?.former)
          .flatMap((partner) => childrenOf(graph, partner))
          .filter((kid) => kid !== focusId && !isPet(kid) && !ownKids.includes(kid))
      : [];
  const focusKids = [...ownKids, ...new Set(stepKids)];
  const dashedFocusKids = new Set(stepKids);
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
  const nieces = new Map(siblings.map((sibling) => [sibling, underSibling(sibling)]));
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

  // ---- the partner's brothers and sisters to the right of the partner (the current partner on the
  // right), each with their children and stepchildren under them: nieces and nephews by marriage
  const kidsRight = kidGroups.length > 0 ? kidGroups.at(-1)!.left + kidGroups.at(-1)!.width * UNIT : -Infinity;
  const partnerSide = partners.find((partner) => (partnerX.get(partner) ?? 0) > 0 && !isPet(partner));
  const inLawSiblings = partnerSide
    ? siblingsOf(graph, partnerSide).filter((sibling) => sibling !== focusId && !placed.has(sibling) && !isPet(sibling))
    : [];
  for (const sibling of inLawSiblings) {
    nieces.set(
      sibling,
      underSibling(sibling).filter((kid) => !placed.has(kid)),
    );
  }
  if (partnerSide && inLawSiblings.length > 0) {
    const rowRight = Math.max(...tiles.filter((t) => t.generation === 0).map((t) => t.x)) + UNIT / 2;
    const anyInLawNieces = inLawSiblings.some((sibling) => (nieces.get(sibling)?.length ?? 0) > 0);
    let inLawLeft = anyInLawNieces ? Math.max(rowRight, kidsRight + TILE.gapX) : rowRight;
    const inLawXs: number[] = [];
    for (const sibling of inLawSiblings) {
      const width = Math.max(1, nieces.get(sibling)!.length);
      const sx = inLawLeft + (width * UNIT) / 2;
      person(sibling, sx, 0);
      inLawXs.push(sx);
      inLawLeft += width * UNIT;
    }
    // the partner and their brothers and sisters share a bracket just above them
    const px = partnerX.get(partnerSide)!;
    const bracketY = top(0) - 12;
    lines.push({
      key: `inlaw-bracket:${partnerSide}`,
      points: [
        [px, bracketY],
        [Math.max(...inLawXs), bracketY],
      ],
      dashed: false,
    });
    for (const x of [px, ...inLawXs]) {
      lines.push({
        key: `inlaw-drop:${partnerSide}:${x}`,
        points: [
          [x, bracketY],
          [x, top(0)],
        ],
        dashed: false,
      });
    }
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

  // ---- step-siblings: a step-parent's own children, at the end of the middle row on that
  // step-parent's side, hanging from their own line
  const rowZero = () => tiles.filter((t) => t.generation === 0).map((t) => t.x);
  // Bars between the rows sit 12px apart so none runs close to another: step-siblings -48, the
  // parents' bar -36, half-siblings -24 and the partner's siblings -12 (from the top of the tiles).
  const stepBarY = top(0) - TILE.gapY / 2 - 12;
  for (const { id: stepParent, x: spx, side } of stepParentsPlaced) {
    const theirs = childrenOf(graph, stepParent).filter((kid) => kid !== focusId && !placed.has(kid) && !isPet(kid));
    if (theirs.length === 0) {
      continue;
    }
    const edge = side < 0 ? Math.min(...rowZero()) : Math.max(...rowZero());
    const kidXs = theirs.map((kid, i) => {
      const kx = edge + side * (i + 1) * UNIT;
      person(kid, kx, 0);
      return kx;
    });
    lines.push(
      {
        key: `step-kids:${stepParent}`,
        points: [
          [spx, bottom(-ROW)],
          [spx, stepBarY],
          [side < 0 ? Math.min(...kidXs) : Math.max(...kidXs), stepBarY],
        ],
        dashed: false,
      },
      ...kidXs.map((kx) => ({
        key: `step-kid:${stepParent}:${kx}`,
        points: [
          [kx, stepBarY],
          [kx, top(0)],
        ] as Array<[number, number]>,
        dashed: false,
      })),
    );
  }

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
    /** Stepchildren, whose lines are dashed. */
    dashedKids: Set<string> = new Set(),
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
    for (const [index, kx] of xs.entries()) {
      lines.push({
        key: `kid:${kx}:${parentY}`,
        points: [
          [kx, barY],
          [kx, top(generation * ROW)],
        ],
        dashed: dashedKids.has(fresh[index]),
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
      placeChildren(group.kids, center, 0, 1, new Set([focusId]), stem, true, dashedFocusKids);
    }
    // the siblings' (and the partner's siblings') children, one row under each; stepchildren dashed
    for (const sibling of [...siblings, ...inLawSiblings]) {
      const sx = xOf(sibling);
      const theirs = nieces.get(sibling) ?? [];
      if (sx === undefined || theirs.length === 0) {
        continue;
      }
      const steps = new Set(theirs.filter((kid) => !graph.parents.get(kid)?.has(sibling)));
      placeChildren(theirs, sx, 0, 1, new Set([focusId, sibling]), undefined, false, steps);
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
