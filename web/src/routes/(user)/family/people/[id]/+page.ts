import { authenticate } from '#lib/utils/auth.ts';
import { getFamilyPeople, getFamilyPerson, getFamilyRelations, getFamilyRelatives } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: one person's details, relations and relatives
export const load = (async ({ url, params }) => {
  await authenticate(url);
  const [person, people, relations, relatives] = await Promise.all([
    getFamilyPerson({ id: params.id }),
    getFamilyPeople(),
    getFamilyRelations(),
    getFamilyRelatives({ id: params.id }),
  ]);
  return { person, people, relations, relatives, meta: { title: person.name || 'Unnamed person' } };
}) satisfies PageLoad;
