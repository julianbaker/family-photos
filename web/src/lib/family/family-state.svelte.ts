// family fork: the signed-in user's family role, for showing family navigation and edit controls
import { FamilyRole, getMyFamily } from '@immich/sdk';

class FamilyState {
  inFamily = $state(false);
  role = $state<FamilyRole | null>(null);
  /** Members and admins can edit any family photo and the family's people; viewers only look. */
  canContribute = $derived(this.role === FamilyRole.Admin || this.role === FamilyRole.Member);
  isAdmin = $derived(this.role === FamilyRole.Admin);
  #loading: Promise<void> | null = null;

  load() {
    this.#loading ??= getMyFamily()
      .then((family) => {
        this.inFamily = true;
        this.role = family.role;
      })
      .catch(() => {
        this.inFamily = false;
        this.role = null;
      });
    return this.#loading;
  }
}

export const familyState = new FamilyState();
