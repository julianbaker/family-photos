// family fork: the website's wordmark (sibred, or what a family admin set), loaded once from a
// public endpoint so the sign-in page has it too
import { getFamilyBranding } from '@immich/sdk';

export const DEFAULT_WORDMARK = 'sibred';

class Branding {
  wordmark = $state(DEFAULT_WORDMARK);
  #loading: Promise<void> | null = null;

  load() {
    this.#loading ??= getFamilyBranding()
      .then((branding) => {
        this.wordmark = branding.wordmark || DEFAULT_WORDMARK;
      })
      .catch(() => {
        this.wordmark = DEFAULT_WORDMARK;
      });
    return this.#loading;
  }

  /** After an admin changes it in Family Settings. */
  set(wordmark: string | null | undefined) {
    this.wordmark = wordmark?.trim() || DEFAULT_WORDMARK;
  }
}

export const branding = new Branding();
