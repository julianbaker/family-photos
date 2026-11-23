import {
  FamilyGraph,
  Gender,
  RelationQualifier,
  RelationType,
  StoredRelation,
  bloodRelationship,
  validateRelation,
} from 'src/family/family-relations.js';

// An invented family, four generations:
//
//   greatGran(F)
//       |
//   gran(F) = grandad(M)              otherGran(F)
//       |          |                       |
//   mum(F) = dad(M)   aunt(F) = auntsHusband(M)   ...
//       |                 |
//   me(M), sister(F)   cousin(F) = cousinsWife... (cousin's child: cousinsKid(M))
//
const people: Array<[string, Gender]> = [
  ['greatGran', 'female'],
  ['gran', 'female'],
  ['grandad', 'male'],
  ['mum', 'female'],
  ['dad', 'male'],
  ['aunt', 'female'],
  ['auntsHusband', 'male'],
  ['me', 'male'],
  ['sister', 'female'],
  ['cousin', 'female'],
  ['cousinsKid', 'male'],
  ['wife', 'female'],
  ['wifesMum', 'female'],
  ['wifesBrother', 'male'],
  ['son', 'male'],
  ['sonsWife', 'female'],
  ['halfBrother', 'male'],
  ['stepMum', 'female'],
  ['stepSister', 'female'],
  ['godmother', 'female'],
  ['friend', null],
  ['neighbour', null],
  ['adoptedKid', null],
  ['unrelated', null],
];

let counter = 0;
const rel = (
  personId: string,
  type: RelationType,
  relatedPersonId: string,
  qualifier: RelationQualifier | null = null,
  label: string | null = null,
): StoredRelation => ({ id: `r${counter++}`, personId, relatedPersonId, type, qualifier, label });

const parent = (p: string, child: string, qualifier: RelationQualifier | null = null) =>
  rel(p, RelationType.Parent, child, qualifier);

const relations: StoredRelation[] = [
  parent('greatGran', 'gran'),
  rel('gran', RelationType.Spouse, 'grandad'),
  parent('gran', 'mum'),
  parent('grandad', 'mum'),
  parent('gran', 'aunt'),
  parent('grandad', 'aunt'),
  rel('mum', RelationType.Spouse, 'dad', RelationQualifier.Former),
  parent('mum', 'me'),
  parent('dad', 'me'),
  parent('mum', 'sister'),
  parent('dad', 'sister'),
  rel('aunt', RelationType.Spouse, 'auntsHusband'),
  parent('aunt', 'cousin'),
  parent('cousin', 'cousinsKid'),
  rel('me', RelationType.Spouse, 'wife'),
  parent('wifesMum', 'wife'),
  rel('wife', RelationType.Sibling, 'wifesBrother'),
  parent('me', 'son'),
  rel('son', RelationType.Spouse, 'sonsWife'),
  // dad remarried: stepMum is dad's current spouse; stepSister is her daughter
  rel('dad', RelationType.Spouse, 'stepMum'),
  parent('stepMum', 'stepSister'),
  // dad's son with someone else
  parent('dad', 'halfBrother'),
  parent('otherMum', 'halfBrother'),
  rel('godmother', RelationType.Godparent, 'me'),
  rel('me', RelationType.Friend, 'friend'),
  rel('neighbour', RelationType.Custom, 'me', null, 'best man'),
  parent('me', 'adoptedKid', RelationQualifier.Adopted),
];

const graph = new FamilyGraph(
  [...people, ['otherMum', 'female'] as [string, Gender]].map(([id, gender]) => ({ id, gender })),
  relations,
);
const label = (from: string, to: string) => graph.relationship(from, to)?.label ?? null;

describe(bloodRelationship.name, () => {
  it.each([
    [1, 0, 'parent'],
    [2, 0, 'grandparent'],
    [4, 0, 'great-great-grandparent'],
    [0, 1, 'child'],
    [0, 3, 'great-grandchild'],
    [1, 1, 'sibling'],
    [2, 1, 'aunt or uncle'],
    [3, 1, 'great-aunt or uncle'],
    [1, 2, 'niece or nephew'],
    [2, 2, 'first cousin'],
    [2, 3, 'first cousin once removed'],
    [3, 3, 'second cousin'],
    [3, 5, 'second cousin twice removed'],
  ])('up %i, down %i is a %s', (up, down, expected) => {
    expect(bloodRelationship(up, down, null)?.label).toBe(expected);
  });
});

describe(FamilyGraph.name, () => {
  describe('blood relations', () => {
    it.each([
      ['me', 'mum', 'mother'],
      ['me', 'dad', 'father'],
      ['me', 'gran', 'grandmother'],
      ['me', 'greatGran', 'great-grandmother'],
      ['gran', 'me', 'grandson'],
      ['greatGran', 'me', 'great-grandson'],
      ['me', 'sister', 'sister'],
      ['me', 'aunt', 'aunt'],
      ['cousin', 'me', 'first cousin'],
      ['me', 'cousinsKid', 'first cousin once removed'],
      ['aunt', 'sister', 'niece'],
      ['me', 'halfBrother', 'half-brother'],
      ['me', 'adoptedKid', 'adopted child'],
      ['adoptedKid', 'me', 'adoptive father'],
      ['adoptedKid', 'mum', 'grandmother'],
    ])('%s → %s is %s', (from, to, expected) => {
      expect(label(from, to)).toBe(expected);
    });

    it('links explicit siblings even without recorded parents', () => {
      // wife and wifesBrother are siblings with no shared parent recorded
      expect(label('wife', 'wifesBrother')).toBe('brother');
    });
  });

  describe('marriage', () => {
    it.each([
      ['me', 'wife', 'wife'],
      ['dad', 'mum', 'former wife'],
      ['me', 'wifesMum', 'mother-in-law'],
      ['me', 'wifesBrother', 'brother-in-law'],
      ['wifesBrother', 'me', 'brother-in-law'],
      ['me', 'sonsWife', 'daughter-in-law'],
      ['me', 'auntsHusband', 'uncle by marriage'],
    ])('%s → %s is %s', (from, to, expected) => {
      expect(label(from, to)).toBe(expected);
    });
  });

  describe('step relations', () => {
    it('makes a parent’s current spouse a step-parent, not a former one', () => {
      expect(label('me', 'stepMum')).toBe('stepmother');
      expect(label('stepMum', 'me')).toBe('stepson');
    });

    it('makes a step-parent’s child a step-sibling', () => {
      expect(label('me', 'stepSister')).toBe('stepsister');
    });
  });

  describe('other relations', () => {
    it.each([
      ['me', 'godmother', 'godmother'],
      ['godmother', 'me', 'godson'],
      ['me', 'friend', 'friend'],
      ['me', 'neighbour', 'best man'],
    ])('%s → %s is %s', (from, to, expected) => {
      expect(label(from, to)).toBe(expected);
    });

    it('uses neutral words when the gender isn’t recorded', () => {
      expect(label('adoptedKid', 'me')).toBe('adoptive father');
      expect(label('me', 'adoptedKid')).toBe('adopted child');
    });

    it('finds nothing between unrelated people', () => {
      expect(graph.relationship('me', 'unrelated')).toBeNull();
    });
  });

  describe('relativesByKey', () => {
    it('finds all of someone’s grandchildren', () => {
      expect(graph.relativesByKey('gran', ['grandchild']).toSorted()).toEqual(['cousin', 'me', 'sister']);
    });

    it('finds all of someone’s children', () => {
      expect(graph.relativesByKey('dad', ['child']).toSorted()).toEqual(['halfBrother', 'me', 'sister']);
    });
  });
});

const check = (personId: string, type: RelationType, relatedPersonId: string) =>
  validateRelation(graph, { personId, relatedPersonId, type, qualifier: null, label: null });

describe(validateRelation.name, () => {
  it('refuses a cycle', () => {
    expect(check('me', RelationType.Parent, 'gran')).toMatch('own ancestor');
  });

  it('refuses a third parent', () => {
    expect(check('wifesMum', RelationType.Parent, 'me')).toMatch('already has two parents');
  });

  it('allows a step-parent beyond two parents', () => {
    expect(
      validateRelation(graph, {
        personId: 'wifesMum',
        relatedPersonId: 'me',
        type: RelationType.Parent,
        qualifier: RelationQualifier.Step,
        label: null,
      }),
    ).toBeNull();
  });

  it('refuses marrying an ancestor', () => {
    expect(check('me', RelationType.Spouse, 'gran')).toMatch('ancestor');
  });

  it('refuses a self relation and a custom relation without a label', () => {
    expect(check('me', RelationType.Friend, 'me')).toMatch('themselves');
    expect(check('me', RelationType.Custom, 'friend')).toMatch('needs a label');
  });

  it('accepts a normal new parent', () => {
    expect(check('otherMum', RelationType.Parent, 'stepSister')).toBeNull();
  });
});
