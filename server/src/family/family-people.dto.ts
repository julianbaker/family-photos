import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { RelationQualifier, RelationType } from 'src/family/family-relations.js';
import { isoDatetimeToDate } from 'src/validation.js';
import { PARTIAL_DATE } from 'src/family/partial-date.js';


const dateOnly = z
  .string()
  .regex(PARTIAL_DATE)
  .describe('A date, as much as is known: YYYY, YYYY-MM or YYYY-MM-DD');
const GenderSchema = z
  .enum(['female', 'male'])
  .describe('Only used for words like "grandmother"')
  .meta({ id: 'FamilyGender' });
const KindSchema = z
  .enum(['person', 'pet'])
  .describe('A person, or a pet (a dog or cat, found by pet recognition or added by hand)')
  .meta({ id: 'FamilyPersonKind' });
const RelationTypeSchema = z.enum(RelationType).describe('Relation type').meta({ id: 'FamilyRelationType' });
const RelationQualifierSchema = z
  .enum(RelationQualifier)
  .describe('step or adopted (parent, sibling), half (sibling), former (spouse)')
  .meta({ id: 'FamilyRelationQualifier' });

const RelationshipSchema = z
  .object({
    key: z.string().describe('Stable key, e.g. grandparent, first cousin'),
    label: z.string().describe('Words to show, e.g. grandmother'),
  })
  .meta({ id: 'FamilyRelationshipDto' });

const FamilyPersonResponseSchema = z
  .object({
    id: z.uuidv4().describe('Person ID (the person group, same as in /people)'),
    name: z.string(),
    birthDate: z.string().nullable().describe('As much as is known: YYYY, YYYY-MM or YYYY-MM-DD'),
    deathDate: z.string().nullable().describe('As much as is known: YYYY, YYYY-MM or YYYY-MM-DD'),
    gender: GenderSchema.nullable(),
    bio: z.string().nullable(),
    linkedUserId: z.uuidv4().nullable().describe('The member account this person is'),
    faceCount: z.number().int().describe('Photos this person is recognised in'),
    kind: KindSchema,
    updatedAt: z.string().describe('Changes whenever the person or their picture changes (use it to refresh a cached picture)'),
    relationToMe: RelationshipSchema.nullable().describe('How this person is related to the signed-in member'),
  })
  .meta({ id: 'FamilyPersonResponseDto' });

const personFields = {
  name: z.string().trim().min(1).max(200),
  birthDate: dateOnly.nullable().optional(),
  deathDate: dateOnly.nullable().optional(),
  gender: GenderSchema.nullable().optional(),
  bio: z.string().max(10_000).nullable().optional().describe('Paragraphs, **bold**, *italic* and [links](https://...)'),
  kind: KindSchema.nullable().optional().describe('Set by hand; null means worked out from the photos'),
};

const FamilyPersonCreateSchema = z.object(personFields).meta({ id: 'FamilyPersonCreateDto' });

const FamilyPersonUpdateSchema = z
  .object({
    ...personFields,
    name: personFields.name.optional(),
    linkedUserId: z.uuidv4().nullable().optional().describe('Link to a member account ("this is me")'),
  })
  .meta({ id: 'FamilyPersonUpdateDto' });

const FamilyRelationCreateSchema = z
  .object({
    personId: z.uuidv4().describe('For parent and godparent, the parent or godparent'),
    relatedPersonId: z.uuidv4(),
    type: RelationTypeSchema,
    qualifier: RelationQualifierSchema.nullable().optional(),
    label: z.string().trim().min(1).max(100).nullable().optional().describe('Only for custom relations'),
  })
  .meta({ id: 'FamilyRelationCreateDto' });

const FamilyRelationResponseSchema = z
  .object({
    id: z.uuidv4(),
    personId: z.uuidv4(),
    relatedPersonId: z.uuidv4(),
    type: RelationTypeSchema,
    qualifier: RelationQualifierSchema.nullable(),
    label: z.string().nullable(),
  })
  .meta({ id: 'FamilyRelationResponseDto' });

const FamilyRelativeResponseSchema = z
  .object({ personId: z.uuidv4(), name: z.string(), key: z.string(), label: z.string() })
  .meta({ id: 'FamilyRelativeResponseDto' });

const RelativeKindSchema = z
  .enum(['father', 'mother', 'parent', 'partner', 'child', 'sibling', 'pet', 'owner'])
  .describe('How the relative is related to the person: their father, partner, pet; or, for a pet, its owner')
  .meta({ id: 'FamilyRelativeKind' });

const FamilyRelativeCreateSchema = z
  .object({
    kind: RelativeKindSchema,
    existingId: z.uuidv4().optional().describe('Someone already in the family'),
    newName: z.string().trim().min(1).max(200).optional().describe('Or a new person (a pet for kind "pet")'),
    alsoWith: z
      .uuidv4()
      .optional()
      .describe('Father/mother/parent: also the partner of this other parent. Child/pet: also the child or pet of this partner'),
  })
  .refine((dto) => !!dto.existingId !== !!dto.newName, { message: 'Give either existingId or newName' })
  .meta({ id: 'FamilyRelativeCreateDto' });

const FamilyRelativeCreatedSchema = z
  .object({
    personId: z.uuidv4().describe('The relative'),
    relations: z.array(FamilyRelationResponseSchema).describe('The relations recorded'),
  })
  .meta({ id: 'FamilyRelativeCreatedDto' });

const FamilyPersonCoverSchema = z
  .object({ assetId: z.uuidv4().describe('A photo of this person; their face in it becomes their picture') })
  .meta({ id: 'FamilyPersonCoverDto' });

const FamilyRelativesQuerySchema = z
  .object({
    keys: z.string().optional().describe('Comma-separated relation keys to keep, e.g. child,grandchild'),
  })
  .meta({ id: 'FamilyRelativesQueryDto' });

const FamilyAssetPersonResponseSchema = z
  .object({
    faceId: z.uuidv4(),
    personId: z.uuidv4(),
    name: z.string(),
    age: z.number().int().nullable().describe('Age when the photo was taken, if the birth date is known'),
    relationToMe: RelationshipSchema.nullable(),
  })
  .meta({ id: 'FamilyAssetPersonResponseDto' });

const FamilyCommentCreateSchema = z
  .object({ text: z.string().trim().min(1).max(2000) })
  .meta({ id: 'FamilyCommentCreateDto' });

const FamilyCommentResponseSchema = z
  .object({
    id: z.uuidv4(),
    assetId: z.uuidv4(),
    userId: z.uuidv4().nullable(),
    userName: z.string().nullable(),
    text: z.string(),
    createdAt: isoDatetimeToDate,
    canDelete: z.boolean(),
  })
  .meta({ id: 'FamilyCommentResponseDto' });

export class FamilyPersonResponseDto extends createZodDto(FamilyPersonResponseSchema) {}
export class FamilyPersonCreateDto extends createZodDto(FamilyPersonCreateSchema) {}
export class FamilyPersonUpdateDto extends createZodDto(FamilyPersonUpdateSchema) {}
export class FamilyPersonCoverDto extends createZodDto(FamilyPersonCoverSchema) {}
export class FamilyRelativeCreateDto extends createZodDto(FamilyRelativeCreateSchema) {}
export class FamilyRelativeCreatedDto extends createZodDto(FamilyRelativeCreatedSchema) {}
export class FamilyRelationCreateDto extends createZodDto(FamilyRelationCreateSchema) {}
export class FamilyRelationResponseDto extends createZodDto(FamilyRelationResponseSchema) {}
export class FamilyRelativeResponseDto extends createZodDto(FamilyRelativeResponseSchema) {}
export class FamilyRelativesQueryDto extends createZodDto(FamilyRelativesQuerySchema) {}
export class FamilyAssetPersonResponseDto extends createZodDto(FamilyAssetPersonResponseSchema) {}
export class FamilyCommentCreateDto extends createZodDto(FamilyCommentCreateSchema) {}
export class FamilyCommentResponseDto extends createZodDto(FamilyCommentResponseSchema) {}
