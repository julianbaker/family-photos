// family fork: small display helpers for family people

const year = (date: string | null) => (date ? date.slice(0, 4) : null);

/** "1938–2019", "born 1960", or "" */
export const lifespan = (person: { birthDate: string | null; deathDate: string | null }) => {
  const born = year(person.birthDate);
  const died = year(person.deathDate);
  if (born && died) {
    return `${born}–${died}`;
  }
  if (died) {
    return `died ${died}`;
  }
  if (born) {
    return `born ${born}`;
  }
  return '';
};

export const formatDate = (date: string | null) =>
  date ? new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: 'long' }) : '';

/** Relation keys grouped for a person's page, closest first. */
export const RELATIVE_GROUPS: Array<{ title: string; match: (key: string) => boolean }> = [
  { title: 'Spouses', match: (key) => key === 'spouse' || key === 'former-spouse' },
  { title: 'Parents', match: (key) => ['parent', 'adoptive-parent', 'step-parent'].includes(key) },
  { title: 'Children', match: (key) => ['child', 'adopted-child', 'step-child'].includes(key) },
  { title: 'Siblings', match: (key) => ['sibling', 'half-sibling', 'step-sibling'].includes(key) },
  { title: 'Grandparents and older', match: (key) => key.endsWith('grandparent') },
  { title: 'Grandchildren and younger', match: (key) => key.endsWith('grandchild') },
  { title: 'Aunts and uncles', match: (key) => key.endsWith('aunt-uncle') },
  { title: 'Nieces and nephews', match: (key) => key.endsWith('niece-nephew') },
  { title: 'Cousins', match: (key) => key === 'cousin' },
  { title: 'In-laws', match: (key) => key.includes('in-law') || key.endsWith('-spouse') },
  { title: 'Godparents and godchildren', match: (key) => key === 'godparent' || key === 'godchild' },
  { title: 'Friends and others', match: (key) => key === 'friend' || key === 'custom' },
];

/** Keys for "photos of X's ..." browsing. */
export const BROWSE_KEYS: Array<{ title: string; keys: string[] }> = [
  { title: 'children', keys: ['child', 'adopted-child'] },
  { title: 'grandchildren', keys: ['grandchild'] },
  { title: 'parents', keys: ['parent', 'adoptive-parent'] },
  { title: 'grandparents', keys: ['grandparent'] },
  { title: 'siblings', keys: ['sibling', 'half-sibling'] },
];

const SUFFIX = /^(jr|sr|i{1,3}|iv|v)\.?$/i;

/** The surname to sort by: the last word, skipping "Jr", "III" and the like ("von Rosenberg" sorts under R). */
const surnameKey = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && SUFFIX.test(words.at(-1) ?? '')) {
    words.pop();
  }
  return `${words.at(-1) ?? ''} ${name}`.toLowerCase();
};

/** Sort people by surname, then by their whole name. */
export const bySurname = (a: { name: string }, b: { name: string }) =>
  surnameKey(a.name).localeCompare(surnameKey(b.name));
