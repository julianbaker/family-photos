import { Kysely, sql } from 'kysely';

// family fork: the two foreign-key indexes 1795620000000-FamilySharingGrants left out (the table classes declare
// an index on every foreign key; schema-check reported them missing)
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX IF NOT EXISTS "family_partner_grant_sharedById_idx" ON "family_partner_grant" ("sharedById");`.execute(
    db,
  );
  await sql`CREATE INDEX IF NOT EXISTS "family_album_grant_albumId_idx" ON "family_album_grant" ("albumId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "family_album_grant_albumId_idx";`.execute(db);
  await sql`DROP INDEX IF EXISTS "family_partner_grant_sharedById_idx";`.execute(db);
}
