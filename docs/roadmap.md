# Roadmap to 1.0

Version 1.0 includes every module below. They ship one at a time, in this
order, which follows the observability levels the URL diagnosis reports:
alive, used, breaking, growing, earning, understood.

Each module ships with its MCP tools (read-only queries for AI assistants),
its docs, and its `npx octadash init` step where code changes are needed.

| #   | Module               | Answers                                          | Data arrives through                                      |
| --- | -------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| 0   | Foundation           | who can see what                                 | accounts, organizations, products, API keys, setup wizard |
| 1   | Diagnosis and levels | what is missing on this product                  | Octadash fetches the URL and its scripts                  |
| 2   | Uptime and alerts    | is it down                                       | checks from the worker; alert channels as integrations    |
| 3   | Web analytics        | who comes and from where                         | cookieless script; "All products" tab                     |
| 4   | Errors               | what broke and for how many people               | Sentry SDK, PostHog `$exception`                          |
| 5   | Product events       | sign-ups, logins, key actions, funnel, retention | Octadash SDK, PostHog capture                             |
| 6   | Revenue              | MRR, new, churn, refunds                         | Stripe, Asaas, Paddle                                     |
| 7   | AI cost              | cost, tokens, model, errors per product          | Octadash wrapper, OTel `gen_ai`, PostHog `$ai_generation` |
| 8   | Infra cost           | what each product costs to run                   | provider APIs or manual entries                           |
| 9   | Logs and traces      | what the server did at that moment               | OTLP over HTTP                                            |
| 10  | Daily summary        | what changed since yesterday                     | email and the alert channels                              |

Rules that apply to every module:

- No number is assigned to a product without an explicit origin. AI spend seen
  only on the provider account shows as "unassigned spend".
- Uptime never wakes a product's database.
- Retention is configurable per module, with personal data masking in errors
  and logs.
