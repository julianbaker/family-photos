import { getAppleAppSiteAssociation } from 'src/family/family-well-known.controller.js';

describe(getAppleAppSiteAssociation.name, () => {
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
    delete process.env.IMMICH_FAMILY_IOS_APP_ID;
  });

  it('is not served without an app ID', () => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(getAppleAppSiteAssociation()).toBeNull();
  });

  it('is not served while the family feature is off', () => {
    process.env.IMMICH_FAMILY_IOS_APP_ID = 'TEAM123456.design.example.app';
    expect(getAppleAppSiteAssociation()).toBeNull();
  });

  it('sends invite and sign-in links to the app', () => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    process.env.IMMICH_FAMILY_IOS_APP_ID = 'TEAM123456.design.example.app';
    expect(getAppleAppSiteAssociation()).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['TEAM123456.design.example.app'],
            components: [
              { '/': '/invite/*', comment: 'Family invite links' },
              { '/': '/app-login', '?': { code: '?*' }, comment: 'One-time sign-in links' },
            ],
          },
        ],
      },
    });
  });
});
