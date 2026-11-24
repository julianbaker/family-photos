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
