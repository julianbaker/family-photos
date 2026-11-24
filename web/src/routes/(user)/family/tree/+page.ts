import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFamilyPeople, getFamilyRelations } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: the whole family in two requests; the tree lays itself out in the browser, so moving
// between people never reloads the page
export const load = (async ({ url }) => {
  await authenticate(url);
  const [people, relations] = await Promise.all([
    getFamilyPeople().catch(() => null),
    getFamilyRelations().catch(() => []),
  ]);
  const requested = url.searchParams.get('focus');
  const me = people?.find((person) => person.linkedUserId === authManager.user.id) ?? null;
  // ?choose shows the "who are you?" picker even when "this is me" is set
  const focusId = url.searchParams.has('choose')
    ? null
    : (people?.find((person) => person.id === requested)?.id ?? me?.id ?? null);
  return { people, relations, focusId, meId: me?.id ?? null, meta: { title: 'Family Tree' } };
}) satisfies PageLoad;
