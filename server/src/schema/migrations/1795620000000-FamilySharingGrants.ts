import { Kysely, sql } from 'kysely';

// family fork: the partner and album-user rows the family wrote, with what was there before, so that
// removing a member restores earlier sharing instead of deleting it (family_partner_grant, family_album_grant)
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE TABLE "family_partner_grant" (
  "sharedById" uuid NOT NULL,
  "sharedWithId" uuid NOT NULL,
  "previousInTimeline" boolean,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_partner_grant_sharedById_fkey" FOREIGN KEY ("sharedById") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_partner_grant_sharedWithId_fkey" FOREIGN KEY ("sharedWithId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_partner_grant_pkey" PRIMARY KEY ("sharedById", "sharedWithId")
);`.execute(db);
  await sql`CREATE INDEX "family_partner_grant_sharedWithId_idx" ON "family_partner_grant" ("sharedWithId");`.execute(db);
  await sql`CREATE TABLE "family_album_grant" (
  "albumId" uuid NOT NULL,
  "userId" uuid NOT NULL,
  "previousRole" character varying,
  "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "family_album_grant_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "album" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_album_grant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "family_album_grant_pkey" PRIMARY KEY ("albumId", "userId")
);`.execute(db);
  await sql`CREATE INDEX "family_album_grant_userId_idx" ON "family_album_grant" ("userId");`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE "family_album_grant";`.execute(db);
  await sql`DROP TABLE "family_partner_grant";`.execute(db);
}
