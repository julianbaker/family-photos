import { authenticate } from '#lib/utils/auth.ts';
import { getFamilyPeople } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: everyone in the family tree
export const load = (async ({ url }) => {
  await authenticate(url);
  const people = await getFamilyPeople().catch(() => null);
  return { people, meta: { title: 'Family people' } };
}) satisfies PageLoad;
