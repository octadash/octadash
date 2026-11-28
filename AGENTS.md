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
- Never throw away data the ingest receives. What no area reads yet goes to
  `received`; a new route or kind of data declares its fate in
  `apps/ingest/src/fates.ts`; a discard needs a reason in `DISCARDS` and a
  `dropped:` count ([architecture](docs/architecture.md#nothing-received-is-thrown-away)).
- Public docs live in `apps/docs` (docs.octadash.com): their own app, image and
  deploy, nothing shared with the panel but `packages/snippets`. A change people
  see (a screen, a setting, an environment variable, an endpoint) updates its
  page in `apps/docs/content/docs` in the same pull request, in English
  (`page.mdx`) and Portuguese (`page.pt.mdx`). The code people paste lives in
  `packages/snippets`, so the panel's Set up and the docs never differ.
- UI strings go in `apps/web/messages/en.json` and `pt-BR.json`.
- Brand: magenta `#C04482` (dark-theme accent `#E875AF`, light-theme accent
  `#A32C69`), Outfit for display text, Inter for body text.
- Every change merged to `main` (feature, fix, decision, docs, roadmap) gets an
  entry in the site's changelog: `src/data/changelog.json` in `octadash/site`
  (English and Portuguese, São Paulo time, newest first; its README explains
  the format). Whoever merges the change adds the entry, in a short PR to the
  site right after. Several PRs of one change make one entry.
