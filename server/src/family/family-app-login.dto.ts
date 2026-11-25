import { createZodDto } from 'nestjs-zod';
import z from 'zod';
import { isoDatetimeToDate } from 'src/validation.js';

const FamilyAppLoginCodeResponseSchema = z
  .object({
    code: z.string().describe('One-time sign-in code; works once, for 5 minutes'),
    url: z.string().describe('Universal link that opens the app signed in: https://<server>/app-login?code=<code>'),
    appUrl: z
      .string()
      .describe(
        'Custom-scheme link for when the server is not built into the app: sibred://app-login?server=...&code=...',
      ),
    expiresAt: isoDatetimeToDate.describe('When the code stops working'),
  })
  .meta({ id: 'FamilyAppLoginCodeResponseDto' });

const FamilyAppLoginRedeemSchema = z
  .object({ code: z.string().min(16).max(200).describe('The one-time sign-in code') })
  .meta({ id: 'FamilyAppLoginRedeemDto' });

export class FamilyAppLoginCodeResponseDto extends createZodDto(FamilyAppLoginCodeResponseSchema) {}
export class FamilyAppLoginRedeemDto extends createZodDto(FamilyAppLoginRedeemSchema) {}
