import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFamilyPeople, getFamilyRelatives } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: a family tree centred on one person
export const load = (async ({ url }) => {
  await authenticate(url);
  const people = await getFamilyPeople().catch(() => null);
  if (!people || people.length === 0) {
    return { people, focus: null, relatives: [], meta: { title: 'Family tree' } };
  }

  const requested = url.searchParams.get('focus');
  const me = people.find((person) => person.linkedUserId === authManager.user.id);
  const focus =
    people.find((person) => person.id === requested) ?? me ?? people.find((person) => person.name) ?? people[0];
  const relatives = await getFamilyRelatives({ id: focus.id });
  return { people, focus, relatives, meta: { title: 'Family tree' } };
}) satisfies PageLoad;
