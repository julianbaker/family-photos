import { Kysely, sql } from 'kysely';

// family fork: one-time codes that open the iOS app already signed in (family_app_login_code)
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "family_app_login_code" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "userId" uuid NOT NULL,
  "codeHash" bytea NOT NULL,
  "expiresAt" timestamp with time zone NOT NULL,
  "usedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_app_login_code_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_app_login_code_codeHash_uq" UNIQUE ("codeHash"),
  CONSTRAINT "family_app_login_code_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_app_login_code_userId_idx" ON "family_app_login_code" ("userId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "family_app_login_code";`.execute(db);
}
