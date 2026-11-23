import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "family" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "clusterGroupId" uuid NOT NULL,
  "name" character varying NOT NULL DEFAULT 'Family',
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_clusterGroupId_fkey" FOREIGN KEY ("clusterGroupId") REFERENCES "cluster_group" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_clusterGroupId_uq" UNIQUE ("clusterGroupId"),
  CONSTRAINT "family_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_clusterGroupId_idx" ON "family" ("clusterGroupId");`.execute(db);
  await sql`CREATE INDEX "family_updateId_idx" ON "family" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_updatedAt"
  BEFORE UPDATE ON "family"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "family_history" (
  "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
  "familyId" uuid NOT NULL,
  "userId" uuid,
  "action" character varying NOT NULL,
  "entityType" character varying NOT NULL,
  "entityId" uuid,
  "before" jsonb,
  "after" jsonb,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_history_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_history_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_history_familyId_idx" ON "family_history" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_history_userId_idx" ON "family_history" ("userId");`.execute(db);
  await sql`CREATE INDEX "family_history_entityId_idx" ON "family_history" ("entityId");`.execute(db);
  await sql`CREATE INDEX "family_history_createdAt_idx" ON "family_history" ("createdAt");`.execute(db);
  await sql`CREATE TABLE "family_member" (
  "userId" uuid NOT NULL,
  "familyId" uuid NOT NULL,
  "role" character varying NOT NULL,
  "addedById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_member_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_member_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_member_role_chk" CHECK ("role" IN ('admin', 'member', 'viewer')),
  CONSTRAINT "family_member_pkey" PRIMARY KEY ("userId")
);`.execute(db);
  await sql`CREATE INDEX "family_member_familyId_idx" ON "family_member" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_member_addedById_idx" ON "family_member" ("addedById");`.execute(db);
  await sql`CREATE INDEX "family_member_updateId_idx" ON "family_member" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_member_updatedAt"
  BEFORE UPDATE ON "family_member"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_updatedAt', '{"type":"trigger","name":"family_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_updatedAt\\"\\n  BEFORE UPDATE ON \\"family\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_member_updatedAt', '{"type":"trigger","name":"family_member_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_member_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_member\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // triggers are dropped with their tables
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_member_updatedAt';`.execute(db);
  await sql`DROP TABLE "family_history";`.execute(db);
  await sql`DROP TABLE "family_member";`.execute(db);
  await sql`DROP TABLE "family";`.execute(db);
}
