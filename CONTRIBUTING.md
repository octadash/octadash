# Contributing to Octadash

Thanks for helping. A few rules keep the project easy to work on.

## Before you start

- For anything larger than a small fix, open an issue first so we agree on the
  approach.
- Read [docs/adr/0001-stack.md](docs/adr/0001-stack.md): it explains the
  architecture and the rules every module follows.

## Conventions

- Code, comments, commit messages and docs are in **English**. The UI is
  translated (English and Brazilian Portuguese): every user-facing string goes
  through `next-intl` messages in `apps/web/messages/`.
- TypeScript strict mode. No `any` without a comment explaining why.
- Every table with customer data has `org_id` and `project_id`.
- High-volume tables are partitioned by day; dashboards read rollups.
- Health endpoints never query a database.
- New alert channels and data sources are integrations in
  `packages/integrations`, never special cases in the app.
- Migrations are append-only: never edit a released one.

## Workflow

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
```

Keep pull requests focused on one change and include tests for new behavior.
CI must pass before review.

## License

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE).
