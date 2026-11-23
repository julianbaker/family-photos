# Upstream files touched by the fork

Every upstream file the fork changes, and why. Check these first when merging an upstream release.

| File | Change | Why |
|---|---|---|
| `.gitignore` | added `.family-build/` and `internal/` | local build logs; private planning repo |
| `AGENTS.md`, `CLAUDE.md` (new at root) | agent rules for the fork | upstream has none at v3.4.2; may conflict if upstream adds one |
| `docker/docker-compose.family-dev.yml` (new) | local dev overrides: stock ML image, ports on localhost only | the fork does not change ML; keeps the dev DB off the network |
