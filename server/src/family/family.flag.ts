/**
The family features are off unless IMMICH_FAMILY_ENABLED=true, so the fork behaves as stock
Immich by default. Read on each call so tests can toggle it.
*/
export const isFamilyEnabled = (): boolean => process.env.IMMICH_FAMILY_ENABLED === 'true';
