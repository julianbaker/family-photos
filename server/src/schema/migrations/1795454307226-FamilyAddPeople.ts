import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "family_comment" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "familyId" uuid NOT NULL,
  "assetId" uuid NOT NULL,
  "userId" uuid,
  "text" text NOT NULL,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_comment_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_comment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_comment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_comment_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_comment_familyId_idx" ON "family_comment" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_comment_assetId_idx" ON "family_comment" ("assetId");`.execute(db);
  await sql`CREATE INDEX "family_comment_userId_idx" ON "family_comment" ("userId");`.execute(db);
  await sql`CREATE INDEX "family_comment_createdAt_idx" ON "family_comment" ("createdAt");`.execute(db);
  await sql`CREATE INDEX "family_comment_updateId_idx" ON "family_comment" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_comment_updatedAt"
  BEFORE UPDATE ON "family_comment"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "family_person" (
  "personGroupId" uuid NOT NULL,
  "familyId" uuid NOT NULL,
  "name" character varying NOT NULL DEFAULT '',
  "birthDate" date,
  "deathDate" date,
  "gender" character varying,
  "bio" text,
  "linkedUserId" uuid,
  "updatedById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_person_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_person_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_person_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_person_linkedUserId_uq" UNIQUE ("linkedUserId"),
  CONSTRAINT "family_person_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_person_dates_chk" CHECK ("deathDate" IS NULL OR "birthDate" IS NULL OR "deathDate" >= "birthDate"),
  CONSTRAINT "family_person_gender_chk" CHECK ("gender" IS NULL OR "gender" IN ('female', 'male')),
  CONSTRAINT "family_person_pkey" PRIMARY KEY ("personGroupId")
);`.execute(db);
  await sql`CREATE INDEX "family_person_familyId_idx" ON "family_person" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_person_linkedUserId_idx" ON "family_person" ("linkedUserId");`.execute(db);
  await sql`CREATE INDEX "family_person_updatedById_idx" ON "family_person" ("updatedById");`.execute(db);
  await sql`CREATE INDEX "family_person_updateId_idx" ON "family_person" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_person_updatedAt"
  BEFORE UPDATE ON "family_person"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "family_relation" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "familyId" uuid NOT NULL,
  "personGroupId" uuid NOT NULL,
  "relatedPersonGroupId" uuid NOT NULL,
  "type" character varying NOT NULL,
  "qualifier" character varying,
  "label" character varying,
  "createdById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_relation_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_relation_personGroupId_fkey" FOREIGN KEY ("personGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_relation_relatedPersonGroupId_fkey" FOREIGN KEY ("relatedPersonGroupId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_relation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_relation_personGroupId_relatedPersonGroupId_type_uq" UNIQUE ("personGroupId", "relatedPersonGroupId", "type"),
  CONSTRAINT "family_relation_label_chk" CHECK (("type" = 'custom') = ("label" IS NOT NULL)),
  CONSTRAINT "family_relation_self_chk" CHECK ("personGroupId" != "relatedPersonGroupId"),
  CONSTRAINT "family_relation_qualifier_chk" CHECK ("qualifier" IS NULL OR "qualifier" IN ('step', 'adopted', 'half', 'former')),
  CONSTRAINT "family_relation_type_chk" CHECK ("type" IN ('parent', 'spouse', 'sibling', 'godparent', 'friend', 'custom')),
  CONSTRAINT "family_relation_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_relation_familyId_idx" ON "family_relation" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_relation_personGroupId_idx" ON "family_relation" ("personGroupId");`.execute(db);
  await sql`CREATE INDEX "family_relation_relatedPersonGroupId_idx" ON "family_relation" ("relatedPersonGroupId");`.execute(db);
  await sql`CREATE INDEX "family_relation_createdById_idx" ON "family_relation" ("createdById");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_comment_updatedAt', '{"type":"trigger","name":"family_comment_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_comment_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_comment\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_person_updatedAt', '{"type":"trigger","name":"family_person_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_person_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_person\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // triggers are dropped with their tables
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_person_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_comment_updatedAt';`.execute(db);
  await sql`DROP TABLE "family_comment";`.execute(db);
  await sql`DROP TABLE "family_relation";`.execute(db);
  await sql`DROP TABLE "family_person";`.execute(db);
}
