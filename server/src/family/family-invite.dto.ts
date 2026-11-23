import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { FamilyRoleSchema } from 'src/family/family.dto.js';
import { FamilyInviteRequestStatus, FamilyInviteStatus, FamilyRole } from 'src/family/family.enum.js';
import { isoDatetimeToDate } from 'src/validation.js';

const FamilyInviteStatusSchema = z
  .enum(FamilyInviteStatus)
  .describe('Invite status')
  .meta({ id: 'FamilyInviteStatus' });
const FamilyInviteRequestStatusSchema = z
  .enum(FamilyInviteRequestStatus)
  .describe('Invite request status')
  .meta({ id: 'FamilyInviteRequestStatus' });

const inviteOptions = {
  role: FamilyRoleSchema.default(FamilyRole.Member).describe('Role the new member gets'),
  maxUses: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .nullable()
    .default(1)
    .describe('How many people can join with the link; null for any number until it expires'),
  expiresInDays: z.number().int().min(1).max(365).default(7).describe('Days until the link expires'),
};

const FamilyInviteCreateSchema = z
  .object({
    ...inviteOptions,
    label: z.string().trim().max(100).optional().describe('Note for admins, e.g. who the link is for'),
  })
  .meta({ id: 'FamilyInviteCreateDto' });

const FamilyInviteResponseSchema = z
  .object({
    id: z.uuidv4(),
    label: z.string().nullable(),
    role: FamilyRoleSchema,
    maxUses: z.number().int().nullable(),
    uses: z.number().int(),
    expiresAt: isoDatetimeToDate,
    revokedAt: isoDatetimeToDate.nullable(),
    createdAt: isoDatetimeToDate,
    status: FamilyInviteStatusSchema,
    usedBy: z
      .array(z.object({ userId: z.uuidv4(), name: z.string(), usedAt: isoDatetimeToDate }))
      .describe('Who joined with this link'),
    token: z.string().optional().describe('The link token; only returned when the link is created'),
    path: z.string().optional().describe('The link path, e.g. /invite/<token>; only returned when created'),
  })
  .meta({ id: 'FamilyInviteResponseDto' });

const FamilyInviteTokenSchema = z
  .object({ token: z.string().min(16).max(200).describe('Invite link token') })
  .meta({ id: 'FamilyInviteTokenDto' });

const FamilyInvitePreviewSchema = z
  .object({
    familyName: z.string(),
    role: FamilyRoleSchema,
    valid: z.boolean().describe('Whether the link can still be used'),
    status: FamilyInviteStatusSchema,
    expiresAt: isoDatetimeToDate,
    appUrl: z.string().nullable().describe('Where to get the app, if configured'),
  })
  .meta({ id: 'FamilyInvitePreviewDto' });

const FamilyInviteAcceptSchema = z
  .object({
    token: z.string().min(16).max(200),
    name: z.string().trim().min(1).max(100).describe('Your name'),
    email: z
      .email()
      .transform((value) => value.toLowerCase())
      .describe('Your email, used to sign in'),
    password: z.string().min(8).max(200).describe('Password, at least 8 characters'),
  })
  .meta({ id: 'FamilyInviteAcceptDto' });

const FamilyInviteRequestCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).describe('Who should be invited'),
    note: z.string().trim().max(500).optional().describe('Anything the admin should know'),
  })
  .meta({ id: 'FamilyInviteRequestCreateDto' });

const FamilyInviteRequestApproveSchema = z.object(inviteOptions).meta({ id: 'FamilyInviteRequestApproveDto' });

const FamilyInviteRequestResponseSchema = z
  .object({
    id: z.uuidv4(),
    name: z.string(),
    note: z.string().nullable(),
    status: FamilyInviteRequestStatusSchema,
    requestedById: z.uuidv4(),
    requestedByName: z.string(),
    createdAt: isoDatetimeToDate,
    decidedAt: isoDatetimeToDate.nullable(),
    path: z.string().nullable().describe('The approved link path, until it is used'),
  })
  .meta({ id: 'FamilyInviteRequestResponseDto' });

export class FamilyInviteCreateDto extends createZodDto(FamilyInviteCreateSchema) {}
export class FamilyInviteResponseDto extends createZodDto(FamilyInviteResponseSchema) {}
export class FamilyInviteTokenDto extends createZodDto(FamilyInviteTokenSchema) {}
export class FamilyInvitePreviewDto extends createZodDto(FamilyInvitePreviewSchema) {}
export class FamilyInviteAcceptDto extends createZodDto(FamilyInviteAcceptSchema) {}
export class FamilyInviteRequestCreateDto extends createZodDto(FamilyInviteRequestCreateSchema) {}
export class FamilyInviteRequestApproveDto extends createZodDto(FamilyInviteRequestApproveSchema) {}
export class FamilyInviteRequestResponseDto extends createZodDto(FamilyInviteRequestResponseSchema) {}
