import { Kysely, sql } from 'kysely';

// family fork: hide a person from the family's People lists (family_person.isHidden)
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family_person" ADD "isHidden" boolean NOT NULL DEFAULT false;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family_person" DROP COLUMN "isHidden";`.execute(db);
}
