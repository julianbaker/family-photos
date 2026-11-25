import { Kysely, sql } from 'kysely';

// family fork: an invite (or a request for one) can be for a person already in the family; whoever joins
// with it is linked to that person. The person is a person group, like in family_relation.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family_invite" ADD "personId" uuid;`.execute(db);
  await sql`ALTER TABLE "family_invite" ADD CONSTRAINT "family_invite_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(db);
  await sql`CREATE INDEX "family_invite_personId_idx" ON "family_invite" ("personId");`.execute(db);
  await sql`ALTER TABLE "family_invite_request" ADD "personId" uuid;`.execute(db);
  await sql`ALTER TABLE "family_invite_request" ADD CONSTRAINT "family_invite_request_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person_group" ("id") ON UPDATE CASCADE ON DELETE SET NULL;`.execute(db);
  await sql`CREATE INDEX "family_invite_request_personId_idx" ON "family_invite_request" ("personId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // the foreign keys and indexes go with the columns
  await sql`ALTER TABLE "family_invite_request" DROP COLUMN "personId";`.execute(db);
  await sql`ALTER TABLE "family_invite" DROP COLUMN "personId";`.execute(db);
}
