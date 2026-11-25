import { Controller, Get, Header, NotFoundException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import { Authenticated } from 'src/middleware/auth.guard.js';

/**
Apple's Universal Links file: lets an iPhone open `/invite/<token>` links and one-time sign-in links
(`/app-login?code=<code>`) in the family app instead of Safari. Served only when IMMICH_FAMILY_IOS_APP_ID is set (team ID and bundle ID, e.g.
`ABCDE12345.design.example.app`).
*/
export const getAppleAppSiteAssociation = () => {
  const appId = process.env.IMMICH_FAMILY_IOS_APP_ID;
  if (!isFamilyEnabled() || !appId) {
    return null;
  }

  return {
    applinks: {
      details: [
        {
          appIDs: [appId],
          components: [
            { '/': '/invite/*', comment: 'Family invite links' },
            // the code is in the query, so match the path exactly and require a code
            { '/': '/app-login', '?': { code: '?*' }, comment: 'One-time sign-in links' },
          ],
        },
      ],
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
