# Contributing to Octadash

Thanks for helping. A few rules keep the project easy to work on.

## Before you start

- For anything larger than a small fix, open an issue first so we agree on the
  approach.
- Read [docs/architecture.md](docs/architecture.md): it explains the
  architecture and the rules every module follows.
- Design for the whole product, build the smallest part. A change that works
  for one product, one alert or one user must also hold for twenty products,
  a team, every kind of emergency and several at once. Say in the pull request
  which of those cases you considered.

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
