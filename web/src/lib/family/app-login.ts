// family fork: one-time sign-in codes that open the iOS app signed in, and the invite fields that tie
// an invite to a family person.
//
// The SDK in packages/sdk is generated from the server's OpenAPI spec and doesn't have these endpoints
// and fields yet. Until it is regenerated, the sign-in code endpoint is called here with the SDK's own
// base URL, headers and fetch, and the types below add the new fields to the generated ones (the SDK's
// invite functions send their body as given, so the extra personId reaches the server).
import {
  defaults,
  type FamilyInviteCreateDto,
  type FamilyInvitePreviewDto,
  type FamilyInviteRequestCreateDto,
  type FamilyInviteRequestResponseDto,
  type FamilyInviteResponseDto,
} from '@immich/sdk';

export type FamilyAppLoginCodeResponseDto = {
  /** One-time code; works once, for 5 minutes */
  code: string;
  /** Universal link: https://<server>/app-login?code=<code> */
  url: string;
  /** Custom-scheme link that also names the server: sibred://app-login?server=...&code=... */
  appUrl: string;
  expiresAt: string;
};

export type FamilyInviteCreateWithPersonDto = FamilyInviteCreateDto & { personId?: string };
export type FamilyInviteWithPersonDto = FamilyInviteResponseDto & {
  personId?: string | null;
  personName?: string | null;
};
export type FamilyInviteRequestCreateWithPersonDto = FamilyInviteRequestCreateDto & { personId?: string };
export type FamilyInviteRequestWithPersonDto = FamilyInviteRequestResponseDto & {
  personId?: string | null;
  personName?: string | null;
};
export type FamilyInvitePreviewWithPersonDto = FamilyInvitePreviewDto & { personName?: string | null };

/** How long a sign-in code works, as the server sets it. */
export const APP_LOGIN_MINUTES = 5;
export const APP_SCHEME = 'sibred';

/**
The custom-scheme link that opens the app signed in. The server returns it too; the /app-login page
builds it from its own address because it only has the code.
*/
export const sibredAppUrl = (origin: string, code: string) =>
  `${APP_SCHEME}://app-login?${new URLSearchParams({ server: origin, code }).toString()}`;

/**
Whether this looks like a phone or tablet, where the app can be opened straight away; on a computer
the link is shown as a QR code to scan with a phone instead. iPads ask for the desktop site and say
they are a Mac, so a Mac with a touch screen counts too.
*/
export const isMobileDevice = (userAgent: string, maxTouchPoints = 0) =>
  /iPhone|iPad|iPod|Android/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);

const postJson = async <T>(path: string, body?: unknown): Promise<T> => {
  const doFetch = defaults.fetch ?? fetch;
  const response = await doFetch(`${defaults.baseUrl}${path}`, {
    method: 'POST',
    headers: { ...defaults.headers, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  } as RequestInit);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    // the server's own message, e.g. "Family features are not enabled on this server"
    throw new Error(data?.message || `Request failed (${response.status})`);
  }
  return data as T;
};

/** POST /family/app-login-codes */
export const createFamilyAppLoginCode = () => postJson<FamilyAppLoginCodeResponseDto>('/family/app-login-codes');
