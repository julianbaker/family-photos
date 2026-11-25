# Switching a stock Immich v3.4.2 server to the family fork

The plan for moving an existing server to the fork, with a rehearsal first and a rollback. Server-specific
details (hostnames, accounts, expected counts) belong in your own notes, not here.

## Before the day

1. **Build the fork image** from the `family` branch (or pull a tagged build):
   `docker build -f server/Dockerfile -t sibred-server:<commit> .`
2. **Rehearse on a copy of last night's database dump.** Copy the newest
   `immich-db-backup-*.sql.gz` from the server's backups folder to the build machine (read-only copy;
   don't touch the server). Then:
   ```sh
   MEMBERS="relative@example.com:member" \
     family/rehearsal/rehearse.sh immich-db-backup-….sql.gz admin@example.com "Our family" [db user]
   ```
   It restores the dump into throwaway containers, starts the fork (which runs its migrations), runs
   `immich-admin family-setup` (and `family-add-member` for `MEMBERS`), and checks that every photo,
   name, birth date and face assignment survived. It must end with `Rehearsal passed`. Keep its report:
   the real switch must print the same numbers.
3. **Universal Links** (only if the iPhone app should open invite links and one-time sign-in links): the server answers
   `/.well-known/apple-app-site-association` once `IMMICH_FAMILY_IOS_APP_ID` is set. Apple's CDN fetches
   that file from anywhere in the world, so exempt that one path from geo-blocking and bot filtering in
   the reverse proxy.
4. Tell the family when the server will be briefly offline.

## The switch (about 15 minutes)

1. **Back up.** In Immich: Administration → Backups → create a backup now (or `pg_dump --clean --if-exists`).
   Copy the dump, `docker-compose.yml` and `.env` somewhere safe.
2. **Stop the stock server:** `docker compose down` (volumes stay).
3. **Edit `docker-compose.yml`:** set the `immich-server` image to the fork image. Keep the database,
   Redis and machine-learning services exactly as they are (machine learning stays the stock v3.4.2 image).
4. **Edit `.env`:**
   ```
   # the family features are always on; IMMICH_FAMILY_ENABLED is ignored (a startup warning says so if set to false)
   # optional
   IMMICH_FAMILY_IOS_APP_ID=<team id>.<bundle id>
   IMMICH_FAMILY_APP_URL=<TestFlight public link>
   ```
5. **Start:** `docker compose up -d`, then `docker compose logs -f immich-server` until you see the three
   `Family…` migrations succeed and `No schema drift detected`.
6. **Create the family:**
   `docker compose exec immich-server immich-admin family-setup --email <admin email> --name "<Family name>"`
   Compare its numbers with the rehearsal report.
7. **Existing accounts** (relatives who already have one):
   `docker compose exec immich-server immich-admin family-add-member --email <email> --role member`
8. **Smoke test** in a browser:
   - sign in; the timeline count matches; People shows the old names;
   - the map shows tiles (OpenFreeMap);
   - Family → make an invite link → open it in a private window → the join page shows the family name
     (don't finish signing up unless you mean to);
   - a family member's account sees the admin's photos.

## Rollback

If anything is wrong **before relatives start using it**:

1. `docker compose down`
2. Restore the database from the step-1 dump (Administration → Backups restore on a fresh stock
   server, or `psql --single-transaction` into an emptied database). The fork's tables are additive, but
   restoring the dump is the clean way back.
3. Set the `immich-server` image back to `ghcr.io/immich-app/immich-server:v3.4.2`, remove the
   `IMMICH_FAMILY_*` lines from `.env`, and `docker compose up -d`.

Photos and videos are files on disk and are never changed by the switch. Anything uploaded after the
switch is in the upload folder but not in the restored database; re-upload those after a rollback.

## After the switch

- The fork never updates by itself: follow `family/upgrade.md` for each new Immich release.
- iPhone app builds on TestFlight expire after 90 days; upload a new build before then.
