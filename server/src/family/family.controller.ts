import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag } from 'src/enum.js';
import {
  FamilyCreateDto,
  FamilyHistoryQueryDto,
  FamilyHistoryResponseDto,
  FamilyMemberCreateDto,
  FamilyMemberUpdateDto,
  FamilyResponseDto,
} from 'src/family/family.dto.js';
import { FamilyService } from 'src/family/family.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { UUIDParamDto } from 'src/validation.js';

const added = () => new HistoryBuilder().added('v3.4.2');

@ApiTags(ApiTag.Family)
@Controller('family')
export class FamilyController {
  constructor(private service: FamilyService) {}

  @Get()
  @Authenticated()
  @Endpoint({
    summary: 'Get my family',
    description: 'The family the current user belongs to, with its members.',
    history: added(),
  })
  getMyFamily(@Auth() auth: AuthDto): Promise<FamilyResponseDto> {
    return this.service.getMyFamily(auth);
  }

  @Post()
  @Authenticated()
  @Endpoint({
    summary: 'Create the family',
    description: 'A server admin creates the family from their own cluster group and becomes its first admin.',
    history: added(),
  })
  createFamily(@Auth() auth: AuthDto, @Body() dto: FamilyCreateDto): Promise<FamilyResponseDto> {
    return this.service.create(auth, dto);
  }

  @Post('members')
  @Authenticated()
  @Endpoint({
    summary: 'Add a family member',
    description: 'Add an existing user to the family (family admins only).',
    history: added(),
  })
  addFamilyMember(@Auth() auth: AuthDto, @Body() dto: FamilyMemberCreateDto): Promise<FamilyResponseDto> {
    return this.service.addMember(auth, dto);
  }

  @Put('members/:id')
  @Authenticated()
  @Endpoint({
    summary: 'Change a member role',
    description: 'Change the role of a family member (family admins only).',
    history: added(),
  })
  updateFamilyMember(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FamilyMemberUpdateDto,
  ): Promise<FamilyResponseDto> {
    return this.service.updateMember(auth, id, dto);
  }

  @Delete('members/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Remove a family member',
    description: 'Remove a member from the family (family admins only).',
    history: added(),
  })
  removeFamilyMember(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.removeMember(auth, id);
  }

  @Get('history')
  @Authenticated()
  @Endpoint({
    summary: 'Get the family history',
    description: 'Who changed what, newest first (family admins only).',
    history: added(),
  })
  getFamilyHistory(@Auth() auth: AuthDto, @Query() dto: FamilyHistoryQueryDto): Promise<FamilyHistoryResponseDto[]> {
    return this.service.getHistory(auth, dto);
  }
}
