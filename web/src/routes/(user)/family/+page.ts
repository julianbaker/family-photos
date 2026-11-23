import { Route } from '#lib/route.ts';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// family fork: /family is the family's people; members, invites and requests live in /family/settings
export const load = (() => {
  redirect(307, Route.familyPeople());
}) satisfies PageLoad;
