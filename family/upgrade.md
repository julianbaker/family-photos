# Upgrading the fork to a new Immich release

The fork never updates by itself. For each Immich release you want, follow this checklist on the build
machine. It was rehearsed end to end on 2026-11-23 with upstream `main` standing in for the next release
(290 commits after v3.4.2), including upgrading a database that had already switched to the fork.

## 1. Merge

```sh
git fetch upstream --tags
git checkout family && git status            # clean tree (discard mise.lock noise: git checkout -- mise.lock)
family/upgrade/upgrade.sh v3.5.0             # creates branch upgrade/v3.5.0
```

`upgrade.sh` rebuilds every file from the refs instead of trusting a plain merge. Immich cuts releases on
release branches, so a plain merge also drags in old release-branch hotfixes, silently, even into files
the fork touched. (The rehearsal caught two: a stray `QueueJobStatus.Paused` that broke the type check,
and passkeys switched off.) After the script, every file is either exactly the release's version, the
fork's own file, or the release's version plus the fork's change.

It prints the few files to resolve by hand. In the rehearsal: `AGENTS.md` (both sides add one: keep the
fork's rules on top and the upstream rules below) and two files where a fork import or comment sits next
to an upstream change (keep both). Then `git add` them.

Check nothing stray is left: every upstream file that differs from the release must be listed in
`family/upstream-touches.md`.

## 2. Fix what upstream changed under the fork

Read the release notes and look for changes to the patterns the fork uses. Found in the rehearsal:

- **DTO helper**: upstream replaced `nestjs-zod` with `@immich/nestjs-standard-schema`. Fork DTOs import
  `createZodDto` from `@immich/nestjs-standard-schema/zod` (same `z.object(...).meta({ id })` usage).
- **New repositories**: services gained `ResourceRepository`; fork medium tests must list new
  repositories in their `mock: [...]` arrays (copy upstream's own tests).
- **New ways of telling users about changes** (e.g. `ResourceRepository.send({ userIds })` for live
  updates): check whether family members should be in `userIds`, like the upload fan-out in
  `job.service.ts`. Add a hook and a line in `upstream-touches.md` if so.
- **New endpoints or queries that decide visibility** (timeline, search, map, people, albums, sync):
  check they respect partners/the family the same way the existing ones do. Add a guarantee test if not.

## 3. Check

```sh
pnpm install --frozen-lockfile                      # the release's lockfile
cd packages/sdk && pnpm build && cd ../..
cd server && pnpm check && pnpm test --run
pnpm test:medium --run test/medium/specs/family     # the fork's guarantees
pnpm test:medium --run test/medium/specs/sync test/medium/specs/services
pnpm build && node ./dist/bin/sync-open-api.js       # regenerate the spec
cd .. && npx oazapfts@7.5.0 --optimistic --argumentStyle=object --useEnumType --allSchemas \
  open-api/immich-openapi-specs.json packages/sdk/src/fetch-client.ts
cd web && pnpm exec svelte-kit sync && pnpm exec svelte-check --no-tsconfig --fail-on-warnings \
  --compiler-warnings 'state_referenced_locally:ignore'
```

- The regenerated spec must differ from the release's only by the `Family*` operations (compare
  operation IDs, not lines; the order changes).
- SQL query files: keep the release's versions; regenerate only `server/src/queries/family.repository.sql`.
- Medium tests that fail here only for environment reasons on a Mac: `workflow-core-plugin` (needs the
  wasm plugin built) and the exif specs (need the `e2e/test-assets` submodule).

## 4. Rehearse the upgrade on data

```sh
docker build -f server/Dockerfile -t family-photos-server:v3.5.0-family .
# a copy of the newest production dump, switched to the CURRENT fork, then upgraded:
KEEP=1 SERVER_IMAGE=family-photos-server:<current> family/rehearsal/rehearse.sh dump.sql.gz admin@example.com "Our family"
cd family/rehearsal && SERVER_IMAGE=family-photos-server:v3.5.0-family docker compose up -d server
docker compose logs -f server      # new upstream migrations succeed, "No schema drift detected"
docker compose down -v
```

New upstream migrations often sort **before** the fork's already-applied ones. The fork turns on
`allowUnorderedMigrations` when the family feature is on (`database.repository.ts`), so they still run;
without it the upgraded server refuses to start.

## 5. Ship

```sh
echo v3.5.0 > family/UPSTREAM_BASE
git add -A && git commit -m "Upgrade to Immich v3.5.0"
git checkout family && git merge --ff-only upgrade/v3.5.0
.family-build/privacy-scan.sh                 # your local check that nothing private goes public
git push origin family
```

Deploy like the cutover (`family/cutover.md`): back up the database, change the `immich-server` image
tag, `docker compose up -d`, watch the migrations, smoke test. Keep the machine-learning image on the
same Immich version as the server. Rollback = previous image + the pre-upgrade dump.

## Also on a schedule

- iPhone app TestFlight builds expire after 90 days: upload a new build before then, even without changes.
- Regenerate the app's API client after server API changes (`immich-app/scripts/generate-api.sh`).
