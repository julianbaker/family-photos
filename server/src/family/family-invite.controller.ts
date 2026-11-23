import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { LoginResponseDto, type AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag, AuthType, ImmichCookie } from 'src/enum.js';
import {
  FamilyInviteAcceptDto,
  FamilyInviteCreateDto,
  FamilyInvitePreviewDto,
  FamilyInviteRequestApproveDto,
  FamilyInviteRequestCreateDto,
  FamilyInviteRequestResponseDto,
  FamilyInviteResponseDto,
  FamilyInviteTokenDto,
} from 'src/family/family-invite.dto.js';
import { FamilyInviteService } from 'src/family/family-invite.service.js';
import { Auth, Authenticated, GetLoginDetails } from 'src/middleware/auth.guard.js';
import type { LoginDetails } from 'src/services/auth.service.js';
import { respondWithCookie } from 'src/utils/response.js';
import { UUIDParamDto } from 'src/validation.js';

const added = () => new HistoryBuilder().added('v3.4.2');

@ApiTags(ApiTag.Family)
@Controller('family')
export class FamilyInviteController {
  constructor(private service: FamilyInviteService) {}

  @Post('invites')
  @Authenticated()
  @Endpoint({
    summary: 'Create an invite link',
    description: 'Family admins create a link; the token is only returned now.',
    history: added(),
  })
  createFamilyInvite(@Auth() auth: AuthDto, @Body() dto: FamilyInviteCreateDto): Promise<FamilyInviteResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get('invites')
  @Authenticated()
  @Endpoint({ summary: 'List invite links', description: 'Every invite link and who used it.', history: added() })
  getFamilyInvites(@Auth() auth: AuthDto): Promise<FamilyInviteResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Delete('invites/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Revoke an invite link', description: 'The link stops working.', history: added() })
  revokeFamilyInvite(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.revoke(auth, id);
  }

  @Post('invites/preview')
  @Authenticated({ public: true })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Preview an invite link',
    description: 'Which family the link is for and whether it still works. No sign-in needed.',
    history: added(),
  })
  previewFamilyInvite(@Body() dto: FamilyInviteTokenDto): Promise<FamilyInvitePreviewDto> {
    return this.service.preview(dto);
  }

  @Post('invites/accept')
  @Authenticated({ public: true })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Join with an invite link',
    description: 'Create an account in the family and sign in. No sign-in needed.',
    history: added(),
  })
  async acceptFamilyInvite(
    @Res({ passthrough: true }) res: Response,
    @Body() dto: FamilyInviteAcceptDto,
    @GetLoginDetails() loginDetails: LoginDetails,
  ): Promise<LoginResponseDto> {
    const body = await this.service.accept(dto, loginDetails);
    return respondWithCookie(res, body, {
      isSecure: loginDetails.isSecure,
      values: [
        { key: ImmichCookie.AccessToken, value: body.accessToken },
        { key: ImmichCookie.AuthType, value: AuthType.Password },
        { key: ImmichCookie.IsAuthenticated, value: 'true' },
      ],
    });
  }

  @Post('invite-requests')
  @Authenticated()
  @Endpoint({
    summary: 'Ask for an invite',
    description: 'A member asks the admins to invite someone.',
    history: added(),
  })
  createFamilyInviteRequest(
    @Auth() auth: AuthDto,
    @Body() dto: FamilyInviteRequestCreateDto,
  ): Promise<FamilyInviteRequestResponseDto> {
    return this.service.createRequest(auth, dto);
  }

  @Get('invite-requests')
  @Authenticated()
  @Endpoint({
    summary: 'List invite requests',
    description: 'Admins see every request; members see their own.',
    history: added(),
  })
  getFamilyInviteRequests(@Auth() auth: AuthDto): Promise<FamilyInviteRequestResponseDto[]> {
    return this.service.getRequests(auth);
  }

  @Post('invite-requests/:id/approve')
  @Authenticated()
  @Endpoint({
    summary: 'Approve an invite request',
    description: 'Creates a link the member who asked can send on.',
    history: added(),
  })
  approveFamilyInviteRequest(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FamilyInviteRequestApproveDto,
  ): Promise<FamilyInviteRequestResponseDto> {
    return this.service.approveRequest(auth, id, dto);
  }

  @Post('invite-requests/:id/decline')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Decline an invite request', description: 'No link is created.', history: added() })
  declineFamilyInviteRequest(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.declineRequest(auth, id);
  }
}
