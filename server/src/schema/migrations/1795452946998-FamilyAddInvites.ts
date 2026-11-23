import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "family_invite" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "familyId" uuid NOT NULL,
  "tokenHash" bytea NOT NULL,
  "label" character varying,
  "role" character varying NOT NULL,
  "maxUses" integer,
  "uses" integer NOT NULL DEFAULT 0,
  "expiresAt" timestamp with time zone NOT NULL,
  "revokedAt" timestamp with time zone,
  "createdById" uuid,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_invite_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_invite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_invite_tokenHash_uq" UNIQUE ("tokenHash"),
  CONSTRAINT "family_invite_uses_chk" CHECK ("maxUses" IS NULL OR "uses" <= "maxUses"),
  CONSTRAINT "family_invite_role_chk" CHECK ("role" IN ('admin', 'member', 'viewer')),
  CONSTRAINT "family_invite_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_invite_familyId_idx" ON "family_invite" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_invite_createdById_idx" ON "family_invite" ("createdById");`.execute(db);
  await sql`CREATE INDEX "family_invite_updateId_idx" ON "family_invite" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_invite_updatedAt"
  BEFORE UPDATE ON "family_invite"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "family_invite_request" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
  "familyId" uuid NOT NULL,
  "requestedById" uuid NOT NULL,
  "name" character varying NOT NULL,
  "note" character varying,
  "status" character varying NOT NULL DEFAULT 'pending',
  "inviteId" uuid,
  "inviteToken" character varying,
  "decidedById" uuid,
  "decidedAt" timestamp with time zone,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
  "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
  CONSTRAINT "family_invite_request_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "family" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_invite_request_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_invite_request_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "family_invite" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_invite_request_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "family_invite_request_status_chk" CHECK ("status" IN ('pending', 'approved', 'declined')),
  CONSTRAINT "family_invite_request_pkey" PRIMARY KEY ("id")
);`.execute(db);
  await sql`CREATE INDEX "family_invite_request_familyId_idx" ON "family_invite_request" ("familyId");`.execute(db);
  await sql`CREATE INDEX "family_invite_request_requestedById_idx" ON "family_invite_request" ("requestedById");`.execute(db);
  await sql`CREATE INDEX "family_invite_request_inviteId_idx" ON "family_invite_request" ("inviteId");`.execute(db);
  await sql`CREATE INDEX "family_invite_request_decidedById_idx" ON "family_invite_request" ("decidedById");`.execute(db);
  await sql`CREATE INDEX "family_invite_request_updateId_idx" ON "family_invite_request" ("updateId");`.execute(db);
  await sql`CREATE OR REPLACE TRIGGER "family_invite_request_updatedAt"
  BEFORE UPDATE ON "family_invite_request"
  FOR EACH ROW
  EXECUTE FUNCTION updated_at();`.execute(db);
  await sql`CREATE TABLE "family_invite_use" (
  "inviteId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "usedAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_invite_use_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "family_invite" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_invite_use_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_invite_use_pkey" PRIMARY KEY ("inviteId", "userId")
);`.execute(db);
  await sql`CREATE INDEX "family_invite_use_inviteId_idx" ON "family_invite_use" ("inviteId");`.execute(db);
  await sql`CREATE INDEX "family_invite_use_userId_idx" ON "family_invite_use" ("userId");`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_invite_updatedAt', '{"type":"trigger","name":"family_invite_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_invite_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_invite\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_family_invite_request_updatedAt', '{"type":"trigger","name":"family_invite_request_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"family_invite_request_updatedAt\\"\\n  BEFORE UPDATE ON \\"family_invite_request\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // triggers are dropped with their tables
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_invite_updatedAt';`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_family_invite_request_updatedAt';`.execute(db);
  await sql`DROP TABLE "family_invite_request";`.execute(db);
  await sql`DROP TABLE "family_invite_use";`.execute(db);
  await sql`DROP TABLE "family_invite";`.execute(db);
}
