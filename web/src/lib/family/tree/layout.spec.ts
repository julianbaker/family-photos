import { TILE, buildGraph, layoutTree, neighbour, type TreeLayout, type TreeRelation } from './layout';

const people = (...names: Array<[string, string?, string?]>) =>
  names.map(([id, gender, birthDate]) => ({ id, name: id, gender: gender ?? null, birthDate: birthDate ?? null }));

let nextId = 0;
const parent = (parentId: string, childId: string, qualifier: string | null = null): TreeRelation => ({
  id: `r${nextId++}`,
  personId: parentId,
  relatedPersonId: childId,
  type: 'parent',
  qualifier,
});
/** Carl's partners: the test family's only marriages. */
const carlMarried = (partner: string, qualifier: string | null = null): TreeRelation => ({
  id: `r${nextId++}`,
  personId: 'Carl',
  relatedPersonId: partner,
  type: 'spouse',
  qualifier,
});

const tile = (layout: TreeLayout, id: string) => {
  const found = layout.tiles.find((t) => t.kind === 'person' && t.personId === id);
  if (!found) {
    throw new Error(`${id} is not in the tree`);
  }
  return found;
};
const slots = (layout: TreeLayout) =>
  layout.tiles.filter((t) => t.kind === 'add').map((t) => (t.kind === 'add' ? `${t.add}:${t.forId}` : ''));

/** No two tiles in the same row may overlap. */
const expectNoOverlaps = (layout: TreeLayout) => {
  const rows = new Map<number, number[]>();
  for (const t of layout.tiles) {
    rows.set(t.generation, [...(rows.get(t.generation) ?? []), t.x]);
  }
  for (const xs of rows.values()) {
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(TILE.width);
    }
  }
};

// A four-generation family: Ada and Bert's son Carl married Dora, then (after divorce) Erin.
// Carl and Dora had Fay and Gus; Carl and Erin had Hal; Fay has a daughter Ivy.
const family = () => {
  const ppl = people(
    ['Ada', 'female', '1920-01-01'],
    ['Bert', 'male', '1918-01-01'],
    ['Carl', 'male', '1950-01-01'],
    ['Cleo', 'female', '1952-01-01'],
    ['Dora', 'female', '1951-01-01'],
    ['Erin', 'female', '1960-01-01'],
    ['Fay', 'female', '1975-01-01'],
    ['Gus', 'male', '1978-01-01'],
    ['Hal', 'male', '1990-01-01'],
    ['Ivy', 'female', '2005-01-01'],
    ['Stan', 'male', '1949-01-01'],
  );
  const rels = [
    parent('Ada', 'Carl'),
    parent('Bert', 'Carl'),
    parent('Ada', 'Cleo'),
    parent('Bert', 'Cleo'),
    carlMarried('Dora', 'former'),
    carlMarried('Erin'),
    parent('Carl', 'Fay'),
    parent('Dora', 'Fay'),
    parent('Carl', 'Gus'),
    parent('Dora', 'Gus'),
    parent('Carl', 'Hal'),
    parent('Erin', 'Hal'),
    parent('Fay', 'Ivy'),
    parent('Stan', 'Fay', 'step'),
  ];
  return buildGraph(ppl, rels);
};

describe('family tree layout', () => {
  it('asks for both parents when someone has none, and a partner and a child', () => {
    const layout = layoutTree(buildGraph(people(['Solo']), []), 'Solo');
    expect(tile(layout, 'Solo')).toEqual(expect.objectContaining({ x: 0, y: 0, focus: true }));
    expect(slots(layout).sort()).toEqual(['child:Solo', 'father:Solo', 'mother:Solo', 'partner:Solo']);
    expectNoOverlaps(layout);
  });

  it('puts parents above, siblings to the left and the partners on either side', () => {
    const layout = layoutTree(family(), 'Carl');
    const carl = tile(layout, 'Carl');
    expect(tile(layout, 'Ada').y).toBeLessThan(carl.y);
    expect(tile(layout, 'Bert').y).toBe(tile(layout, 'Ada').y);
    // parents centred over Carl
    expect((tile(layout, 'Ada').x + tile(layout, 'Bert').x) / 2).toBeCloseTo(carl.x);
    // the current partner (Erin) right next to him, the former one (Dora) on the other side
    expect(tile(layout, 'Erin').x).toBeGreaterThan(carl.x);
    expect(tile(layout, 'Dora').x).toBeLessThan(carl.x);
    // his sister beyond Dora on the left
    expect(tile(layout, 'Cleo').x).toBeLessThan(tile(layout, 'Dora').x);
    expect(tile(layout, 'Cleo').y).toBe(carl.y);
    // no "add parent" slots: Carl has both parents
    expect(slots(layout)).not.toContain('father:Carl');
    expectNoOverlaps(layout);
  });

  it("keeps each partner's children together under that couple", () => {
    const layout = layoutTree(family(), 'Carl');
    const doraKids = [tile(layout, 'Fay').x, tile(layout, 'Gus').x];
    const hal = tile(layout, 'Hal').x;
    // Dora is on the left, Erin on the right: Dora's children left of Erin's
    expect(Math.max(...doraKids)).toBeLessThan(hal);
    expect(tile(layout, 'Fay').y).toBeGreaterThan(tile(layout, 'Carl').y);
    // grandchildren a row further down
    expect(tile(layout, 'Ivy').y).toBeGreaterThan(tile(layout, 'Fay').y);
    expectNoOverlaps(layout);
  });

  it('draws step and adopted parent links dashed, and former partners dashed', () => {
    const fay = layoutTree(family(), 'Fay');
    const dashed = fay.lines.filter((line) => line.dashed);
    expect(dashed.length).toBeGreaterThan(0);
    const carlFay = layoutTree(family(), 'Carl');
    const couples = carlFay.lines.filter((line) => line.key.startsWith('couple:'));
    expect(couples.find((line) => line.key === 'couple:Dora')?.dashed).toBe(true);
    expect(couples.find((line) => line.key === 'couple:Erin')?.dashed).toBe(false);
  });

  it('draws half-siblings from the parent they share, not from both parents', () => {
    // Hal is Carl and Erin's son; Fay and Gus are Carl and Dora's
    const layout = layoutTree(family(), 'Hal');
    const half = layout.lines.filter((line) => line.key.startsWith('half:'));
    expect(half.length).toBeGreaterThan(0);
    // the parents' lines go down to Hal only; Fay and Gus are reached by their own line
    const downs = layout.lines.filter((line) => line.key.startsWith('down:Hal:'));
    const downXs = downs.map((line) => line.points[0][0]);
    expect(downXs).toEqual([tile(layout, 'Hal').x]);
    for (const sibling of ['Fay', 'Gus']) {
      const x = tile(layout, sibling).x;
      expect(half.some((line) => line.points.some(([px]) => px === x))).toBe(true);
    }
  });

  it('only shows add slots where something is missing', () => {
    // Carl has parents, partners and children: nothing to add for him in the tree itself
    const carl = layoutTree(family(), 'Carl');
    expect(slots(carl).filter((slot) => slot.endsWith(':Carl'))).toEqual([]);
    // his parents have no parents recorded, so those slots show
    expect(slots(carl)).toEqual(expect.arrayContaining(['father:Bert', 'mother:Bert']));
    const ivy = layoutTree(family(), 'Ivy');
    expect(slots(ivy).sort()).toEqual(['child:Ivy', 'father:Ivy', 'partner:Ivy']);
  });

  it('shows great-grandparents three generations up, no further', () => {
    const layout = layoutTree(family(), 'Ivy');
    expect(tile(layout, 'Fay').generation).toBe(-1);
    expect(tile(layout, 'Carl').generation).toBe(-2);
    expect(tile(layout, 'Ada').generation).toBe(-3);
    expectNoOverlaps(layout);
  });

  it('offers only the missing parent when one is known', () => {
    const layout = layoutTree(buildGraph(people(['Kid'], ['Mum', 'female']), [parent('Mum', 'Kid')]), 'Kid');
    expect(slots(layout)).toContain('father:Kid');
    expect(slots(layout)).not.toContain('mother:Kid');
  });

  it('hides the add slots when the viewer cannot edit', () => {
    const layout = layoutTree(buildGraph(people(['Solo']), []), 'Solo', { editable: false });
    expect(slots(layout)).toEqual([]);
  });

  it('moves between relatives with the arrow keys', () => {
    const layout = layoutTree(family(), 'Carl');
    expect(['Ada', 'Bert']).toContain(neighbour(layout, 'Carl', 'up'));
    expect(['Fay', 'Gus', 'Hal']).toContain(neighbour(layout, 'Carl', 'down'));
    expect(neighbour(layout, 'Carl', 'right')).toBe('Erin');
    expect(neighbour(layout, 'Carl', 'left')).toBe('Dora');
  });
});

describe('the wider family', () => {
  it("shows a parent's brothers and sisters beside them, on the outer side", () => {
    // Fay's father Carl has a sister, Cleo
    const layout = layoutTree(family(), 'Fay');
    const carl = tile(layout, 'Carl');
    const cleo = tile(layout, 'Cleo');
    expect(cleo.generation).toBe(carl.generation);
    // Carl is the first parent, so his sister goes to his left, away from Dora
    expect(cleo.x).toBeLessThan(carl.x);
    expect(tile(layout, 'Dora').x).toBeGreaterThan(carl.x);
    // and joined to their parents, Ada and Bert, above them
    expect(tile(layout, 'Ada').generation).toBe(carl.generation - 1);
    expectNoOverlaps(layout);
  });

  it("shows a sibling's children one row under them, clear of the person's own children", () => {
    // Gus's sister Fay has a daughter, Ivy
    const layout = layoutTree(family(), 'Gus');
    const fay = tile(layout, 'Fay');
    const ivy = tile(layout, 'Ivy');
    expect(ivy.generation).toBe(fay.generation + 1);
    expect(ivy.x).toBeCloseTo(fay.x);
    expectNoOverlaps(layout);
  });

  it("keeps nieces and nephews left of the person's own children", () => {
    const graph = buildGraph(
      people(
        ['Mum', 'female'],
        ['Me', 'male', '1990-01-01'],
        ['Sis', 'female', '1988-01-01'],
        ['N1'],
        ['N2'],
        ['K1'],
        ['K2'],
        ['K3'],
      ),
      [
        parent('Mum', 'Me'),
        parent('Mum', 'Sis'),
        parent('Sis', 'N1'),
        parent('Sis', 'N2'),
        parent('Me', 'K1'),
        parent('Me', 'K2'),
        parent('Me', 'K3'),
      ],
    );
    const layout = layoutTree(graph, 'Me');
    const kidsLeft = Math.min(...['K1', 'K2', 'K3'].map((id) => tile(layout, id).x));
    for (const niece of ['N1', 'N2']) {
      expect(tile(layout, niece).generation).toBe(1);
      expect(tile(layout, niece).x).toBeLessThan(kidsLeft);
    }
    expectNoOverlaps(layout);
  });

  it("puts a parent's new partner beside them, and that step-parent's own children in the middle row", () => {
    // Fay's father Carl is now with Erin: Erin is Fay's stepmother
    const layout = layoutTree(family(), 'Fay');
    const erin = tile(layout, 'Erin');
    expect(erin.generation).toBe(tile(layout, 'Carl').generation);
    expect(Math.abs(erin.x - tile(layout, 'Carl').x)).toBe(TILE.width + TILE.gapX);
    expectNoOverlaps(layout);

    // Me's mum married Steve, who has a daughter Sara from before: Sara is Me's stepsister
    const graph = buildGraph(
      people(['Dad', 'male'], ['Mum', 'female'], ['Me', 'male'], ['Steve', 'male'], ['Sara', 'female']),
      [
        parent('Dad', 'Me'),
        parent('Mum', 'Me'),
        { id: 's1', personId: 'Mum', relatedPersonId: 'Steve', type: 'spouse', qualifier: null },
        parent('Steve', 'Sara'),
      ],
    );
    const steps = layoutTree(graph, 'Me');
    expect(tile(steps, 'Steve').generation).toBe(-1);
    // Mum is the second parent, so Steve and his daughter are on the right
    expect(tile(steps, 'Steve').x).toBeGreaterThan(tile(steps, 'Mum').x);
    expect(tile(steps, 'Sara').generation).toBe(0);
    expect(tile(steps, 'Sara').x).toBeGreaterThan(tile(steps, 'Me').x);
    expectNoOverlaps(steps);
  });

  it("shows the partner's brothers and sisters with their children and stepchildren", () => {
    const graph = buildGraph(
      people(
        ['Me', 'male'],
        ['Kate', 'female'],
        ['Laura', 'female'],
        ['Chris', 'male'],
        ['Jill', 'female'],
        ['Zane', 'male'],
        ['Kid'],
      ),
      [
        { id: 'k1', personId: 'Me', relatedPersonId: 'Kate', type: 'spouse', qualifier: null },
        { id: 'k2', personId: 'Kate', relatedPersonId: 'Laura', type: 'sibling', qualifier: null },
        { id: 'k3', personId: 'Laura', relatedPersonId: 'Chris', type: 'spouse', qualifier: null },
        parent('Laura', 'Jill'),
        parent('Chris', 'Jill'),
        parent('Chris', 'Zane'),
        parent('Me', 'Kid'),
        parent('Kate', 'Kid'),
      ],
    );
    const layout = layoutTree(graph, 'Me');
    const laura = tile(layout, 'Laura');
    expect(laura.generation).toBe(0);
    expect(laura.x).toBeGreaterThan(tile(layout, 'Kate').x);
    for (const id of ['Jill', 'Zane']) {
      expect(tile(layout, id).generation).toBe(1);
      expect(tile(layout, id).x).toBeGreaterThan(tile(layout, 'Kid').x);
    }
    // Zane is Laura's stepson: his line is dashed
    const zaneLine = layout.lines.find((line) => line.points.at(-1)?.[0] === tile(layout, 'Zane').x && line.dashed);
    expect(zaneLine).toBeDefined();
    expectNoOverlaps(layout);
  });

  it("shows a partner's children as stepchildren under the couple, with dashed lines", () => {
    const graph = buildGraph(people(['Laura', 'female'], ['Chris', 'male'], ['Jill', 'female'], ['Zane', 'male']), [
      { id: 'c1', personId: 'Laura', relatedPersonId: 'Chris', type: 'spouse', qualifier: null },
      parent('Laura', 'Jill'),
      parent('Chris', 'Jill'),
      parent('Chris', 'Zane'),
    ]);
    const layout = layoutTree(graph, 'Laura');
    expect(tile(layout, 'Zane').generation).toBe(1);
    expect(tile(layout, 'Jill').generation).toBe(1);
    const zaneX = tile(layout, 'Zane').x;
    expect(layout.lines.some((line) => line.dashed && line.points.at(-1)?.[0] === zaneX)).toBe(true);
    const jillX = tile(layout, 'Jill').x;
    expect(layout.lines.some((line) => line.dashed && line.points.at(-1)?.[0] === jillX)).toBe(false);
    expectNoOverlaps(layout);
  });

  it('leaves pets out of the wider family', () => {
    const graph = buildGraph(
      people(['Gran', 'female'], ['Dad', 'male'], ['Me', 'male'], ['Rex'], ['Sis', 'female'], ['Cat']),
      [parent('Gran', 'Dad'), parent('Gran', 'Rex'), parent('Dad', 'Me'), parent('Dad', 'Sis'), parent('Sis', 'Cat')],
    );
    const layout = layoutTree(graph, 'Me', { isPet: (id) => id === 'Rex' || id === 'Cat' });
    const shown = layout.tiles.filter((t) => t.kind === 'person').map((t) => (t.kind === 'person' ? t.personId : ''));
    expect(shown).not.toContain('Rex');
    expect(shown).not.toContain('Cat');
  });
});

describe('pets', () => {
  it('gives a pet no parent, partner or child slots, and no lines to empty slots', () => {
    const graph = buildGraph(people(['Ann', 'female'], ['Rex']), [parent('Ann', 'Rex')]);
    const isPet = (id: string) => id === 'Rex';

    const layout = layoutTree(graph, 'Rex', { isPet });

    // the owner, a person, may still get her own parent slots; the pet gets none
    expect(slots(layout).filter((slot) => slot.endsWith(':Rex'))).toEqual([]);
    expect(layout.tiles.some((t) => t.kind === 'add' && t.add === 'partner')).toBe(false);
    expect(layout.lines.some((line) => line.key === 'add-child')).toBe(false);
    // the owner stays straight above
    expect(tile(layout, 'Ann').x).toBe(tile(layout, 'Rex').x);
  });
});

describe('people who are related two ways', () => {
  const spouse = (a: string, b: string): TreeRelation => ({
    id: `r${nextId++}`,
    personId: a,
    relatedPersonId: b,
    type: 'spouse',
    qualifier: null,
  });
  const sibling = (a: string, b: string): TreeRelation => ({
    id: `r${nextId++}`,
    personId: a,
    relatedPersonId: b,
    type: 'sibling',
    qualifier: null,
  });
  const expectUniqueKeys = (layout: TreeLayout) => {
    const keys = layout.tiles.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  };

  it('places a partner who is also a sibling once, from either side', () => {
    const graph = buildGraph(people(['Mum', 'female'], ['Dad', 'male'], ['Me', 'male'], ['Sis', 'female']), [
      parent('Mum', 'Me'),
      parent('Dad', 'Me'),
      parent('Mum', 'Sis'),
      parent('Dad', 'Sis'),
      spouse('Me', 'Sis'),
    ]);
    for (const focus of ['Me', 'Sis']) {
      const layout = layoutTree(graph, focus);
      expectUniqueKeys(layout);
      expectNoOverlaps(layout);
      expect(layout.tiles.filter((t) => t.kind === 'person' && t.generation === 0)).toHaveLength(2);
    }
  });

  it('places a partner who is a half-sibling or only a recorded sibling once', () => {
    const graph = buildGraph(
      people(
        ['Mum', 'female'],
        ['Dad', 'male'],
        ['Other', 'female'],
        ['Me', 'male'],
        ['Half', 'female'],
        ['Rec', 'female'],
      ),
      [
        parent('Mum', 'Me'),
        parent('Dad', 'Me'),
        parent('Dad', 'Half'),
        parent('Other', 'Half'),
        spouse('Me', 'Half'),
        sibling('Me', 'Rec'),
        spouse('Me', 'Rec'),
      ],
    );
    const layout = layoutTree(graph, 'Me');
    expectUniqueKeys(layout);
    expectNoOverlaps(layout);
  });

  it('keeps the bars between rows well apart', () => {
    // a half-sibling, a step-sibling and the partner's sister, all at once
    const graph = buildGraph(
      people(
        ['Dad', 'male'],
        ['Mum', 'female'],
        ['Other', 'female'],
        ['Steve', 'male'],
        ['Me', 'male'],
        ['Half', 'female'],
        ['Sara', 'female'],
        ['Kate', 'female'],
        ['Laura', 'female'],
      ),
      [
        parent('Dad', 'Me'),
        parent('Mum', 'Me'),
        parent('Dad', 'Half'),
        parent('Other', 'Half'),
        spouse('Mum', 'Steve'),
        parent('Steve', 'Sara'),
        spouse('Me', 'Kate'),
        sibling('Kate', 'Laura'),
      ],
    );
    const layout = layoutTree(graph, 'Me');
    const barY = (prefix: string) => {
      const line = layout.lines.find((l) => l.key.startsWith(prefix));
      expect(line, prefix).toBeDefined();
      // the y of the line's horizontal run
      const run = line!.points.find((point, i) => i > 0 && point[1] === line!.points[i - 1][1]);
      return run![1];
    };
    const ys = [barY('bar:Me'), barY('half:Dad'), barY('step-kids:Steve'), barY('inlaw-bracket:')];
    for (const [i, a] of ys.entries()) {
      for (const b of ys.slice(i + 1)) {
        expect(Math.abs(a - b)).toBeGreaterThanOrEqual(8);
      }
    }
  });
});
