// family fork: the website's wordmark (sibred, or what a family admin set), loaded once from a
// public endpoint so the sign-in page has it too. When the server runs without the family features it
// answers with an empty wordmark: the site then shows stock Immich branding (name, manifest and icons).
import { getFamilyBranding } from '@immich/sdk';

export const DEFAULT_WORDMARK = 'sibred';
export const STOCK_WORDMARK = 'Immich';

class Branding {
  wordmark = $state(DEFAULT_WORDMARK);
  /** True when the server has no family features: stock Immich name, manifest and icons. */
  stock = $state(false);
  #loading: Promise<void> | null = null;

  load() {
    this.#loading ??= getFamilyBranding()
      .then((branding) => {
        this.stock = !branding.wordmark;
        this.wordmark = branding.wordmark || STOCK_WORDMARK;
      })
      .catch(() => {
        this.stock = false;
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
