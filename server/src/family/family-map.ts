import { isFamilyEnabled } from 'src/family/family.flag.js';

type MapStyles = { lightStyle: string; darkStyle: string };

/**
Default map styles. With the family feature on, the web map uses OpenFreeMap (free, no account,
no tracking) instead of Immich's tile server. Admins can still change both in the system settings.
*/
export const familyMapStyles = (stock: MapStyles): MapStyles =>
  isFamilyEnabled()
    ? {
        lightStyle: 'https://tiles.openfreemap.org/styles/liberty',
        darkStyle: 'https://tiles.openfreemap.org/styles/dark',
      }
    : stock;
