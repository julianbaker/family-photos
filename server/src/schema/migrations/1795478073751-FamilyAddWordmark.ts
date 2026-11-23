import { Kysely, sql } from 'kysely';

// family fork: the website wordmark (text shown in place of a logo), set by family admins
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family" ADD "wordmark" character varying;`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family" DROP COLUMN "wordmark";`.execute(db);
}
