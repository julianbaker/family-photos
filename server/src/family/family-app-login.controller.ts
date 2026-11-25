import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { LoginResponseDto, type AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag, AuthType, ImmichCookie } from 'src/enum.js';
import { FamilyAppLoginCodeResponseDto, FamilyAppLoginRedeemDto } from 'src/family/family-app-login.dto.js';
import { FamilyAppLoginService } from 'src/family/family-app-login.service.js';
import { Auth, Authenticated, GetLoginDetails } from 'src/middleware/auth.guard.js';
import type { LoginDetails } from 'src/services/auth.service.js';
import { respondWithCookie } from 'src/utils/response.js';

const added = () => new HistoryBuilder().added('v3.4.2');

@ApiTags(ApiTag.Family)
@Controller('family/app-login-codes')
export class FamilyAppLoginController {
  constructor(private service: FamilyAppLoginService) {}

  @Post()
  @Authenticated()
  @Endpoint({
    summary: 'Make a sign-in code for the app',
    description: 'A one-time link (and QR code) that opens the iOS app signed in as you. It works once, for 5 minutes.',
    history: added(),
  })
  createFamilyAppLoginCode(@Auth() auth: AuthDto, @Req() request: Request): Promise<FamilyAppLoginCodeResponseDto> {
    // the address the website was reached on, used when the server's external domain isn't set
    const origin = request.host ? `${request.protocol}://${request.host}` : undefined;
    return this.service.create(auth, origin);
  }

  @Post('redeem')
  @Authenticated({ public: true })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Sign in with a sign-in code',
    description: 'The app trades a one-time code for a session of its own. No sign-in needed.',
    history: added(),
  })
  async redeemFamilyAppLoginCode(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: FamilyAppLoginRedeemDto,
    @GetLoginDetails() loginDetails: LoginDetails,
  ): Promise<LoginResponseDto> {
    const body = await this.service.redeem(dto, loginDetails);
    return respondWithCookie(res, body, {
      isSecure: loginDetails.isSecure,
      values: [
        { key: ImmichCookie.AccessToken, value: body.accessToken },
        { key: ImmichCookie.AuthType, value: AuthType.Password },
        { key: ImmichCookie.IsAuthenticated, value: 'true' },
      ],
    });
  }
}
