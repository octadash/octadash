# Product

What Octadash does, what it will do and in which order. How it is built lives
in [architecture.md](architecture.md).

Octadash delivers in one panel what is usually spread across six or more tools,
for all your products at once. Every day it answers one
question: **of my products, which ones need my attention, why, since when, and
what do I do about it?**

## Principles

- **Design for the whole product, build the smallest part.** Every decision
  starts from the full picture: twenty products, a team, every kind of
  emergency, ten products down at the same moment, months of data, the hosted
  version. The first version may build only a small part of it, but that part
  must fit the full picture, so growing it never means redoing it. When a
  design only works for one product, one alert or one person, it is not ready.
- **Built for its maintainer first.** Octadash is built to run the
  maintainer's own products. It is open source, so other people can use it too:
  the stacks it serves best are documented, and everything else works through
  standard SDKs (see [Getting data in](#getting-data-in)).
- **Deliver what they do, without being them.** PostHog and Sentry are good
  tools, and anyone who likes them can keep them: Octadash accepts the same
  SDKs. The difference is seeing every product together. In PostHog each
  product is a separate project (one on the free plan, six on the paid one), so
  checking the errors of all of them means opening each one. Octadash shows
  every area for all products at once or for one product, and crosses one area
  with another. A full-screen mode keeps it on a TV in the office.
- **Installed complete, ready on first start.** One install brings every
  module, with sensible defaults stored in the database (seeds): alert rules,
  thresholds, retention. The owner installs it, adds the snippet to a product,
  and it works. Every default can be changed per product.
- **Tell, do not guess.** Octadash never inspects a product from outside to
  guess which tools it uses. The owner says what to set up, gets instructions,
  and the state of each module comes from the data that actually arrives.
- **No number without an origin.** A value is assigned to a product only when its
  source says which product it belongs to. Octadash never guesses: AI spend seen
  only on the provider account shows as "unassigned spend", and a tool that
  cannot split by product is shown as such.
- **Every metric explains itself.** Each number carries its definition, formula,
  limits, what to look into, and the event that is missing when it cannot be
  computed.
- **Uptime never wakes a product's database.** The recommended check is a
  `/health` endpoint that answers without a query, and the panel explains why
  (see [Uptime](#uptime)).
- **The list grows step by step.** The [backlog](#backlog) is the full size of what
  can be built. Items leave it when they are needed, not all at once.

## Areas

Every area works for **all products at once**, for **a group of products** or
for **one product**, on the same screen. The panel has a menu with one entry per
area and a product picker at the top: "All products" first, then the groups,
then the products, then "New product" and "New group".

A group ("Clients", "My SaaS") is a name and a set of products; a product can
be in several groups. Opening a group shows the same pages as "All products",
filtered to its products and with their totals. A TV screen can show one group.
The emergency strip ignores the filter: an outage anywhere shows on every
screen.

| Area            | Answers                                           | Runs in                 |
| --------------- | ------------------------------------------------- | ----------------------- |
| Overview        | what needs my attention, and the day in numbers   | (built from the others) |
| Uptime          | is it up, is the certificate valid, did a job run | Octadash (no code)      |
| Traffic         | who comes and from where                          | browser                 |
| Product usage   | sign-ups, logins, key actions, funnel, retention  | browser and server      |
| Errors          | what broke and for how many people                | browser and server      |
| Money           | revenue, MRR, churn, refunds                      | connectors (no code)    |
| Costs           | AI cost, infra cost, margin                       | server and connectors   |
| Logs and traces | what the server did at that moment                | server                  |

Alert channels and data sources are integrations (`packages/integrations`).
Community modules and integrations use the same contract and arrive by pull
request.

### Switching areas off

There is no setup preset: an install starts with every area on. Each product
card has "I won't use this" (see [Product page](#product-page)). For people who
want an area gone everywhere, the instance settings have an advanced on/off
switch per area: an area that is off registers no ingest route, schedules no
job and is hidden from the panel and the MCP server.

## Onboarding

1. **Create a product: only its name.** No URL, no platform. A product usually
   has parts in different languages (a JavaScript front end, a .NET back end),
   so the platform is chosen inside each area, not on the product.
2. **Land on the product page**, which starts as a setup page and becomes the
   product's dashboard as data arrives, without changing screens.

### Product page

One card per area. A card goes through three moments, always in the same place:

| Moment              | What the card shows                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Not set up          | What the area does, a "Set up" button and "I won't use this"                                                                    |
| Set up, no data yet | The area's real card with sample data, blurred, and a small label on top (as Google Search Console does). No "waiting" screens. |
| Receiving data      | The area's summary: the main number, a small chart and a link to the full screen                                                |

"I won't use this" removes the card from the page and moves it to a collapsed
strip at the bottom, "Also available for this product", which explains each area
in one line and can turn it back on. The same list is in the product settings.
There is no "skip" or "not now": leaving a card alone already means "not now".

### Set up an area

"Set up" opens the area's empty state, modelled on PostHog's: what the area
does, instructions in tabs per platform with the product's keys already filled
in, and a sample of what the data will look like. Browser and server use the
same project key, as in Sentry and PostHog; only the snippet changes.

## Getting data in

| Area            | Primary path (best supported)         | Other languages and tools                            |
| --------------- | ------------------------------------- | ---------------------------------------------------- |
| Traffic         | Octadash browser script               | (any site can add the script)                        |
| Errors          | Octadash SDK for the browser and Node | Sentry SDKs (every language Sentry supports)         |
| Product usage   | Octadash SDK for the browser and Node | OpenTelemetry; PostHog SDKs as a compatibility extra |
| Costs (AI)      | Octadash wrapper for Node             | OpenTelemetry `gen_ai`                               |
| Logs and traces | OpenTelemetry (OTLP over HTTP)        | any OpenTelemetry SDK                                |
| Uptime, Money   | nothing to install                    |                                                      |

Octadash writes its own SDKs only where they bring something extra: one browser
script for traffic, errors and events together, and a package for Node and
Next.js, which is what the maintainer's products use. For .NET, Python, Ruby,
PHP, Go and the rest, Octadash accepts the SDKs people already use.

How stable each format has been (checked on 2026-11-27):

- **OpenTelemetry (OTLP):** stable for traces, metrics and logs, and evolves
  without breaking (new fields are ignored). The `gen_ai` conventions are still
  in development, so their attribute names may change.
- **Sentry:** one breaking change, from `/store` to `/envelope` (server 20.6,
  2020; JavaScript SDK v7, iOS SDK v6). Since then only new item types were
  added, and an unknown item can be skipped.
- **PostHog:** an internal format with no stability promise. In October 2026
  PostHog added "capture v1" (`/i/v1/analytics/events`, `/i/v1/ai/events`), and
  the new server and mobile SDK majors (Python 8, Node 6, Go 2, iOS 4,
  Android 4, Flutter 6) send only there. The web SDK still uses the old
  endpoints. This is why PostHog is a compatibility extra, not the main path.

The docs keep a **supported SDKs** table: each SDK and the version range tested
("Sentry .NET 5.x: tested"). CI runs those real SDKs against the ingest service,
and automated dependency updates open a pull request for every new version, so
a format change breaks a test before it reaches a user.

## Alerts

Octadash separates three kinds of information:

| Kind      | Example                                 | What happens                                                                                                          |
| --------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Emergency | site down, checkout broken, error spike | Sent at once to the chosen channels, and a red strip on top of every screen until someone resolves or acknowledges it |
| Signal    | sign-ups on one product dropped         | No message. Highlighted in its area (the product's row turns red with the difference) and listed in the daily summary |
| Data      | everything else                         | Shown, neutral                                                                                                        |

Every rule ships as a seed and can be changed per product: "down for 2
minutes" can become 5, "certificate expires in 7 days" can become 10, "errors 5
times above normal" can become 10. Owners can also turn any signal into an alert
of their own ("tell me if sign-ups on this product drop 30%").

### What "normal" means for a signal

The expected value combines two things:

- the **shape**: how much this hour of this weekday usually represents, from the
  same weekday and hour over the last 4 weeks;
- the **level**: the last 7 days, so a campaign that lifted everything by 50%
  lifts the expected value by 50%.

Expected = shape × level. A signal fires when the real value is 30% away from
the expected one and the period has at least 10 events, so a small product going
from 2 sign-ups to 1 does not become "−50%" every day. The card shows both
comparisons ("−35% against expected; last 7 days −40%, same weekdays +5%").
A product with less than 4 weeks of data shows "still learning what is normal"
and raises no signals. All these numbers are seeds and can be changed.

### Channels

Each channel is an integration the owner sets up with their own credentials, as
in Coolify, with a "Send test" button. Octadash has no account of its own that
sends anything. Rules choose the channels: for example, emergencies to Telegram
and email, the daily summary only by email.

| Channel  | Setup                                                                                                                                            | When    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Email    | SMTP (any server: Gmail, Zoho, SES...) or the Resend API. Also sends invites and password resets.                                                | step 2  |
| Telegram | bot token and chat id                                                                                                                            | built   |
| Webhook  | URL and an optional secret (covers Slack, Discord, n8n)                                                                                          | built   |
| WhatsApp | official Cloud API (a separate sender number, an approved "utility" template, about R$ 0.035 per message in Brazil) or the owner's Evolution API | backlog |

## Uptime

- A product can have **several monitors**, each with a name, a URL and a type:
  site (GET the home page), API or `/health` (GET, expects 2xx and not HTML),
  heartbeat (a cron job or backup calls an Octadash URL; silence is an
  emergency), and TCP port later. The first monitor is suggested as "Site", so
  the owner only pastes the URL. The product's "Uptime" card shows the worst
  state among its monitors.
- **Waking the database.** The monitor form recommends a `/health` endpoint
  that does not query the database, shows a ready snippet per framework, and
  warns that a page that queries the database wakes it on every check. Neon
  suspends an idle database after 5 minutes by default, so a check every minute
  on a page that queries it keeps it awake and billed. When the URL is the home
  page, the form suggests a longer interval.
- **Same server.** Octadash compares the monitored address with its own public
  IP. When they match, the card warns: "this monitor runs on the same server as
  the product; if the server goes down, you will not be told".
- **Who watches Octadash.** If Octadash's own server goes down, every alert
  stops silently. Every install is told to set up an outside watcher: Octadash
  sends a heartbeat every minute to a service such as Healthchecks.io (free
  plan), which alerts the owner when the heartbeats stop. The install guide has
  this step, and the settings show a warning until it is set up, stronger when
  a monitor shares the server's IP. The hosted version can sell an outside
  check later.
- The checks that are certain (status code, HTTPS, certificate expiry, the
  http to https redirect, response time) belong to uptime. Octadash no longer
  guesses tools from a site's HTML.

## Overview ("All products")

The screen the owner looks at all day. It is not a copy of each product page:
it puts every product side by side, area by area, and crosses areas.

From top to bottom:

0. **Emergency strip** (only when there is one) and **signals strip** ("3 things
   out of normal today", clickable).
1. **Uptime:** one row per product with a status dot, 30-day uptime, response
   time and days until the certificate expires.
2. **Traffic:** visitors today per product, against yesterday, with a 7-day
   sparkline. The total is at the top of the block.
3. **Product usage:** sign-ups and logins today per product against normal.
   This is where "sign-ups on Tribunal dropped" shows up.
4. **Errors:** new errors in the last 24 hours and people affected, per product.
5. **Money:** today's revenue and MRR per product, with the total.
6. **Costs:** AI and infra cost per product and the margin (revenue minus cost).

Logs are not on the overview (they are for investigating), but the Logs area
works for all products at once like every other area.

## Roadmap to 1.0

Version 1.0 includes every step below. They ship one at a time, in this order.
Each step ships with its MCP tools (read-only queries for AI assistants) and its
docs.

| #   | Step                  | Delivers                                                                                                                                                                                         | State |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| 0   | Foundation            | accounts, organizations, products, API keys, setup wizard                                                                                                                                        | done  |
| 1   | New base              | ClickHouse and Valkey in the install, ingest that answers at once and queues in Valkey, area menu and product picker, product created by name, product page in setup mode, URL diagnosis removed | done  |
| 2   | Uptime and alerts     | monitors, heartbeats, certificate, seeded rules, emergency strip, channels (email with SMTP and Resend, Telegram, webhook), outside watcher                                                      | next  |
| 3   | Traffic               | Octadash browser script; first data in ClickHouse; overview starts                                                                                                                               |       |
| 4   | Errors                | Octadash SDK (browser and Node), Sentry SDK compatibility                                                                                                                                        |       |
| 5   | Product usage         | events, sign-ups, logins; signals start here                                                                                                                                                     |       |
| 6   | Money                 | Stripe, Asaas, Paddle                                                                                                                                                                            |       |
| 7   | AI cost               | Octadash wrapper, OpenTelemetry `gen_ai`                                                                                                                                                         |       |
| 8   | Infra cost and margin | provider APIs or manual entries                                                                                                                                                                  |       |
| 9   | Logs and traces       | OTLP over HTTP                                                                                                                                                                                   |       |
| 10  | Daily summary         | what changed since yesterday, by email and the alert channels                                                                                                                                    |       |

Rules that apply to every step:

- Retention is configurable per area, with personal data masking in errors
  and logs.
- Money keeps contracted, paid, settled, refunded, fees and net amounts apart.
  Mixing them makes MRR wrong.
- Product usage starts from a list of standard event names
  (`signup.completed`, `user.activated`, `checkout.completed`,
  `payment.confirmed`, `subscription.canceled` and so on), so dashboards work
  without setup.
- Signals arrive with each area from step 5 on.

## Backlog

What other tools deliver and the roadmap does not cover yet. "Seen in" names
tools that already do it. Priority is a suggestion: **high** right after the
module it extends, **medium** when someone needs it, **low** only with time to
spare.

### Base: availability and alerts

| Item                                                       | Seen in                       | Priority |
| ---------------------------------------------------------- | ----------------------------- | -------- |
| Heartbeats for cron jobs, workers, backups                 | Healthchecks.io, Better Stack | high     |
| Content check (200 but broken page)                        | UptimeRobot                   | high     |
| Domain expiry                                              | UptimeRobot                   | high     |
| Public status page                                         | Better Stack, Uptime Kuma     | high     |
| Maintenance windows                                        | Better Stack                  | high     |
| Octadash watching its own health (outside watcher, step 2) | all                           | high     |
| Full-screen TV mode for the "All products" tab             | Grafana, Geckoboard           | high     |
| DNS resolution and DNS changes                             | UptimeRobot                   | medium   |
| TCP ports and ping                                         | UptimeRobot, Uptime Kuma      | medium   |
| SLA and SLO reports                                        | Better Stack                  | medium   |
| Vendor status (Stripe, Vercel, OpenAI down)                | Better Stack                  | medium   |
| Synthetic tests with Playwright                            | Checkly                       | medium   |
| Alert escalation and acknowledgement                       | Better Stack, PagerDuty       | medium   |
| Checks from several regions                                | UptimeRobot, Checkly          | low      |
| Visual diff between versions                               | Checkly                       | low      |

### Web analytics (beyond step 3)

| Item                                        | Seen in               | Priority |
| ------------------------------------------- | --------------------- | -------- |
| Exit pages, time on page, bounce rate       | GA, Umami             | high     |
| Bot traffic kept apart                      | Cloudflare, Plausible | high     |
| Traffic from AI assistants                  | Umami, Plausible      | high     |
| Goals and conversion events on the site     | Plausible, Umami      | high     |
| Import history from GA, Umami and Plausible | Plausible             | high     |
| Outbound clicks and downloads               | Plausible, Umami      | medium   |
| Scroll depth                                | Plausible, PostHog    | medium   |
| Site search terms                           | GA, Matomo            | medium   |
| Real-user Core Web Vitals                   | Vercel, Sentry        | medium   |
| Public dashboard or share link              | Plausible, Umami      | medium   |
| Chart annotations ("launched here")         | GA, PostHog           | medium   |
| Cross-domain journeys                       | GA                    | low      |

### Product events (beyond step 5)

| Item                               | Seen in                      | Priority |
| ---------------------------------- | ---------------------------- | -------- |
| Activation and time to first value | Amplitude, Mixpanel          | high     |
| Feature adoption                   | PostHog, Pendo               | high     |
| Inactive and reactivated users     | Mixpanel                     | high     |
| Stickiness (DAU/MAU)               | Mixpanel                     | medium   |
| Cohorts and segments               | PostHog, Amplitude           | medium   |
| User journeys                      | Amplitude                    | medium   |
| North Star metric                  | Amplitude                    | medium   |
| Click autocapture                  | PostHog, Heap                | medium   |
| In-app surveys (NPS, CSAT)         | Formbricks, PostHog          | medium   |
| Feedback and bug report widget     | Sentry, Userback             | medium   |
| Session replay                     | PostHog, OpenReplay, Clarity | low      |
| Heatmaps, rage clicks, dead clicks | Clarity, Hotjar              | low      |
| Feature flags                      | PostHog, Unleash             | low      |
| A/B tests                          | GrowthBook, PostHog          | low      |

### Ecommerce and conversion

| Item                                              | Seen in          | Priority |
| ------------------------------------------------- | ---------------- | -------- |
| Revenue per visitor                               | Plausible, Umami | high     |
| Payment decline reasons                           | Stripe           | high     |
| Abandoned cart and checkout                       | GA, Shopify      | medium   |
| Conversion by device, channel and product         | GA               | medium   |
| Average order value, repeat purchase, top sellers | GA, Shopify      | medium   |
| Coupons used                                      | Shopify          | low      |

### Errors (beyond step 4)

| Item                               | Seen in              | Priority |
| ---------------------------------- | -------------------- | -------- |
| Source maps                        | Sentry               | high     |
| Errors per release and regressions | Sentry               | high     |
| Errors hitting paying customers    | none (needs revenue) | high     |
| Breadcrumbs                        | Sentry               | medium   |
| Crash-free sessions                | Sentry               | medium   |
| Open a GitHub issue from an error  | Sentry               | medium   |
| Mobile and desktop app errors      | Sentry, Crashlytics  | medium   |

### Revenue and payments (beyond step 6)

| Item                                                         | Seen in                   | Priority |
| ------------------------------------------------------------ | ------------------------- | -------- |
| MRR movements (new, expansion, contraction, reactivation)    | Baremetrics, ChartMogul   | high     |
| Voluntary and involuntary churn                              | Baremetrics               | high     |
| Trial conversion                                             | Baremetrics               | high     |
| Pending, overdue and declined payments                       | Asaas, Stripe             | high     |
| Refunds and chargebacks                                      | Stripe, Asaas             | high     |
| Reconciliation between gateway and product (paid, no access) | none                      | high     |
| GRR and NRR                                                  | ChartMogul                | medium   |
| ARPU, LTV, CAC, payback                                      | Baremetrics, ProfitWell   | medium   |
| Revenue by plan, country, channel and cohort                 | ChartMogul                | medium   |
| Revenue concentration                                        | ChartMogul                | medium   |
| Fees per payment method (card, Pix, boleto)                  | Asaas                     | medium   |
| Balance, receivables and payout delay                        | Asaas, Stripe             | medium   |
| Dunning and recovered payments                               | Baremetrics, Churnkey     | medium   |
| Cancellation reasons                                         | Baremetrics, Churnkey     | medium   |
| Margin, break-even, burn and runway                          | spreadsheets, Baremetrics | medium   |
| Revenue goals and forecast                                   | Baremetrics               | low      |

### AI (beyond step 7)

| Item                                            | Seen in                        | Priority |
| ----------------------------------------------- | ------------------------------ | -------- |
| Cost per user, feature, session and agent       | Helicone, Langfuse             | high     |
| Budget per product with alert                   | Helicone                       | high     |
| Margin per AI user                              | none (needs revenue)           | high     |
| Latency, time to first token, tokens per second | Helicone, Langfuse             | medium   |
| Rate limits, retries and fallbacks              | Helicone                       | medium   |
| Cached and reasoning tokens                     | Helicone                       | medium   |
| Agent traces, tool calls and MCP calls          | LangSmith, Langfuse            | medium   |
| Agent loops                                     | LangSmith                      | medium   |
| Prompt versions                                 | Langfuse                       | medium   |
| Human feedback on answers                       | Langfuse, Helicone             | medium   |
| Audio, image and phone call cost                | Helicone                       | medium   |
| Automatic evaluations and RAG quality           | LangSmith, Braintrust, Phoenix | low      |

### Infrastructure and cost (beyond step 8)

| Item                                        | Seen in                | Priority |
| ------------------------------------------- | ---------------------- | -------- |
| CPU, memory, disk and network of the VPS    | Netdata, Better Stack  | high     |
| Disk-full forecast                          | Netdata                | high     |
| Deploys, deploy frequency and rollbacks     | Vercel, Sentry, GitHub | high     |
| Cost per product for each vendor            | OpenCost, spreadsheets | high     |
| Containers, restarts and OOM kills          | Netdata, Coolify       | medium   |
| Database connections, size and slow queries | Neon, pganalyze        | medium   |
| Queue size, oldest job and failures         | Better Stack           | medium   |
| Backups done and restore tests              | none                   | medium   |

### Logs and traces (beyond step 9)

| Item                                                    | Seen in           | Priority |
| ------------------------------------------------------- | ----------------- | -------- |
| Saved queries and alerts on a pattern                   | Seq               | high     |
| Request and correlation IDs across logs, errors, traces | Seq, Sentry       | high     |
| Secret and personal data redaction                      | Seq               | high     |
| Live tail                                               | Seq, Better Stack | medium   |
| p50, p95, p99 latency and throughput                    | Sentry, SigNoz    | medium   |
| Slow outbound calls                                     | SigNoz, Sentry    | medium   |
| Service map                                             | SigNoz            | low      |
| Profiling                                               | Sentry, Pyroscope | low      |

### New areas (each can become an optional module)

| Area                    | Items                                                                                                                                                                                | Seen in                            | Priority                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------- |
| Data quality            | last event received, ingest delay, invalid, duplicate and dropped events, missing properties, test data in production, instrumentation coverage                                      | PostHog, Segment                   | high                                         |
| SEO                     | Search Console impressions, clicks, CTR and position; sitemap, robots.txt, noindex, canonical; broken links; meta and Open Graph tags; structured data                               | Search Console, Ahrefs, Semrush    | high                                         |
| Webhooks                | received, processed, failed, duplicated, out of order, bad signature, expired credentials, sync history, replay                                                                      | Hookdeck, Svix                     | high                                         |
| Agents                  | MCP with ready questions ("what changed today?") and safe actions (mute an alert, open an incident)                                                                                  | Sentry, Umami, PostHog             | high                                         |
| Email and messages      | sent, delivered, bounces, spam complaints, unsubscribes; SPF, DKIM, DMARC; welcome and password-reset emails arriving; WhatsApp and SMS delivery                                     | Resend, Postmark, SES              | high for SPF/DKIM/DMARC, medium for the rest |
| Security                | security headers, insecure cookies, vulnerable dependencies, exposed secrets, failed logins, auth spikes, rate limits hit                                                            | Mozilla Observatory, Trivy, GitHub | high for headers, medium for the rest        |
| Marketing               | UTM builder, tracked links, first and last touch attribution, leads, ad spend, CPC, CPA, ROAS, referrals and affiliates                                                              | GA, Meta Ads, Google Ads           | medium                                       |
| Customers and support   | per-customer profile and timeline, last activity, plan, revenue and cost per customer, tickets, response time, NPS, store reviews, churn risk, account health, upgrade opportunities | Intercom, Chatwoot, Vitally        | medium                                       |
| Mobile and desktop apps | installs, active versions, ratings, App Store and Google Play revenue                                                                                                                | App Store Connect, RevenueCat      | medium                                       |
| Accessibility           | contrast, images without alt text, unlabeled form fields, WCAG checks per release                                                                                                    | Lighthouse, axe                    | low                                          |

## Connectors

Every connector uses the contract in `packages/integrations`: a form generated
from its schema, encrypted secrets and a "Test" button. Read-only access
whenever the service allows it. Built today: Telegram and webhook.

| Category               | Feeds                 | Planned                                                                                 | Backlog                                                                                                 |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Alert channels         | alerts, daily summary | email (SMTP and Resend, built), Telegram (built), webhook (built), Slack, Discord, ntfy | WhatsApp, Microsoft Teams, Google Chat, mobile push, PagerDuty, Pushover, SMS                           |
| Payments               | revenue               | Stripe, Asaas, Paddle                                                                   | Mercado Pago, Pagar.me, Iugu, Hotmart, Kiwify, Eduzz, Lemon Squeezy, RevenueCat, App Store, Google Play |
| AI providers           | AI cost               | OpenAI, Anthropic, OpenRouter, own wrapper, OTel `gen_ai`, PostHog `$ai_generation`     | Google Gemini, Groq, Mistral, ElevenLabs, Replicate, fal, Vercel AI Gateway                             |
| Hosting and databases  | infra cost            | infra providers (generic)                                                               | Vercel, Neon, Supabase, Coolify, Railway, Fly.io, Hetzner, DigitalOcean, Cloudflare, AWS                |
| Code and deploys       | deploys, releases     | none                                                                                    | GitHub (deploys, releases, issues, Dependabot), GitLab, Vercel and Coolify deploys                      |
| Compatible ingest      | errors, events, logs  | Sentry SDK, PostHog capture, OTLP                                                       | Vercel Analytics drain, Plausible and Umami APIs (history import), Segment                              |
| Transactional email    | email                 | none                                                                                    | Resend, Postmark, Amazon SES, SendGrid, Brevo                                                           |
| Search and ads         | SEO, marketing        | none                                                                                    | Google Search Console, Meta Ads, Google Ads, TikTok Ads                                                 |
| Support and reputation | customers             | none                                                                                    | Chatwoot, Intercom, Crisp, App Store and Google Play reviews                                            |
| Vendor status          | base                  | none                                                                                    | public status pages (Statuspage, Better Stack, instatus)                                                |

Asaas and Pix set Octadash apart from other open source panels
(Umami, Plausible, Uptime Kuma).

## Cross-signal diagnoses

No single tool delivers these, because each needs data from two areas. A
diagnosis appears only when the modules it needs are on, and always has the same
fields: what was seen, the evidence, a hypothesis, the confidence (with explicit
criteria), the impact, the next step and the source. Correlation is not
causation: the text says "may be", never "caused".

| Signals together                                 | What it may mean                       | Modules               |
| ------------------------------------------------ | -------------------------------------- | --------------------- |
| Deploy + more errors                             | the new version broke something        | infra + errors        |
| Deploy + fewer sign-ups                          | sign-up is broken                      | infra + events        |
| Normal traffic + zero sign-ups                   | form or collection is broken           | web + events          |
| Uptime fine + synthetic test failing             | site is up, but the flow does not work | base                  |
| Payment approved + account not activated         | customer paid and got no access        | revenue + events      |
| Payment approved + webhook missing               | gateway integration stopped            | revenue + webhooks    |
| Subscription canceled + access kept              | wrong permissions                      | revenue + events      |
| Errors + abandoned checkout                      | a bug is costing sales                 | errors + ecommerce    |
| Cancellations + recent errors                    | churn from a bad experience            | revenue + errors      |
| Churn + failed charges                           | involuntary loss                       | revenue               |
| Stable sign-ups + falling activation             | onboarding problem                     | events                |
| AI usage up + revenue flat                       | usage nobody pays for                  | AI + revenue          |
| Cost per user above that user's revenue          | loss-making customer                   | AI + revenue          |
| More tokens + new prompt version                 | the prompt got more expensive          | AI                    |
| Paid traffic up + revenue flat                   | inefficient campaign                   | marketing + revenue   |
| Organic traffic down + noindex                   | page dropped out of search             | web + SEO             |
| Bounced emails + incomplete onboarding           | email is blocking activation           | email + events        |
| Disk growing + logs spiking                      | the server will fill up                | infra + logs          |
| Certificate expiring + high traffic              | a predictable outage                   | base + web            |
| Same vendor failing on several products          | shared incident                        | base ("All products") |
| Several products without events at the same time | shared collection or infra is down     | data quality          |
| Product with no revenue + recurring cost         | product consuming without return       | revenue + infra cost  |

**Missing signals** deserve their own alerts: warn when something that should
happen stopped (sign-ups, payments, webhooks, backups, emails, jobs). Small
products have low volume, so the threshold must consider the normal gap between
events, or it becomes a false alarm.

## How the backlog moves

An item becomes work when it meets at least two of these:

1. One of the maintainer's products needs it now.
2. It comes almost free from data an enabled area already collects (security
   headers and SPF come from the uptime checks).
3. It feeds a cross-signal diagnosis.
4. Someone from the community asked for it or sent the pull request.

What does not move: the order of steps 0 to 10, the stack (Postgres, Valkey and
ClickHouse, managed by Octadash; see [architecture.md](architecture.md)) and the
rule that no number is assigned to a product without an explicit origin.
