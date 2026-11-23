// family fork: whether the signed-in user is in a family, for showing family navigation
import { getMyFamily } from '@immich/sdk';

class FamilyState {
  inFamily = $state(false);
  #loaded = false;

  async load() {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    try {
      await getMyFamily();
      this.inFamily = true;
    } catch {
      this.inFamily = false;
    }
  }
}

export const familyState = new FamilyState();
