# Notes for AI coding agents

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/adr/0001-stack.md](docs/adr/0001-stack.md) before changing code.

- Monorepo: pnpm workspaces + Turborepo. Node 24, TypeScript 6 (strict).
- Before finishing: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
  Database tests run when `DATABASE_URL` is set (`pnpm db:up` starts Postgres).
- Workspace packages export TypeScript source (`exports` points to `src/`).
  Relative imports have no file extension.
- `apps/ingest` and `apps/worker` are bundled into single files by
  `scripts/bundle.mjs`; do not add dependencies that need native addons or
  worker-thread transports there.
- Migrations live in `packages/db/src/migrations/`, are registered in
  `index.ts`, and are never edited after release.
- Alert channels and data sources are integrations in `packages/integrations`.
- UI strings go in `apps/web/messages/en.json` and `pt-BR.json`.
- Brand: magenta `#C04482` (dark-theme accent `#E875AF`, light-theme accent
  `#A32C69`), Outfit for display text, Inter for body text.
