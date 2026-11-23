import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { Authenticated } from 'src/middleware/auth.guard.js';

/**
Apple's Universal Links file: lets an iPhone open `/invite/<token>` links in the family app instead
of Safari. Served only when IMMICH_FAMILY_IOS_APP_ID is set (team ID and bundle ID, e.g.
`ABCDE12345.design.example.app`).
*/
export const getAppleAppSiteAssociation = () => {
  const appId = process.env.IMMICH_FAMILY_IOS_APP_ID;
  if (!isFamilyEnabled() || !appId) {
    return null;
  }

  return {
    applinks: {
      details: [{ appIDs: [appId], components: [{ '/': '/invite/*', comment: 'Family invite links' }] }],
    },
  };
};

@Controller()
export class FamilyWellKnownController {
  @ApiExcludeEndpoint()
  @Get('.well-known/apple-app-site-association')
  @Authenticated({ public: true })
  @Header('Content-Type', 'application/json')
  getAppleAppSiteAssociation() {
    const body = getAppleAppSiteAssociation();
    if (!body) {
      throw new NotFoundException();
    }
    return body;
  }
}
