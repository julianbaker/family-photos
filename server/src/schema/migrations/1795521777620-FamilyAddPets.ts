import { Kysely, sql } from 'kysely';

// family fork: pet recognition (family/pets). Pets are faces with sourceType 'pet'; a family person can
// be marked as a pet by hand; family_pet_scan records which photos were scanned with which models.
export async function up(db: Kysely<any>): Promise<void> {
  // like upstream's enum additions: ADD VALUE, never drop and recreate a type that is in use
  await sql`ALTER TYPE "sourcetype" ADD VALUE IF NOT EXISTS 'pet';`.execute(db);
  await sql`ALTER TABLE "family_person" ADD "kind" character varying;`.execute(db);
  await sql`ALTER TABLE "family_person" ADD CONSTRAINT "family_person_kind_chk" CHECK ("kind" IS NULL OR "kind" IN ('person', 'pet'));`.execute(
    db,
  );
  await sql`CREATE TABLE "family_pet_scan" (
  "assetId" uuid NOT NULL,
  "modelVersion" character varying NOT NULL,
  "scannedAt" timestamp with time zone NOT NULL,
  CONSTRAINT "family_pet_scan_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "asset" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_pet_scan_pkey" PRIMARY KEY ("assetId")
);`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // the enum value stays (as upstream does); the pet faces it labels are removed
  await sql`DELETE FROM "asset_face" WHERE "sourceType" = 'pet';`.execute(db);
  await sql`DROP TABLE "family_pet_scan";`.execute(db);
  await sql`ALTER TABLE "family_person" DROP CONSTRAINT "family_person_kind_chk";`.execute(db);
  await sql`ALTER TABLE "family_person" DROP COLUMN "kind";`.execute(db);
}
