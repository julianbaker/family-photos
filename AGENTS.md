# Family fork of Immich

This repo is a fork of [immich-app/immich](https://github.com/immich-app/immich) (branch `family`, based on tag v3.4.2, remote `upstream`). It turns Immich into one shared family photo library: every member sees the same photos, people and albums, with invite links and a family tree built on face-recognition people.

If an `internal/` folder exists, it is the maintainers' private planning repo. Read `internal/project-log/current.md`, `internal/project-log/glossary.md` and `internal/docs/` first, every session. Never copy anything from `internal/` into this public repo.

## Rules
- Never touch a production server, its database or its photo folders. Work only with local copies.
- Keep fork changes isolated so upstream merges stay easy: fork code in `server/src/family/` and `web/src/lib/family/`, own additive migrations, a `FAMILY_ENABLED` flag. Every upstream file you change gets a line in `family/upstream-touches.md` saying why.
- Public fork docs live in `family/`, not `docs/` (that is upstream's website).
- Leave `mobile/` (the Flutter app) untouched. The fork's mobile client is a separate app; don't regenerate the Dart client.
- AGPL-3.0: keep license headers. No telemetry, no new third-party services. Secrets only in env files, never in the repo.
- Commits: small and clear. Do not add any additional authors; only the owner is attributed.
