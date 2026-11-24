# Upstream files touched by the fork

Every upstream file the fork changes, and why. Check these first when merging an upstream release.

| File | Change | Why |
|---|---|---|
| `.gitignore` | added `.family-build/` and `internal/` | local build logs; private planning repo |
| `AGENTS.md`, `CLAUDE.md` (new at root) | agent rules for the fork | upstream has none at v3.4.2; may conflict if upstream adds one |
| `docker/docker-compose.family-dev.yml` (new) | local dev overrides: stock ML image, ports on localhost only | the fork does not change ML; keeps the dev DB off the network |
| `server/src/schema/index.ts` | registers `FamilyTable`, `FamilyMemberTable`, `FamilyHistoryTable` (tables list + `DB` interface) | sql-tools and Kysely only see registered tables |
| `server/src/schema/migrations/ORDER` | appends `1795451404365-FamilyAddTables` | migration order file; merge conflicts here are resolved by keeping both lines in timestamp order |
| `server/src/services/base.service.ts` | `FamilyRepository` appended to `BASE_SERVICE_DEPENDENCIES`, the constructor and `BaseService.create` | services get repositories positionally; kept last to avoid conflicts |
| `server/src/repositories/index.ts` | registers `FamilyRepository` | Nest providers |
| `server/src/repositories/access.repository.ts` | adds `family: FamilyAccess` | family grants are checked next to the stock ones |
| `server/src/utils/access.ts` | `AssetUpdate`, `AssetDelete`, `AssetEdit*`, `PersonCreate`, `PersonReassign`, `FaceDelete` add the family grant via `withFamilyAccess` | members edit and identify people on any family photo; deletes follow the role rules |
| `server/src/repositories/event.repository.ts` | adds the `AlbumCreate` event | there is no stock event for new albums |
| `server/src/services/album.service.ts` | emits `AlbumCreate` after creating an album, only when the family feature is on | new albums are shared with every member |
| `server/src/enum.ts`, `server/src/constants.ts` | `ApiTag.Family` and its description | OpenAPI tag for `/family` |
| `server/src/services/index.ts`, `server/src/controllers/index.ts` | registers `FamilyService`, `FamilyController` | Nest providers and routes |
| `server/test/utils.ts`, `server/test/medium.factory.ts`, `server/test/repositories/access.repository.mock.ts` | `FamilyRepository` and `FamilyAccess` in the test factories and mocks | tests construct services with every repository |
| `open-api/immich-openapi-specs.json` | generated: `/family` endpoints and DTOs (additions only) | regenerated from the server |
| `server/src/queries/family.repository.sql` (new) | generated SQL for the family repository | upstream CI checks generated query files |
| `server/src/enum.ts` | `SourceType.Pet` (`pet`) | pet faces found by sibred's pet recognition (`server/src/family/pets/`) |
| `server/src/repositories/search.repository.ts` | `searchFaces` takes `pets`; pet faces only match pet faces, human faces never match pets | the two kinds of embedding share `face_search` but must never mix |
| `server/src/services/person.service.ts` | `handleDetectFaces` ignores pet faces when matching new detections | a person's face must never take over a pet's box |
| `server/src/services/index.ts` | registers `FamilyPetService` | Nest providers |
| `server/Dockerfile` | `pet-models` stage (models pinned by revision and sha256) copied to `/usr/src/app/sibred-models` | pet recognition runs in the server, no ML image change |
| `server/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | `onnxruntime-node` dependency; its CUDA-download install script disabled | runs the pet models; the CPU runtime ships in the package |
| `server/src/queries/search.repository.sql` | regenerated for the `searchFaces` pet filter | upstream CI checks generated query files |
| `.gitignore` | `sibred-models` | local copies of the models for development |

## Rules for merging upstream
- Keep every `// family fork` line. In positional lists (`BASE_SERVICE_DEPENDENCIES`, the `BaseService` constructor, `BaseService.create`, `test/utils.ts`) the family entries stay **last**.
- After merging, run `pnpm check`, the unit tests, `pnpm test:medium --run test/medium/specs/family`, and regenerate the OpenAPI spec and `server/src/queries`.
- `migrations:generate` prints spurious `DROP TYPE`/`CREATE TYPE` pairs for upstream enums (it compares enum values in a different order). Delete those lines from generated fork migrations, and write `down` with the overrides first and the tables last.
| `server/src/services/asset.service.ts` | `update` and `updateAll` call `familyBeforeAssetUpdate` | favourites, archive/hidden/locked, ratings, Live Photo links and duplicate choices stay with the owner; family edits are recorded in the history |
| `server/src/services/partner.service.ts` | `search` leaves out family members; `remove` and `update` refuse family pairs | the partner rows between members are managed by the server and never exposed |
| `server/src/repositories/websocket.repository.ts` | `clientSend` accepts a list of rooms | one send reaches every family member |
| `server/src/services/job.service.ts` | upload-ready events go to `getUploadRecipients(...)` (the owner, plus family members when the feature is on) | members see each other's new photos live |
| `server/src/dtos/config.dto.ts` | default `map.lightStyle`/`darkStyle` go through `familyMapStyles(...)` | OpenFreeMap instead of tiles.immich.cloud when the family feature is on |
| `server/src/services/map.service.ts` | map markers always include the user's family members | relatives don't have to switch on "include partners" for the map |
| `packages/sdk/src/fetch-client.ts` | regenerated with oazapfts from the spec (additions only) | web uses the `/family` endpoints |
| `server/helmet.json` | `connect-src` allows `https://tiles.openfreemap.org` | otherwise the browser blocks the OpenFreeMap tiles and the map is blank |
| `server/src/constants.ts` | `excludePaths` adds `/.well-known/apple-app-site-association` | served at the site root so iPhones open invite links in the app |
| `server/src/schema/migrations/ORDER` | appends `1795452946998-FamilyAddInvites` | invite tables |
| `web/src/lib/route.ts` | adds `Route.family()` | link to the Family page |
| `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte` | "Family" item, shown only to family members (`familyState`) | navigation to members, invites and requests |
| `web/src/routes/invite/[token]/` (new), `web/src/routes/(user)/family/` (new), `web/src/lib/family/` (new) | public invite sign-up page; Family page | fork-only pages, in plain English (no i18n keys, to avoid conflicts in `i18n/en.json`) |
| `server/src/services/person.service.ts` | after a name or birth date update, calls `FamilyPeopleService.onStockPersonUpdate` | names and birth dates are shared family-wide, whichever screen changed them |
| `server/src/schema/migrations/ORDER` | appends `1795454307226-FamilyAddPeople` | people, relations, comments tables |
| `web/src/lib/components/asset-viewer/DetailPanel.svelte` | family members can edit captions, places and faces (`canEdit`); adds `FamilyAssetPanel` (people with ages, comments) | the server already allows these edits |
| `web/src/lib/components/asset-viewer/DetailPanelDate.svelte` | family members can edit dates | same |
| `web/src/routes/(user)/family/people/`, `.../tree/`, `.../browse/`, `web/src/lib/family/` (new) | people, person page, tree, browse by relation, bio renderer | fork-only |
| `server/src/commands/index.ts` | registers `FamilySetupCommand` (`immich-admin family-setup`) | creates the family on an existing server during cutover and prints counts to check |
| `family/rehearsal/` (new), `family/cutover.md` (new) | migration rehearsal (compose, seed, script) and the cutover plan with rollback | fork-only tooling |
| `server/src/repositories/database.repository.ts` | `allowUnorderedMigrations` is also on when the family feature is on | a release can bring upstream migrations that sort before the fork's already-applied ones; without this the server refuses to start after an upgrade |
| `family/upgrade/upgrade.sh`, `family/upgrade.md`, `family/UPSTREAM_BASE` (new) | upgrade routine and checklist; the upstream release the fork is based on | fork-only |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `patches/@immich__sql-tools@0.7.0.patch` (new) | patches `@immich/sql-tools` to read enum values `ORDER BY enumsortorder` | without it, Postgres may return enum labels alphabetically once the catalog changes (it does after the family migrations), and schema-check reports false drift on six stock enums. Drop the patch once upstream fixes it |
| `server/Dockerfile` | `COPY patches ./patches` next to the lockfile | pnpm needs the patch files to install with the patched `@immich/sql-tools` |
| `server/src/services/person.service.ts` | `mergePeople` calls `FamilyPeopleService.beforeStockMerge` / `afterStockMerge`, and skips the "don't overwrite other users' names" check when the merge is family-wide | every member has a named copy of each person (a mirror of the family's record), so the stock check stopped a merge at the merging user's own copy and the family kept both people. Family-wide merges fold the merged person's details and relations into the kept one first |
| `server/src/services/person.service.ts` | `getThumbnail` falls back to `FamilyPeopleService.getThumbnailFallback` | members' mirrored copies of a person have no face crop, so the stock lookup returned 404 (broken images on the website tree and the app's People grid) for people whose faces are in another member's photos |
| `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte` | in a family, People goes to the family's People page and is always shown; adds Family Tree, and Family Settings for admins only (replaces the single Family item) | the family's people, tree and admin tasks are separate jobs (owner, 2026-11-23) |
| `server/src/schema/migrations/ORDER` | appends `1795478073751-FamilyAddWordmark` | the website wordmark column |
| `README.md` | a short sibred introduction and "built on Immich" credit above Immich's README | the product name, with clear credit (AGPL) |
| `web/src/routes/+layout.svelte` | page titles end with the wordmark instead of "Immich"; loads the branding | sibred branding |
| `web/src/app.html`, `web/static/manifest.json`, `web/static/icon.svg`, `favicon.ico`, `apple-icon-180.png`, `manifest-icon-*.png` | "sibred" name and placeholder icons | sibred branding (replace the icons when there is a logo) |
| `NavigationBar.svelte`, `AuthPageLayout.svelte`, `SharedLinkPage.svelte`, `IndividualSharedViewer.svelte`, `AlbumViewer.svelte`, `ErrorLayout.svelte`, `OnboardingHello.svelte`, `DragAndDropUploadOverlay.svelte` | the Immich `<Logo>` is replaced by `<Wordmark>` (text set in Family Settings); the sign-in backdrop is a colour wash instead of the Immich logo | sibred branding; the "support Immich" purchase badges keep Immich's logo |
| `web/src/lib/components/shared-components/side-bar/BottomInfo.svelte`, `AuthPageLayout.svelte` | "Built on Immich" credit line | credit where it's due (AGPL) |
| `server/src/services/person.service.ts` | `handlePersonCleanup` skips person groups that are family people (`FamilyPeopleService.getPeopleToKeep`) | the nightly cleanup deletes every person without faces, which deleted the family's ancestors and relatives added by name, and their relations with them |
