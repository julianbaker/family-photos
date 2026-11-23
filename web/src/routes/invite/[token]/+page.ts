import { previewFamilyInvite, type FamilyInvitePreviewDto } from '@immich/sdk';
import type { PageLoad } from './$types';

// family fork: the public page an invite link opens. No sign-in needed.
export const load = (async ({ params, parent }) => {
  await parent();

  const preview: FamilyInvitePreviewDto | null = await previewFamilyInvite({
    familyInviteTokenDto: { token: params.token },
  }).catch(() => null);

  return {
    token: params.token,
    preview,
    meta: { title: preview ? `Join ${preview.familyName}` : 'Invite link' },
  };
}) satisfies PageLoad;
