import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { FamilyRole } from 'src/family/family.enum.js';
import { isoDatetimeToDate } from 'src/validation.js';

export const FamilyRoleSchema = z.enum(FamilyRole).describe('Family role').meta({ id: 'FamilyRole' });

const FamilyCreateSchema = z
  .object({ name: z.string().trim().min(1).max(100).optional().describe('Family name') })
  .meta({ id: 'FamilyCreateDto' });

const FamilyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional().describe('Family name'),
    wordmark: z
      .string()
      .trim()
      .max(40)
      .nullable()
      .optional()
      .describe('Text shown in place of a logo on the website; empty or null for the default'),
  })
  .meta({ id: 'FamilyUpdateDto' });

const FamilyBrandingResponseSchema = z
  .object({
    wordmark: z.string().describe('Text shown in place of a logo on the website; empty when the server has no family features (stock branding)'),
    appUrl: z.string().nullable().describe('Where to get the iOS app, if configured'),
  })
  .meta({ id: 'FamilyBrandingResponseDto' });

const FamilyMemberCreateSchema = z
  .object({
    userId: z.uuidv4().describe('Existing user to add to the family'),
    role: FamilyRoleSchema.default(FamilyRole.Member),
  })
  .meta({ id: 'FamilyMemberCreateDto' });

const FamilyMemberUpdateSchema = z.object({ role: FamilyRoleSchema }).meta({ id: 'FamilyMemberUpdateDto' });

const FamilyMemberResponseSchema = z
  .object({
    userId: z.uuidv4().describe('User ID'),
    name: z.string().describe('User name'),
    email: z.string().describe('User email'),
    role: FamilyRoleSchema,
    joinedAt: isoDatetimeToDate.describe('When the user joined the family'),
  })
  .meta({ id: 'FamilyMemberResponseDto' });

const FamilyResponseSchema = z
  .object({
    id: z.uuidv4().describe('Family ID'),
    name: z.string().describe('Family name'),
    wordmark: z.string().nullable().describe('Custom website wordmark, or null for the default'),
    role: FamilyRoleSchema.describe('Role of the current user'),
    members: z.array(FamilyMemberResponseSchema).describe('Family members'),
  })
  .meta({ id: 'FamilyResponseDto' });

const FamilyHistoryQuerySchema = z
  .object({
    take: z.coerce.number().int().min(1).max(500).default(100).describe('Number of entries'),
    skip: z.coerce.number().int().min(0).default(0).describe('Entries to skip'),
  })
  .meta({ id: 'FamilyHistoryQueryDto' });

const FamilyHistoryResponseSchema = z
  .object({
    id: z.uuidv4(),
    userId: z.uuidv4().nullable().describe('Who made the change'),
    action: z.string(),
    entityType: z.string(),
    entityId: z.uuidv4().nullable(),
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    createdAt: isoDatetimeToDate,
  })
  .meta({ id: 'FamilyHistoryResponseDto' });

export class FamilyCreateDto extends createZodDto(FamilyCreateSchema) {}
export class FamilyUpdateDto extends createZodDto(FamilyUpdateSchema) {}
export class FamilyBrandingResponseDto extends createZodDto(FamilyBrandingResponseSchema) {}
export class FamilyMemberCreateDto extends createZodDto(FamilyMemberCreateSchema) {}
export class FamilyMemberUpdateDto extends createZodDto(FamilyMemberUpdateSchema) {}
export class FamilyMemberResponseDto extends createZodDto(FamilyMemberResponseSchema) {}
export class FamilyResponseDto extends createZodDto(FamilyResponseSchema) {}
export class FamilyHistoryQueryDto extends createZodDto(FamilyHistoryQuerySchema) {}
export class FamilyHistoryResponseDto extends createZodDto(FamilyHistoryResponseSchema) {}
