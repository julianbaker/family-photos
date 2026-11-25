/**
The family features are sibred itself and cannot be switched off: in production this is always true and
IMMICH_FAMILY_ENABLED is ignored (a startup warning says so when it is set to something else). Only
unit tests (vitest sets VITEST) can still switch it with IMMICH_FAMILY_ENABLED=true, so the many
upstream specs that exercise stock paths keep running without the family code. Read on each call so
tests can toggle it.
*/
export const isFamilyEnabled = (): boolean =>
  process.env.VITEST !== 'true' || process.env.IMMICH_FAMILY_ENABLED === 'true';

/** The warning to log at startup when someone still sets IMMICH_FAMILY_ENABLED to something other than true. */
export const familyFlagWarning = (): string | null => {
  const value = process.env.IMMICH_FAMILY_ENABLED;
  if (process.env.VITEST === 'true' || value === undefined || value === 'true') {
    return null;
  }
  return `IMMICH_FAMILY_ENABLED=${value} is ignored: the family features of sibred are always on. Use stock Immich if you want it without them.`;
};
