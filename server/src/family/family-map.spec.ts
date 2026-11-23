import { familyMapStyles } from 'src/family/family-map.js';

const stock = { lightStyle: 'https://stock/light.json', darkStyle: 'https://stock/dark.json' };

describe(familyMapStyles.name, () => {
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('keeps the stock map styles while the family feature is off', () => {
    expect(familyMapStyles(stock)).toEqual(stock);
  });

  it('uses OpenFreeMap when the family feature is on', () => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(familyMapStyles(stock)).toEqual({
      lightStyle: 'https://tiles.openfreemap.org/styles/liberty',
      darkStyle: 'https://tiles.openfreemap.org/styles/dark',
    });
  });
});
