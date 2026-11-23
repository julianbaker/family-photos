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
