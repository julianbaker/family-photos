import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthDto, LoginResponseDto } from 'src/dtos/auth.dto.js';
import { SystemConfig } from 'src/dtos/config.dto.js';
import { FamilyAppLoginCodeResponseDto, FamilyAppLoginRedeemDto } from 'src/family/family-app-login.dto.js';
import { requireFamilyRole } from 'src/family/family-membership.js';
import { isFamilyEnabled } from 'src/family/family.flag.js';
import type { LoginDetails } from 'src/services/auth.service.js';
import { BaseService } from 'src/services/base.service.js';
import { getExternalDomain } from 'src/utils/misc.js';

const CODE_LIFETIME_MS = 5 * 60 * 1000;
const APP_SCHEME = 'sibred';
const EXPIRED_MESSAGE = 'This sign-in link has expired or was already used. Make a new one.';

/** The session list names where a session came from, so people can tell these apart from a password sign-in. */
export const APP_LOGIN_DEVICE_TYPE = 'sibred app (sign-in link)';

/**
Signs the iOS app in without typing the server address or a password: someone signed in on the website
makes a one-time code (shown as a link or a QR code), and the app trades it for a session of its own.
*/
@Injectable()
export class FamilyAppLoginService extends BaseService {
  /**
  `requestOrigin` is the address the website was reached on; it is only used when the admin hasn't set
  the server's external domain, the same fallback shared-link previews use.
  */
  async create(auth: AuthDto, requestOrigin?: string): Promise<FamilyAppLoginCodeResponseDto> {
    await requireFamilyRole(this.familyRepository, auth);
    // worked out first, so no code is stored when there would be no link to put it in
    const { server } = await this.getConfig({ withCache: true });
    const origin = this.getPublicOrigin(server, requestOrigin);

    // codes that can't be used any more have no reason to stay around
    await this.familyRepository.deleteStaleAppLoginCodes();

    // 24 random bytes (192 bits), base64url so it goes in a link as is: far too many to guess, so
    // redeeming needs no rate limit. Only its hash is stored, like invite tokens.
    const code = this.cryptoRepository.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS);
    await this.familyRepository.createAppLoginCode({
      userId: auth.user.id,
      codeHash: this.cryptoRepository.hashSha256(code),
      expiresAt,
    });

    const url = new URL('/app-login', origin);
    url.searchParams.set('code', code);
    const appUrl = `${APP_SCHEME}://app-login?${new URLSearchParams({ server: origin, code }).toString()}`;

    return { code, url: url.href, appUrl, expiresAt };
  }

  /** Trades a code for a new session of the person who made it. Public. */
  async redeem(dto: FamilyAppLoginRedeemDto, loginDetails: LoginDetails): Promise<LoginResponseDto> {
    if (!isFamilyEnabled()) {
      throw new BadRequestException('Family features are not enabled on this server');
    }

    // marking it used is the check: an unknown, expired or used code changes nothing and returns nothing
    const used = await this.familyRepository.consumeAppLoginCode(this.cryptoRepository.hashSha256(dto.code));
    const user = used && (await this.userRepository.get(used.userId, { withDeleted: false }));
    if (!user) {
      throw new BadRequestException(EXPIRED_MESSAGE);
    }

    return this.createLoginResponse(user, { ...loginDetails, deviceType: APP_LOGIN_DEVICE_TYPE });
  }

  private getPublicOrigin(server: SystemConfig['server'], requestOrigin?: string) {
    // without a request origin, getExternalDomain would fall back to Immich's own my.immich.app
    if (!server.externalDomain && !requestOrigin) {
      throw new BadRequestException(
        "Can't work out this server's address; set the external domain in the server settings",
      );
    }
    return new URL(getExternalDomain(server, requestOrigin)).origin;
  }
}
