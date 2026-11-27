# Product

What Octadash does, what it will do and in which order. How it is built lives
in [architecture.md](architecture.md).

Octadash gathers in one panel what is usually spread across six or more tools,
without trying to match the depth of each one. Every day it answers one
question: **of my products, which ones need my attention, why, since when, and
what do I do about it?**

## Principles

- **Gather, do not replace.** Sentry stays better at errors and PostHog at
  product analytics. Octadash wins by showing everything together, per product
  and in the "All products" tab, and by crossing one area with another.
- **Turn on what you need.** Someone who only wants analytics installs Octadash
  and turns on web analytics, as they would with Umami. Nothing is heavy for
  people who do not use it.
- **A base is always on:** the minimum comfort and safety for any product that is
  live (see [Layers](#layers)).
- **Compatible by design.** Point the Sentry SDK, the PostHog SDK or an
  OpenTelemetry exporter at Octadash and it works. Before building our own SDK
  for a module, accept the format people already use.
- **No number without an origin.** A value is assigned to a product only when its
  source says which product it belongs to. Octadash never guesses: AI spend seen
  only on the provider account shows as "unassigned spend", and a tool that
  cannot split by product is shown as such.
- **Every metric explains itself.** Each number carries its definition, formula,
  limits, what to look into, and the event that is missing when it cannot be
  computed.
- **Uptime never wakes a product's database.** Checks hit a `/health` endpoint
  that answers without a query; alerts fire after 3 failures in a row.
- **The list grows step by step.** The [backlog](#backlog) is the full size of what
  can be built. Items leave it when they are needed, not all at once.

## Layers

| Layer        | What it is                                                                                    | Examples                                                                       | Who decides  |
| ------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| Base         | The minimum for any live product. Cannot be switched off.                                     | accounts and products, URL diagnosis, uptime, SSL, domain expiry, alerts, heartbeats | us           |
| Modules      | A whole area: screens, tables, ingest routes, worker jobs, MCP tools. On or off per instance and per product. | web analytics, errors, product events, revenue, AI cost, infra cost, logs      | the installer |
| Integrations | An outside service that feeds a module or receives alerts (`packages/integrations`).          | Stripe, Asaas, Paddle, OpenAI, Telegram, Slack                                  | the installer |
| Community    | Modules and integrations built by others with the same contract, merged by pull request.      | a Hotmart connector, a surveys module                                           | code review  |

The setup wizard offers presets and the owner can change them later:

| Preset         | Turns on                                     | Similar to              |
| -------------- | -------------------------------------------- | ----------------------- |
| Analytics only | base + web analytics                         | Umami, Plausible        |
| Monitor        | base + errors + logs                         | UptimeRobot + Sentry    |
| Product        | base + web analytics + product events        | basic PostHog           |
| Business       | base + revenue + AI cost + infra cost        | Baremetrics + Helicone  |
| Everything     | all modules                                  | all of the above        |

The "All products" tab shows only modules that are on. The URL diagnosis
suggests modules: "your site has Stripe, turn on Revenue?".

## Observability levels

The URL diagnosis grades each product on six levels. They follow the order of
the modules below.

| Level        | Question                               | Answered from outside by                                                      |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------- |
| `alive`      | Is it up and safe to open?             | HTTP status, HTTPS, certificate                                               |
| `used`       | Do you know how many people visit?     | A web analytics script                                                        |
| `breaking`   | Do you find out when something breaks? | An error tracking SDK in the page or its bundles                              |
| `growing`    | Do you know what people do inside?     | A product analytics SDK (partial: events need the data)                       |
| `earning`    | Do you see the money coming in?        | Checkout links or payment SDKs (partial: revenue needs the gateway connected) |
| `understood` | Is it all together in one place?       | Never from outside; Octadash answers it with data                             |

`alive` also reports advice that does not lower the level: the http to https
redirect, the home page load time and a health endpoint (`/api/health`,
`/health`, `/healthz`, `/api/healthz`, `/api/status`, `/status`, answering 2xx
with something that is not HTML).

A status is `ok`, `partial` (a tool is there, but the URL alone can't confirm
the data), `missing` or `unknown` (not visible from outside). The score counts
levels that are `ok` or `partial`.

## Roadmap to 1.0

Version 1.0 includes every module below. They ship one at a time, in this order.
Each module ships with its MCP tools (read-only queries for AI assistants), its
docs, and its `npx octadash init` step where code changes are needed.

| #   | Module               | Answers                                          | Data arrives through                                      | State   |
| --- | -------------------- | ------------------------------------------------ | --------------------------------------------------------- | ------- |
| 0   | Foundation           | who can see what                                 | accounts, organizations, products, API keys, setup wizard | done    |
| 1   | Diagnosis and levels | what is missing on this product                  | Octadash fetches the URL and its scripts                  | done (MCP tools pending) |
| 2   | Uptime and alerts    | is it down                                       | checks from the worker; alert channels as integrations    | next    |
| 3   | Web analytics        | who comes and from where                         | cookieless script; "All products" tab                     |         |
| 4   | Errors               | what broke and for how many people               | Sentry SDK, PostHog `$exception`                          |         |
| 5   | Product events       | sign-ups, logins, key actions, funnel, retention | Octadash SDK, PostHog capture                             |         |
| 6   | Revenue              | MRR, new, churn, refunds                         | Stripe, Asaas, Paddle                                     |         |
| 7   | AI cost              | cost, tokens, model, errors per product          | Octadash wrapper, OTel `gen_ai`, PostHog `$ai_generation` |         |
| 8   | Infra cost           | what each product costs to run                   | provider APIs or manual entries                           |         |
| 9   | Logs and traces      | what the server did at that moment               | OTLP over HTTP                                            |         |
| 10  | Daily summary        | what changed since yesterday                     | email and the alert channels                              |         |

Rules that apply to every module:

- Retention is configurable per module, with personal data masking in errors
  and logs.
- Revenue keeps contracted, paid, settled, refunded, fees and net amounts apart.
  Mixing them makes MRR wrong.

Planned additions to these modules, decided on 2026-11-27:

- Module 2 brings the module on/off switch and the setup presets, plus
  heartbeats for cron jobs, workers and backups, domain expiry and maintenance
  windows, because they are part of the base.
- Module 5 starts from a list of standard event names (`signup.completed`,
  `user.activated`, `checkout.completed`, `payment.confirmed`,
  `subscription.canceled` and so on), so dashboards work without setup.

## Backlog

What other tools deliver and the roadmap does not cover yet. "Seen in" names
tools that already do it. Priority is a suggestion: **high** right after the
module it extends, **medium** when someone needs it, **low** only with time to
spare.

### Base: availability and alerts

| Item                                         | Seen in                        | Priority |
| -------------------------------------------- | ------------------------------ | -------- |
| Heartbeats for cron jobs, workers, backups   | Healthchecks.io, Better Stack  | high     |
| Content check (200 but broken page)          | UptimeRobot                    | high     |
| Domain expiry                                | UptimeRobot                    | high     |
| Public status page                           | Better Stack, Uptime Kuma      | high     |
| Maintenance windows                          | Better Stack                   | high     |
| Octadash watching its own health             | all                            | high     |
| DNS resolution and DNS changes               | UptimeRobot                    | medium   |
| TCP ports and ping                           | UptimeRobot, Uptime Kuma       | medium   |
| SLA and SLO reports                          | Better Stack                   | medium   |
| Vendor status (Stripe, Vercel, OpenAI down)  | Better Stack                   | medium   |
| Synthetic tests with Playwright              | Checkly                        | medium   |
| Alert escalation and acknowledgement         | Better Stack, PagerDuty        | medium   |
| Checks from several regions                  | UptimeRobot, Checkly           | low      |
| Visual diff between versions                 | Checkly                        | low      |

### Web analytics (beyond module 3)

| Item                                          | Seen in              | Priority |
| --------------------------------------------- | -------------------- | -------- |
| Exit pages, time on page, bounce rate         | GA, Umami            | high     |
| Bot traffic kept apart                        | Cloudflare, Plausible| high     |
| Traffic from AI assistants                    | Umami, Plausible     | high     |
| Goals and conversion events on the site       | Plausible, Umami     | high     |
| Import history from GA, Umami and Plausible   | Plausible            | high     |
| Outbound clicks and downloads                 | Plausible, Umami     | medium   |
| Scroll depth                                  | Plausible, PostHog   | medium   |
| Site search terms                             | GA, Matomo           | medium   |
| Real-user Core Web Vitals                     | Vercel, Sentry       | medium   |
| Public dashboard or share link                | Plausible, Umami     | medium   |
| Chart annotations ("launched here")           | GA, PostHog          | medium   |
| Cross-domain journeys                         | GA                   | low      |

### Product events (beyond module 5)

| Item                                       | Seen in                     | Priority |
| ------------------------------------------ | --------------------------- | -------- |
| Activation and time to first value         | Amplitude, Mixpanel         | high     |
| Feature adoption                           | PostHog, Pendo              | high     |
| Inactive and reactivated users             | Mixpanel                    | high     |
| Stickiness (DAU/MAU)                       | Mixpanel                    | medium   |
| Cohorts and segments                       | PostHog, Amplitude          | medium   |
| User journeys                              | Amplitude                   | medium   |
| North Star metric                          | Amplitude                   | medium   |
| Click autocapture                          | PostHog, Heap               | medium   |
| In-app surveys (NPS, CSAT)                 | Formbricks, PostHog         | medium   |
| Feedback and bug report widget             | Sentry, Userback            | medium   |
| Session replay                             | PostHog, OpenReplay, Clarity| low      |
| Heatmaps, rage clicks, dead clicks         | Clarity, Hotjar             | low      |
| Feature flags                              | PostHog, Unleash            | low      |
| A/B tests                                  | GrowthBook, PostHog         | low      |

### Ecommerce and conversion

| Item                                         | Seen in          | Priority |
| -------------------------------------------- | ---------------- | -------- |
| Revenue per visitor                          | Plausible, Umami | high     |
| Payment decline reasons                      | Stripe           | high     |
| Abandoned cart and checkout                  | GA, Shopify      | medium   |
| Conversion by device, channel and product    | GA               | medium   |
| Average order value, repeat purchase, top sellers | GA, Shopify | medium   |
| Coupons used                                 | Shopify          | low      |

### Errors (beyond module 4)

| Item                                        | Seen in              | Priority |
| ------------------------------------------- | -------------------- | -------- |
| Source maps                                 | Sentry               | high     |
| Errors per release and regressions          | Sentry               | high     |
| Errors hitting paying customers             | none (needs revenue) | high     |
| Breadcrumbs                                 | Sentry               | medium   |
| Crash-free sessions                         | Sentry               | medium   |
| Open a GitHub issue from an error           | Sentry               | medium   |
| Mobile and desktop app errors               | Sentry, Crashlytics  | medium   |

### Revenue and payments (beyond module 6)

| Item                                                     | Seen in                    | Priority |
| -------------------------------------------------------- | -------------------------- | -------- |
| MRR movements (new, expansion, contraction, reactivation)| Baremetrics, ChartMogul    | high     |
| Voluntary and involuntary churn                          | Baremetrics                | high     |
| Trial conversion                                         | Baremetrics                | high     |
| Pending, overdue and declined payments                   | Asaas, Stripe              | high     |
| Refunds and chargebacks                                  | Stripe, Asaas              | high     |
| Reconciliation between gateway and product (paid, no access) | none                   | high     |
| GRR and NRR                                              | ChartMogul                 | medium   |
| ARPU, LTV, CAC, payback                                  | Baremetrics, ProfitWell    | medium   |
| Revenue by plan, country, channel and cohort             | ChartMogul                 | medium   |
| Revenue concentration                                    | ChartMogul                 | medium   |
| Fees per payment method (card, Pix, boleto)              | Asaas                      | medium   |
| Balance, receivables and payout delay                    | Asaas, Stripe              | medium   |
| Dunning and recovered payments                           | Baremetrics, Churnkey      | medium   |
| Cancellation reasons                                     | Baremetrics, Churnkey      | medium   |
| Margin, break-even, burn and runway                      | spreadsheets, Baremetrics  | medium   |
| Revenue goals and forecast                               | Baremetrics                | low      |

### AI (beyond module 7)

| Item                                                  | Seen in                    | Priority |
| ----------------------------------------------------- | -------------------------- | -------- |
| Cost per user, feature, session and agent             | Helicone, Langfuse         | high     |
| Budget per product with alert                         | Helicone                   | high     |
| Margin per AI user                                    | none (needs revenue)       | high     |
| Latency, time to first token, tokens per second       | Helicone, Langfuse         | medium   |
| Rate limits, retries and fallbacks                    | Helicone                   | medium   |
| Cached and reasoning tokens                           | Helicone                   | medium   |
| Agent traces, tool calls and MCP calls                | LangSmith, Langfuse        | medium   |
| Agent loops                                           | LangSmith                  | medium   |
| Prompt versions                                       | Langfuse                   | medium   |
| Human feedback on answers                             | Langfuse, Helicone         | medium   |
| Audio, image and phone call cost                      | Helicone                   | medium   |
| Automatic evaluations and RAG quality                 | LangSmith, Braintrust, Phoenix | low  |

### Infrastructure and cost (beyond module 8)

| Item                                         | Seen in                 | Priority |
| -------------------------------------------- | ----------------------- | -------- |
| CPU, memory, disk and network of the VPS     | Netdata, Better Stack   | high     |
| Disk-full forecast                           | Netdata                 | high     |
| Deploys, deploy frequency and rollbacks      | Vercel, Sentry, GitHub  | high     |
| Cost per product for each vendor             | OpenCost, spreadsheets  | high     |
| Containers, restarts and OOM kills           | Netdata, Coolify        | medium   |
| Database connections, size and slow queries  | Neon, pganalyze         | medium   |
| Queue size, oldest job and failures          | Better Stack            | medium   |
| Backups done and restore tests               | none                    | medium   |

### Logs and traces (beyond module 9)

| Item                                         | Seen in           | Priority |
| -------------------------------------------- | ----------------- | -------- |
| Saved queries and alerts on a pattern        | Seq               | high     |
| Request and correlation IDs across logs, errors, traces | Seq, Sentry | high |
| Secret and personal data redaction           | Seq               | high     |
| Live tail                                    | Seq, Better Stack | medium   |
| p50, p95, p99 latency and throughput         | Sentry, SigNoz    | medium   |
| Slow outbound calls                          | SigNoz, Sentry    | medium   |
| Service map                                  | SigNoz            | low      |
| Profiling                                    | Sentry, Pyroscope | low      |

### New areas (each can become an optional module)

| Area                | Items                                                                                                    | Seen in                         | Priority |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------- | -------- |
| Data quality        | last event received, ingest delay, invalid, duplicate and dropped events, missing properties, test data in production, instrumentation coverage | PostHog, Segment | high |
| SEO                 | Search Console impressions, clicks, CTR and position; sitemap, robots.txt, noindex, canonical; broken links; meta and Open Graph tags; structured data | Search Console, Ahrefs, Semrush | high |
| Webhooks            | received, processed, failed, duplicated, out of order, bad signature, expired credentials, sync history, replay | Hookdeck, Svix | high |
| Agents              | MCP with ready questions ("what changed today?") and safe actions (mute an alert, open an incident)      | Sentry, Umami, PostHog          | high     |
| Email and messages  | sent, delivered, bounces, spam complaints, unsubscribes; SPF, DKIM, DMARC; welcome and password-reset emails arriving; WhatsApp and SMS delivery | Resend, Postmark, SES | high for SPF/DKIM/DMARC, medium for the rest |
| Security            | security headers, insecure cookies, vulnerable dependencies, exposed secrets, failed logins, auth spikes, rate limits hit | Mozilla Observatory, Trivy, GitHub | high for headers, medium for the rest |
| Marketing           | UTM builder, tracked links, first and last touch attribution, leads, ad spend, CPC, CPA, ROAS, referrals and affiliates | GA, Meta Ads, Google Ads | medium |
| Customers and support | per-customer profile and timeline, last activity, plan, revenue and cost per customer, tickets, response time, NPS, store reviews, churn risk, account health, upgrade opportunities | Intercom, Chatwoot, Vitally | medium |
| Mobile and desktop apps | installs, active versions, ratings, App Store and Google Play revenue                                | App Store Connect, RevenueCat   | medium   |
| Accessibility       | contrast, images without alt text, unlabeled form fields, WCAG checks per release                         | Lighthouse, axe                 | low      |

## Connectors

Every connector uses the contract in `packages/integrations`: a form generated
from its schema, encrypted secrets and a "Test" button. Read-only access
whenever the service allows it. Built today: Telegram and webhook.

| Category                 | Feeds                   | Planned                                                                     | Backlog                                                                                       |
| ------------------------ | ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Alert channels           | alerts, daily summary   | email (SMTP), Telegram (built), Slack, Discord, webhook (built), ntfy, WhatsApp | Microsoft Teams, Google Chat, mobile push, PagerDuty, Pushover, SMS                       |
| Payments                 | revenue                 | Stripe, Asaas, Paddle                                                       | Mercado Pago, Pagar.me, Iugu, Hotmart, Kiwify, Eduzz, Lemon Squeezy, RevenueCat, App Store, Google Play |
| AI providers             | AI cost                 | OpenAI, Anthropic, OpenRouter, own wrapper, OTel `gen_ai`, PostHog `$ai_generation` | Google Gemini, Groq, Mistral, ElevenLabs, Replicate, fal, Vercel AI Gateway           |
| Hosting and databases    | infra cost              | infra providers (generic)                                                   | Vercel, Neon, Supabase, Coolify, Railway, Fly.io, Hetzner, DigitalOcean, Cloudflare, AWS      |
| Code and deploys         | deploys, releases       | none                                                                        | GitHub (deploys, releases, issues, Dependabot), GitLab, Vercel and Coolify deploys            |
| Compatible ingest        | errors, events, logs    | Sentry SDK, PostHog capture, OTLP                                           | Vercel Analytics drain, Plausible and Umami APIs (history import), Segment                   |
| Transactional email      | email                   | none                                                                        | Resend, Postmark, Amazon SES, SendGrid, Brevo                                                 |
| Search and ads           | SEO, marketing          | none                                                                        | Google Search Console, Meta Ads, Google Ads, TikTok Ads                                       |
| Support and reputation   | customers               | none                                                                        | Chatwoot, Intercom, Crisp, App Store and Google Play reviews                                  |
| Vendor status            | base                    | none                                                                        | public status pages (Statuspage, Better Stack, instatus)                                      |

Asaas, Pix and WhatsApp set Octadash apart from other open source panels
(Umami, Plausible, Uptime Kuma).

## Cross-signal diagnoses

No single tool delivers these, because each needs data from two areas. A
diagnosis appears only when the modules it needs are on, and always has the same
fields: what was seen, the evidence, a hypothesis, the confidence (with explicit
criteria), the impact, the next step and the source. Correlation is not
causation: the text says "may be", never "caused".

| Signals together                                 | What it may mean                          | Modules                 |
| ------------------------------------------------ | ----------------------------------------- | ----------------------- |
| Deploy + more errors                             | the new version broke something           | infra + errors          |
| Deploy + fewer sign-ups                          | sign-up is broken                         | infra + events          |
| Normal traffic + zero sign-ups                   | form or collection is broken              | web + events            |
| Uptime fine + synthetic test failing             | site is up, but the flow does not work    | base                    |
| Payment approved + account not activated         | customer paid and got no access           | revenue + events        |
| Payment approved + webhook missing               | gateway integration stopped               | revenue + webhooks      |
| Subscription canceled + access kept              | wrong permissions                         | revenue + events        |
| Errors + abandoned checkout                      | a bug is costing sales                    | errors + ecommerce      |
| Cancellations + recent errors                    | churn from a bad experience               | revenue + errors        |
| Churn + failed charges                           | involuntary loss                          | revenue                 |
| Stable sign-ups + falling activation             | onboarding problem                        | events                  |
| AI usage up + revenue flat                       | usage nobody pays for                     | AI + revenue            |
| Cost per user above that user's revenue          | loss-making customer                      | AI + revenue            |
| More tokens + new prompt version                 | the prompt got more expensive             | AI                      |
| Paid traffic up + revenue flat                   | inefficient campaign                      | marketing + revenue     |
| Organic traffic down + noindex                   | page dropped out of search                | web + SEO               |
| Bounced emails + incomplete onboarding           | email is blocking activation              | email + events          |
| Disk growing + logs spiking                      | the server will fill up                   | infra + logs            |
| Certificate expiring + high traffic              | a predictable outage                      | base + web              |
| Same vendor failing on several products          | shared incident                           | base ("All products")   |
| Several products without events at the same time | shared collection or infra is down        | data quality            |
| Product with no revenue + recurring cost         | product consuming without return          | revenue + infra cost    |

**Missing signals** deserve their own alerts: warn when something that should
happen stopped (sign-ups, payments, webhooks, backups, emails, jobs). Small
products have low volume, so the threshold must consider the normal gap between
events, or it becomes a false alarm.

## How the backlog moves

An item becomes work when it meets at least two of these:

1. One of the maintainer's products needs it now.
2. It comes almost free from data an enabled module already collects (SPF and
   security headers come from the URL diagnosis).
3. It feeds a cross-signal diagnosis.
4. Someone from the community asked for it or sent the pull request.

What does not move: the order of modules 0 to 10, the stack (Postgres only, no
ClickHouse, no Redis) and the rule that no number is assigned to a product
without an explicit origin.
