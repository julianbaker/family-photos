import { Kysely, sql } from 'kysely';

// family fork: birth and death dates hold exactly what's known: '1938', '1938-03' or '1938-03-14'.
// Existing dates are exact days and keep their value as text.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "family_person" DROP CONSTRAINT "family_person_dates_chk";`.execute(db);
  await sql`ALTER TABLE "family_person" ALTER COLUMN "birthDate" TYPE character varying USING to_char("birthDate", 'YYYY-MM-DD');`.execute(db);
  await sql`ALTER TABLE "family_person" ALTER COLUMN "deathDate" TYPE character varying USING to_char("deathDate", 'YYYY-MM-DD');`.execute(db);
  await sql`ALTER TABLE "family_person" ADD CONSTRAINT "family_person_birth_format_chk" CHECK ("birthDate" IS NULL OR "birthDate" ~ '^\\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$');`.execute(db);
  await sql`ALTER TABLE "family_person" ADD CONSTRAINT "family_person_death_format_chk" CHECK ("deathDate" IS NULL OR "deathDate" ~ '^\\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\\d|3[01]))?)?$');`.execute(db);
  await sql`ALTER TABLE "family_person" ADD CONSTRAINT "family_person_dates_chk" CHECK ("deathDate" IS NULL OR "birthDate" IS NULL OR (CASE length("deathDate") WHEN 4 THEN "deathDate" || '-12-31' WHEN 7 THEN "deathDate" || '-31' ELSE "deathDate" END) >= "birthDate");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  // a date known only in part has no exact day to go back to: it goes back as unknown
  await sql`ALTER TABLE "family_person" DROP CONSTRAINT "family_person_dates_chk";`.execute(db);
  await sql`ALTER TABLE "family_person" DROP CONSTRAINT "family_person_birth_format_chk";`.execute(db);
  await sql`ALTER TABLE "family_person" DROP CONSTRAINT "family_person_death_format_chk";`.execute(db);
  await sql`ALTER TABLE "family_person" ALTER COLUMN "birthDate" TYPE date USING (CASE WHEN length("birthDate") = 10 THEN "birthDate"::date END);`.execute(db);
  await sql`ALTER TABLE "family_person" ALTER COLUMN "deathDate" TYPE date USING (CASE WHEN length("deathDate") = 10 THEN "deathDate"::date END);`.execute(db);
  await sql`ALTER TABLE "family_person" ADD CONSTRAINT "family_person_dates_chk" CHECK ("deathDate" IS NULL OR "birthDate" IS NULL OR "deathDate" >= "birthDate");`.execute(db);
}
