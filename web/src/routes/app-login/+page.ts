import { getFamilyBranding } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: where a one-time sign-in link lands when it opens in a browser instead of the app (the app
// isn't installed, or the link was opened on a computer). No sign-in needed.
export const load = (async ({ url, parent }) => {
  await parent();

  // where to get the app, if the server has a link for it (the same one the invite page shows)
  const branding = await getFamilyBranding().catch(() => null);
  const storeUrl = (branding as { appUrl?: string | null } | null)?.appUrl ?? null;

  return {
    code: url.searchParams.get('code') ?? '',
    storeUrl,
    meta: { title: 'Open the app' },
  };
}) satisfies PageLoad;
