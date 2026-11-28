# Notes for AI coding agents

Read [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md) and
[docs/architecture.md](docs/architecture.md) before changing code.
[docs/product.md](docs/product.md) holds the roadmap and the backlog.

- Design for the whole product, build the smallest part (first principle in
  [docs/product.md](docs/product.md#principles)). Before any decision, list the
  cases at full size: many products, many people, every kind of emergency,
  several at once, long history. Build the minimum, but in a shape that holds
  all of them.
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
