// family fork: the signed-in user's family role, for showing family navigation and edit controls
import { eventManager } from '#lib/managers/event-manager.svelte.ts';
import { FamilyRole, getMyFamily } from '@immich/sdk';

export class FamilyState {
  inFamily = $state(false);
  role = $state<FamilyRole | null>(null);
  /** Members and admins can edit any family photo and the family's people; viewers only look. */
  canContribute = $derived(this.role === FamilyRole.Admin || this.role === FamilyRole.Member);
  isAdmin = $derived(this.role === FamilyRole.Admin);
  #loaded = false;
  #loading: Promise<void> | null = null;
  /** Bumped on every invalidation, so a request that was in flight at the time cannot store its answer. */
  #generation = 0;

  constructor() {
    // another user signing in, or this one signing out, never sees the previous membership
    eventManager.on({
      AuthLogout: () => this.invalidate(),
      AuthUserLoaded: () => this.invalidate(),
    });
  }

  /**
  Loads the membership once. A failed request is not kept: the next call asks again. The in-flight
  request is shared, and forgotten as soon as it settles.
  */
  load(): Promise<void> {
    if (this.#loaded) {
      return Promise.resolve();
    }
    if (this.#loading) {
      return this.#loading;
    }
    const generation = this.#generation;
    const request = getMyFamily()
      .then((family) => {
        if (generation === this.#generation) {
          this.inFamily = true;
          this.role = family.role;
          this.#loaded = true;
        }
      })
      .catch(() => {
        // not in a family (or the request failed): show no family controls, and ask again next time
        if (generation === this.#generation) {
          this.inFamily = false;
          this.role = null;
        }
      })
      .finally(() => {
        if (this.#loading === request) {
          this.#loading = null;
        }
      });
    this.#loading = request;
    return request;
  }

  /** Forgets the membership: after signing in or out, or when a role may have changed. */
  invalidate() {
    this.#generation++;
    this.#loaded = false;
    this.#loading = null;
    this.inFamily = false;
    this.role = null;
  }

  /** Forgets and asks again, e.g. after an admin changed a role or removed a member. */
  refresh(): Promise<void> {
    this.invalidate();
    return this.load();
  }
}

export const familyState = new FamilyState();
