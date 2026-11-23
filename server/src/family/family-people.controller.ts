import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { ApiTag } from 'src/enum.js';
import {
  FamilyAssetPersonResponseDto,
  FamilyCommentCreateDto,
  FamilyCommentResponseDto,
  FamilyPersonCreateDto,
  FamilyPersonResponseDto,
  FamilyPersonUpdateDto,
  FamilyRelationCreateDto,
  FamilyRelationResponseDto,
  FamilyRelativeResponseDto,
  FamilyRelativesQueryDto,
} from 'src/family/family-people.dto.js';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { UUIDParamDto } from 'src/validation.js';

const added = () => new HistoryBuilder().added('v3.4.2');

@ApiTags(ApiTag.Family)
@Controller('family')
export class FamilyPeopleController {
  constructor(private service: FamilyPeopleService) {}

  @Get('people')
  @Authenticated()
  @Endpoint({
    summary: 'List family people',
    description: 'Everyone in the family tree, with photos or not.',
    history: added(),
  })
  getFamilyPeople(@Auth() auth: AuthDto): Promise<FamilyPersonResponseDto[]> {
    return this.service.getAll(auth);
  }

  @Post('people')
  @Authenticated()
  @Endpoint({
    summary: 'Add a person',
    description: 'Someone with no photos yet, such as an ancestor.',
    history: added(),
  })
  createFamilyPerson(@Auth() auth: AuthDto, @Body() dto: FamilyPersonCreateDto): Promise<FamilyPersonResponseDto> {
    return this.service.create(auth, dto);
  }

  @Get('people/:id')
  @Authenticated()
  @Endpoint({
    summary: 'Get a family person',
    description: 'Name, dates, bio and how they relate to you.',
    history: added(),
  })
  getFamilyPerson(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<FamilyPersonResponseDto> {
    return this.service.get(auth, id);
  }

  @Put('people/:id')
  @Authenticated()
  @Endpoint({
    summary: 'Update a family person',
    description: 'Name, dates, gender, bio, or "this is me". Shared with the whole family.',
    history: added(),
  })
  updateFamilyPerson(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FamilyPersonUpdateDto,
  ): Promise<FamilyPersonResponseDto> {
    return this.service.update(auth, id, dto);
  }

  @Get('people/:id/relatives')
  @Authenticated()
  @Endpoint({
    summary: 'Get a person’s relatives',
    description: 'Everyone related to this person and how, e.g. their children or grandparents.',
    history: added(),
  })
  getFamilyRelatives(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Query() dto: FamilyRelativesQueryDto,
  ): Promise<FamilyRelativeResponseDto[]> {
    return this.service.getRelatives(auth, id, dto);
  }

  @Get('relations')
  @Authenticated()
  @Endpoint({ summary: 'List relations', description: 'Every stored relation in the family tree.', history: added() })
  getFamilyRelations(@Auth() auth: AuthDto): Promise<FamilyRelationResponseDto[]> {
    return this.service.getRelations(auth);
  }

  @Post('relations')
  @Authenticated()
  @Endpoint({
    summary: 'Add a relation',
    description: 'Parent, spouse, sibling, godparent, friend or custom.',
    history: added(),
  })
  createFamilyRelation(
    @Auth() auth: AuthDto,
    @Body() dto: FamilyRelationCreateDto,
  ): Promise<FamilyRelationResponseDto> {
    return this.service.createRelation(auth, dto);
  }

  @Delete('relations/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({ summary: 'Remove a relation', description: 'Remove a stored relation.', history: added() })
  deleteFamilyRelation(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteRelation(auth, id);
  }

  @Get('assets/:id/people')
  @Authenticated()
  @Endpoint({
    summary: 'People in a photo',
    description: 'Who is in the photo, their age when it was taken, and how they relate to you.',
    history: added(),
  })
  getFamilyAssetPeople(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<FamilyAssetPersonResponseDto[]> {
    return this.service.getAssetPeople(auth, id);
  }

  @Get('assets/:id/comments')
  @Authenticated()
  @Endpoint({ summary: 'Comments on a photo', description: 'Family comments, oldest first.', history: added() })
  getFamilyComments(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<FamilyCommentResponseDto[]> {
    return this.service.getComments(auth, id);
  }

  @Post('assets/:id/comments')
  @Authenticated()
  @Endpoint({ summary: 'Comment on a photo', description: 'Add a family comment to a photo.', history: added() })
  createFamilyComment(
    @Auth() auth: AuthDto,
    @Param() { id }: UUIDParamDto,
    @Body() dto: FamilyCommentCreateDto,
  ): Promise<FamilyCommentResponseDto> {
    return this.service.createComment(auth, id, dto);
  }

  @Delete('comments/:id')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a comment',
    description: 'The author or a family admin can delete it.',
    history: added(),
  })
  deleteFamilyComment(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.deleteComment(auth, id);
  }
}
