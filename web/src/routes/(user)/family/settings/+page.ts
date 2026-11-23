import { authenticate } from '#lib/utils/auth.ts';
import { getMyFamily, type FamilyResponseDto } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: members, invite links and invite requests
export const load = (async ({ url }) => {
  await authenticate(url);

  const family: FamilyResponseDto | null = await getMyFamily().catch(() => null);

  return { family, meta: { title: 'Family Settings' } };
}) satisfies PageLoad;
