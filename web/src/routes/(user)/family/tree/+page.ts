import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { authenticate } from '#lib/utils/auth.ts';
import { getFamilyPeople, getFamilyRelatives } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: a family tree centred on one person. With nobody chosen and no "this is me", the page
// asks who you are instead of guessing (it used to fall back to the first name alphabetically).
export const load = (async ({ url }) => {
  await authenticate(url);
  const people = await getFamilyPeople().catch(() => null);
  const requested = url.searchParams.get('focus');
  // ?choose shows the "who are you?" picker even when "this is me" is set
  const choosing = url.searchParams.has('choose');
  const focus = choosing
    ? null
    : (people?.find((person) => person.id === requested) ??
      people?.find((person) => person.linkedUserId === authManager.user.id) ??
      null);
  const relatives = focus ? await getFamilyRelatives({ id: focus.id }) : [];
  return { people, focus, relatives, meta: { title: 'Family Tree' } };
}) satisfies PageLoad;
