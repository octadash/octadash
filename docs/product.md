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

## Glossary

The names below are the only names. The panel, the site, the docs, the API and
the code use them as written here (the Portuguese column is the panel's
translation). A new concept gets its row here before it reaches a screen.

### Structure

| Name            | Portuguese        | Meaning                                                                                                                   |
| --------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Organization    | Organização       | Who owns products and invites members. One install can hold several.                                                      |
| Product         | Produto           | Something the owner runs (a site, an app, a SaaS). Created with a name only.                                              |
| All products    | Todos os produtos | The first option of the product picker: every product of the organization.                                                |
| Group           | Grupo             | A saved set of products ("Main", "Clients"). Opens the same pages as All products, filtered. A product can be in several. |
| Area            | Área              | One entry of the menu (below). Every area works for all products, a group or one product.                                 |
| Source          | Origem            | One part of a product that sends data: "Site, Next.js", "API, .NET", "Worker, Node". Own key; can feed several areas.     |
| Source key      | Chave da origem   | Identifies product and source at the ingest, also inside a Sentry DSN. The install snippet comes with it filled in.       |
| Monitor         | Monitor           | One Uptime check of a product: Site, API or /health, Heartbeat.                                                           |
| Heartbeat       | Heartbeat         | A monitor that waits for a call from a cron job, worker or backup; silence is the failure.                                |
| Connection      | Conexão           | A link to an outside account that Money or Costs read from: Stripe, Asaas, Paddle, OpenAI, a VPS provider.                |
| Channel         | Canal             | Where alerts go: Email, Telegram, Webhook.                                                                                |
| Outside watcher | Vigia externo     | The outside service Octadash pings every minute, so someone hears when Octadash itself goes down.                         |

There is no "service" entity: the parts of a product are the sources of each
area, the monitors of Uptime and the connections of Money and Costs. Logs take
the service name OpenTelemetry already sends.

### Menu

| Name          | Portuguese      | Notes                                                                                      |
| ------------- | --------------- | ------------------------------------------------------------------------------------------ |
| Overview      | Visão geral     | With All products or a group: every area side by side. With one product: the product page. |
| Uptime        | Disponibilidade | Monitors, certificates, heartbeats.                                                        |
| Traffic       | Tráfego         | Visitors and where they come from.                                                         |
| Product usage | Uso             | Sign-ups, logins, key actions, funnel, retention.                                          |
| Errors        | Erros           | Browser and server errors.                                                                 |
| Money         | Dinheiro        | Revenue, MRR, churn, refunds; one-off sales and credit packs too.                          |
| Costs         | Custos          | Two parts: AI costs and Infra costs, plus the margin. The site may show them as two steps. |
| Logs          | Logs            | Logs and traces.                                                                           |
| Settings      | Configurações   | Organization, members, channels, alert rules, groups, outside watcher.                     |

### On screen

| Name                            | Portuguese                      | Meaning                                                                                                                                     |
| ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Product page                    | Página do produto               | Overview with one product: one card per area.                                                                                               |
| Set up                          | Configurar                      | Opens an area's setup: what it does, add a source, instructions per platform.                                                               |
| Add source                      | Adicionar origem                | Creates a source with a name and a platform and shows its snippet.                                                                          |
| I won't use this                | Não vou usar                    | Moves an area's card to the collapsed strip.                                                                                                |
| Also available for this product | Também disponível neste produto | The collapsed strip with the areas put aside; "Use again" brings one back.                                                                  |
| Example                         | Exemplo                         | Label on a blurred sample card: set up, no data yet. Never "waiting".                                                                       |
| Emergency                       | Emergência                      | Needs action now. Goes to the channels and to the emergency strip.                                                                          |
| Signal                          | Sinal                           | Out of normal, no message. Highlighted in its area and in the signals strip.                                                                |
| Data                            | Dado                            | Everything else, shown neutral.                                                                                                             |
| Emergency strip                 | Faixa de emergência             | The red bar on top of every screen. One bar for any number of emergencies: "2 emergencies: …" with "See all 2". Ignores the product picker. |
| Signals strip                   | Faixa de sinais                 | "3 things out of normal today" on the Overview.                                                                                             |
| I'm on it                       | Estou cuidando                  | Button on an emergency. Stops repeated messages and shows everyone, live, "Ana is on it · 6 min". The strip stays until it is resolved.     |
| Resolved                        | Resolvido                       | The emergency ended (the check passed again, or someone closed it).                                                                         |
| Still learning what is normal   | Aprendendo o normal             | A product with less than 4 weeks of data: no signals yet.                                                                                   |
| Unassigned spend                | Gasto sem produto               | Cost seen on a provider account that no product claims.                                                                                     |
| TV mode                         | Modo TV                         | Full screen Overview for All products or a group, updated live.                                                                             |
| Finding                         | Achado                          | A security problem found on a product: severity, since when, how to fix. Stays open until fixed or accepted.                                |

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

| Area          | Answers                                           | Runs in                 |
| ------------- | ------------------------------------------------- | ----------------------- |
| Overview      | what needs my attention, and the day in numbers   | (built from the others) |
| Uptime        | is it up, is the certificate valid, did a job run | Octadash (no code)      |
| Traffic       | who comes and from where                          | browser                 |
| Product usage | sign-ups, logins, key actions, funnel, retention  | browser and server      |
| Errors        | what broke and for how many people                | browser and server      |
| Money         | revenue, MRR, churn, refunds                      | connectors (no code)    |
| Costs         | AI cost, infra cost, margin                       | server and connectors   |
| Logs          | what the server did at that moment (logs, traces) | server                  |

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

The first run has two steps and then the product page:

1. **Account and organization, in one screen.** Whoever opens a new install
   first becomes its owner. Besides name, email, password and organization name
   it asks for the main currency and the time zone, both filled from the
   browser: money in other currencies keeps its value and is shown converted,
   and "today" and the daily summary follow that zone.
2. **Create a product: only its name.** No URL, no platform. A product usually
   has parts in different languages (a JavaScript front end, a .NET back end),
   so the platform is chosen inside each area, not on the product.
3. **Land on the product page**, which starts as a setup page and becomes the
   product's dashboard as data arrives, without changing screens.

On top of the first screens, owners and admins see "Get started": five steps
for the organization (first product, one area, where alerts go, the outside
watcher, invite people), each opening where it is done. It goes away when all
are done or when someone hides it, for everyone and for good.

Invitations go by email through the organization's first email channel, in
that channel's language; without one, the admin copies the link from Pending
invitations. The list says whether each email went out. An invited person sets
name and password (the email comes from the invitation) and lands on that
organization's Overview, with no setup steps. Settings › Members shows when
each person last opened the organization (per organization, written at most
every 5 minutes); owners alone give or take the owner role, and the last owner
can't step down or be removed. An organization
with no products (someone left step 2 halfway, or every product was removed)
shows the step 2 form in place of the Overview, never an empty dashboard;
members, who can't create products, are told to ask an admin.

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
does, the product's sources for that area with their state, "Add source", and a
sample of what the data will look like.

A source is one part of the product that sends data: "Site, Next.js",
"API, .NET", "Worker, Node". Adding one asks for a name and a platform, and the
instructions come in tabs per platform with the source's own key filled in.
Each source has its own key, so Octadash knows which part sent each event
without any extra setting in the code, and it works with any Sentry SDK, which
has no field for it. A product with one part has one source; Kitebox, for example, has
four. The area's card on the product page shows each source with its state
("Next.js receiving, .NET no data yet").

A source belongs to the product, not to one area, because the same code sends
more than one kind of data: the browser script sends pageviews (Traffic) and
events such as signup (Product usage) with one key, and a Sentry SDK sends
errors (Errors) and later traces (Logs). The area of each piece of data comes
from its type, never from the key, so a site never needs two keys or two
scripts. In a second area, setup offers "Use existing source: Site, Next.js"
next to "Add source". When data of a type arrives for an area that is not set
up yet, the area starts receiving on its own. Data for an area marked "I won't
use this" is dropped at the ingest and counted, and the strip "Also available
for this product" says the area is receiving data that is turned off.

## Getting data in

| Area          | Primary path (best supported)         | Other languages and tools                            |
| ------------- | ------------------------------------- | ---------------------------------------------------- |
| Traffic       | Octadash browser script               | (any site can add the script)                        |
| Errors        | Octadash SDK for the browser and Node | Sentry SDKs (every language Sentry supports)         |
| Product usage | Octadash SDK for the browser and Node | OpenTelemetry; PostHog SDKs as a compatibility extra |
| Costs (AI)    | OpenTelemetry `gen_ai`                | PostHog `$ai_generation`                             |
| Logs          | OpenTelemetry (OTLP over HTTP)        | any OpenTelemetry SDK                                |
| Uptime, Money | nothing to install                    |                                                      |

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

| Kind      | Example                                 | What happens                                                                                                                          |
| --------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Emergency | site down, checkout broken, error spike | Sent at once to the chosen channels, and a red strip on top of every screen until it is resolved ("I'm on it" only stops the repeats) |
| Signal    | sign-ups on one product dropped         | No message. Highlighted in its area (the product's row turns red with the difference) and listed in the daily summary                 |
| Data      | everything else                         | Shown, neutral                                                                                                                        |

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
  a monitor shares the server's IP. The ping URL belongs to the install (not to
  an organization), is stored encrypted, and is tested once when saved. The hosted version can sell an outside
  check later.
- The checks that are certain (status code, HTTPS, certificate expiry, the
  http to https redirect, response time) belong to uptime. Octadash no longer
  guesses tools from a site's HTML.

## Overview ("All products")

The screen the owner looks at all day. It is not a copy of each product page:
it puts every product side by side, area by area, and crosses areas. A group
shows the same page filtered to its products; the product page follows the
same pattern for one product, with the area cards after it. Closed with
the maintainer on 2026-11-28 in the panel canvas.

From top to bottom:

0. **Emergency strip** (only when there is one, ignores the filter) and
   **signals** ("3 things out of normal", clickable).
1. **Header:** period 24 hours, 7 days, 30 days or custom, always compared with
   the period right before, and "N online now".
2. **Numbers at the top**, one per area some product uses, each with its trend
   against the previous period and a sparkline: Uptime ("9 of 10 up now"),
   Visitors, Sign-ups, New errors, Revenue, Margin. Each opens its area.
3. **Big chart** with a tab per metric (Visitors, Sign-ups, Errors, Revenue,
   Costs), the previous period as a dashed line and marks for deploys and
   emergencies. "Show as a table" gives the same numbers as text.
4. **Products table**, one row per product: emergencies and signals first, then
   by visitors. Columns by area (uptime as a bar of hours, visitors with trend
   and sparkline, sign-ups, new errors, revenue and MRR, margin); "—" means the
   product doesn't use that area. Columns are configurable. A row opens the
   product.
5. **What happened**, a timeline of the period with only the products that had
   something (down, out of normal, deploy). The others are counted in one line.

Days and "today" follow the organization's time zone. Logs are not on the
overview (they are for investigating), but the Logs area works for all
products at once like every other area.

## Roadmap to 1.0

Version 1.0 includes every step below. They ship one at a time, in this order.
Each step ships with its MCP tools (read-only queries for AI assistants) and its
docs. The MCP server answers at `/api/mcp` with an organization's API token
(Octadash settings > API tokens), whose scopes say, item by item, what it may
read, write or delete; it lists only the tools they allow (docs at `/use/mcp`).
The `octadash-setup` skill (repository `octadash/skills`, `npx skills add
octadash/skills`) uses the setup tools to put Octadash in a codebase, app by
app, and migrates from PostHog, Sentry and Plausible (docs at
`/use/install-with-ai`). Each step's write tools join it as the step ships.

| #   | Step                  | Delivers                                                                                                                                                                                         | State       |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 0   | Foundation            | accounts, organizations, products, API keys, setup wizard                                                                                                                                        | done        |
| 1   | New base              | ClickHouse and Valkey in the install, ingest that answers at once and queues in Valkey, area menu and product picker, product created by name, product page in setup mode, URL diagnosis removed | done        |
| 2   | Uptime and alerts     | monitors, heartbeats, certificate, seeded rules, emergency strip, channels (email with SMTP and Resend, Telegram, webhook), outside watcher                                                      | done        |
| 3   | Traffic               | Octadash browser script; first data in ClickHouse; overview starts                                                                                                                               | done        |
| 4   | Errors                | Octadash SDK (browser and Node), Sentry SDK compatibility, retention per product (30 days to a year), MCP `list_issues` and `issue_details`; `@octadash/node` on npm waits for the token         | done        |
| 5   | Product usage         | events, sign-ups, logins; signals start here                                                                                                                                                     | in progress |
| 6   | Money                 | Stripe, Asaas, Paddle                                                                                                                                                                            | done        |
| 7   | AI cost               | OpenTelemetry `gen_ai`                                                                                                                                                                           | in progress |
| 8   | Infra cost and margin | provider APIs or manual entries                                                                                                                                                                  | done        |
| 9   | Logs                  | OTLP over HTTP                                                                                                                                                                                   | done        |
| 10  | Daily summary         | what changed since yesterday, by email and the alert channels                                                                                                                                    | next        |

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

| Item                                                                                                                                             | Seen in                                 | Priority |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | -------- |
| Heartbeats for cron jobs, workers, backups                                                                                                       | Healthchecks.io, Better Stack           | high     |
| Content check (200 but broken page)                                                                                                              | UptimeRobot                             | high     |
| Domain expiry                                                                                                                                    | UptimeRobot                             | high     |
| Public status page (see [Status page](#status-page))                                                                                             | Better Stack, Uptime Kuma               | high     |
| Maintenance windows                                                                                                                              | Better Stack                            | high     |
| Octadash watching its own health (outside watcher, step 2)                                                                                       | all                                     | high     |
| Full-screen TV mode for the "All products" tab                                                                                                   | Grafana, Geckoboard                     | high     |
| DNS resolution and DNS changes                                                                                                                   | UptimeRobot                             | medium   |
| TCP ports and ping                                                                                                                               | UptimeRobot, Uptime Kuma                | medium   |
| SLA and SLO reports                                                                                                                              | Better Stack                            | medium   |
| Vendor status (Stripe, Vercel, OpenAI down)                                                                                                      | Better Stack                            | medium   |
| Synthetic tests with Playwright                                                                                                                  | Checkly                                 | medium   |
| Time per stage (DNS, connect, TLS, first byte) and a "slow" state with its own threshold                                                         | Better Stack, Checkly                   | medium   |
| Evidence when a monitor goes down: screenshot of the page, traceroute                                                                            | Better Stack                            | medium   |
| Remote probe: a small Octadash process on another server that runs checks there and reports back; solves "same server" and gives several regions | OpenStatus (private locations), Checkly | medium   |
| Mail server monitors (SMTP, IMAP, POP) and UDP                                                                                                   | Better Stack                            | low      |
| Runbook per monitor or rule ("if this goes down, do this"), shown on the emergency                                                               | Better Stack, PagerDuty                 | medium   |
| Safe action on an emergency: a webhook the owner set up (restart in Coolify, clear a cache), run only on a person's click                        | Datadog, PagerDuty                      | low      |
| Visual diff between versions                                                                                                                     | Checkly                                 | low      |

### Status page

A public page per product or group, at a path of the install or on the owner's
own domain (`status.example.com`). Seen in Better Stack, OpenStatus and
Statuspage.

- **Components** are the product's monitors the owner chooses to show, grouped
  and renamed ("Site", "API", "Payments"). Their state comes from Uptime; a
  monitor that is not shown never leaks.
- **Updates are written by a person.** An emergency does not publish itself:
  the person who took it chooses "Post to the status page" and writes the text.
  Maintenance windows show ahead of time.
- **Subscribers** get every update by email (the owner's own email channel),
  for the whole page or for chosen components, with a one-click unsubscribe.
- **At full size.** One page per product, or one page for a group ("all our
  services"); the same incident on eight products is one update on the group
  page. Pages in English and Portuguese, every text editable.
- Uptime history per component (90 days of bars), with the uptime percentage.

### Incidents and on-call (beyond step 2)

Today an emergency opens an incident, "I'm on it" stops the repeats and the
incident closes when the check passes again. What the incident tools add (seen
in Better Stack, Grafana IRM, PagerDuty and incident.io):

| Item                                                                                                                     | Seen in                              | Priority |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | -------- |
| Escalation: when nobody takes an emergency in N minutes, notify the next person or channel, repeating until someone does | Better Stack, PagerDuty              | high     |
| "I'm on it" and "Resolved" as buttons inside the Telegram and Slack messages                                             | Better Stack, Grafana IRM            | high     |
| On-call schedule: who receives emergencies this week, rotations, overrides, time zones, calendar feed                    | Better Stack, Grafana IRM, PagerDuty | high     |
| Incident opened by a person (a problem no check sees: "customers can't pay by Pix")                                      | Better Stack, incident.io            | high     |
| Incident timeline: what fired, who was told, who took it, notes, status updates, when it ended                           | Better Stack, Grafana IRM            | high     |
| Post-mortem per incident, from the timeline, with its review state                                                       | Better Stack, Grafana IRM            | medium   |
| MTTA and MTTR per product, group, person and severity                                                                    | Better Stack, Grafana IRM            | medium   |
| Phone call and SMS channels; mobile push that breaks through "do not disturb"                                            | Better Stack, Grafana IRM            | medium   |
| Open a Linear or Jira ticket from an incident or an error                                                                | Better Stack, Sentry                 | medium   |

At full size: ten products down at once stay one message (built), the
escalation counts per incident, and a person on call for several groups gets
one message with all of them. A solo owner never sees schedules: with one
member, every emergency goes to that member.

### AI investigation

The cross-signal diagnoses below are rules. An AI investigation goes further on
one emergency, with the same rules: it says "may be", shows its evidence and
never acts alone (seen in Better Stack AI SRE, Grafana Assistant, Sentry Seer,
Datadog Bits AI).

| Item                                                                                                                                                            | Seen in                               | Priority |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------- |
| "Explain" on an emergency: gathers the deploys, errors, logs, traces, metrics and uptime diagnosis of that moment and writes hypotheses, each with its evidence | Better Stack, Grafana, Datadog        | medium   |
| Draft post-mortem from the incident timeline                                                                                                                    | Better Stack, Grafana IRM, OpenStatus | medium   |
| Suggested fix as a pull request for a new error                                                                                                                 | Sentry Seer, PostHog                  | low      |

It runs with the owner's own AI key (OpenAI, Anthropic, OpenRouter), set up
like any connection, because Octadash has no account of its own. Its cost shows
in Costs as Octadash's own spend. It needs traces and metrics to be useful, so
it comes after them.

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

| Item                                                                   | Seen in                      | Priority |
| ---------------------------------------------------------------------- | ---------------------------- | -------- |
| Activation and time to first value                                     | Amplitude, Mixpanel          | high     |
| Feature adoption                                                       | PostHog, Pendo               | high     |
| Inactive and reactivated users                                         | Mixpanel                     | high     |
| Stickiness (DAU/MAU)                                                   | Mixpanel                     | medium   |
| Cohorts and segments                                                   | PostHog, Amplitude           | medium   |
| User journeys                                                          | Amplitude                    | medium   |
| North Star metric                                                      | Amplitude                    | medium   |
| Click autocapture (per product, off by default)                        | PostHog, Heap                | medium   |
| Person profiles (per product, off by default)                          | PostHog, Mixpanel            | medium   |
| In-app surveys (NPS, CSAT)                                             | Formbricks, PostHog          | medium   |
| Feedback and bug report widget                                         | Sentry, Userback             | medium   |
| Session replay (own module after v1: file storage, masking, retention) | PostHog, OpenReplay, Clarity | low      |
| Heatmaps, rage clicks, dead clicks (per product, off by default)       | Clarity, Hotjar, PostHog     | medium   |
| Feature flags                                                          | PostHog, Unleash             | low      |
| A/B tests                                                              | GrowthBook, PostHog          | low      |

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
| Credits used and left (credit packs), from a usage event     | none                      | medium   |
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

| Item                                                                                                                                                                                    | Seen in                        | Priority |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------- |
| CPU, memory, disk and network of the VPS                                                                                                                                                | Netdata, Better Stack          | high     |
| Disk-full forecast                                                                                                                                                                      | Netdata                        | high     |
| Deploys, deploy frequency and rollbacks                                                                                                                                                 | Vercel, Sentry, GitHub         | high     |
| Cost per product for each vendor                                                                                                                                                        | OpenCost, spreadsheets         | high     |
| Containers, restarts and OOM kills                                                                                                                                                      | Netdata, Coolify               | medium   |
| Database connections, size and slow queries                                                                                                                                             | Neon, pganalyze                | medium   |
| Queue size, oldest job and failures                                                                                                                                                     | Better Stack                   | medium   |
| Metrics: OTLP metrics and Prometheus (remote write or scrape), host metrics through the OpenTelemetry Collector (`hostmetrics`), with charts and alerts on a threshold or out of normal | Better Stack, Grafana, Datadog | high     |
| Backups done and restore tests                                                                                                                                                          | none                           | medium   |

### Logs (beyond step 9)

| Item                                                                                                                | Seen in                            | Priority |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------- |
| Traces shown: the waterfall of one request, linked to its logs and errors by trace id, and slow traces per endpoint | Better Stack, Sentry, Seq, Datadog | high     |
| Saved queries and alerts on a pattern                                                                               | Seq                                | high     |
| Request and correlation IDs across logs, errors, traces                                                             | Seq, Sentry                        | high     |
| Secret and personal data redaction                                                                                  | Seq                                | high     |
| Live tail                                                                                                           | Seq, Better Stack                  | medium   |
| p50, p95, p99 latency and throughput                                                                                | Sentry, SigNoz                     | medium   |
| Slow outbound calls                                                                                                 | SigNoz, Sentry                     | medium   |
| Service map                                                                                                         | SigNoz                             | low      |
| Profiling                                                                                                           | Sentry, Pyroscope                  | low      |
| Patterns: similar lines grouped in one, filtered or hidden with one click                                           | Better Stack, Datadog              | medium   |
| Drop rules: noisy lines the owner marks are not stored, with a counter of what was dropped                          | Better Stack, Datadog              | medium   |
| Alert when the log volume or the error level share leaves normal                                                    | Better Stack, Datadog              | medium   |

### Security (new area)

Seen in Unxpose (attack surface), Mozilla Observatory and Have I Been Pwned. It
gets its own menu entry ("Security", "Segurança") instead of living inside
Uptime, because a finding is not up or down: it stays open until it is fixed.

- **Finding.** Every check produces findings with the product, the asset
  (domain, subdomain, URL, port), a severity (critical, high, medium, low),
  first seen, last seen and a state: open, resolved, reopened, or accepted risk
  with a reason. Each finding says what it means for the business and how to fix
  it, step by step, in words someone without security training can follow. A
  finding that comes back after it was resolved is "reopened" and notifies
  again.
- **Severity and alerts.** Critical findings (an exposed `.env` or `.git`, a
  database port open to the internet, an orphan subdomain) are emergencies. The
  rest are signals or data. One seeded rule per severity, editable per product
  like every rule.
- **At full size.** Twenty products with a hundred findings: the list groups by
  check, and the same problem on eight products is one line ("HSTS missing on 8
  products") that opens the list. The product page gets a Security card with the
  count by severity. All products, a group and one product are the same query.
- **Cadence and cost.** Checks run once a day, spread over the day in the worker
  queue, never every minute. Headers and cookies come from the response the
  uptime check already receives, with no extra request, and no check touches a
  product's database.
- **Whose domain.** Passive checks (headers, TLS, DNS, certificate
  transparency) run for any monitored domain. Active probes (exposed files,
  ports) run only on domains the owner proved are theirs with a DNS TXT record;
  on a self-hosted install the owner can confirm it instead. Without this, the
  hosted version becomes a tool to scan other people's sites.
- **Tell, do not guess.** Subdomains found in certificate transparency logs show
  as "found, not assigned" until the owner says which product each belongs to,
  the same way as unassigned spend.

Domain expiry and DNS changes stay in the Base table; their findings also show
here.

| Item                                                                                                                                                       | Source                                       | Priority |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| Security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options or frame-ancestors, Referrer-Policy) and cookies without Secure, HttpOnly or SameSite | the response the uptime check already gets   | high     |
| Full TLS: TLS 1.0 or 1.1 accepted, weak cipher or key, self-signed, incomplete chain, revoked                                                              | one TLS handshake per version                | high     |
| Domain email: SPF, DMARC, MX                                                                                                                               | DNS                                          | high     |
| Subdomain inventory from certificate transparency; a new subdomain is a signal                                                                             | certificate transparency logs (crt.sh)       | high     |
| Orphan subdomain: a CNAME pointing to a Vercel, Heroku, S3, GitHub Pages or similar resource that no longer exists, which anyone can claim                 | DNS and known provider answers               | high     |
| Exposed files: `/.env`, `/.git/config`, `.sql` dumps, public source maps, `/server-status`                                                                 | a few GET requests, verified domains only    | high     |
| Database and admin ports open to the internet (5432, 3306, 6379, 27017, 8123, 9000)                                                                        | TCP connect, verified domains only           | medium   |
| Email addresses of the domain in data breaches                                                                                                             | Have I Been Pwned, with the owner's paid key | medium   |
| Vulnerable dependencies                                                                                                                                    | OSV.dev, GitHub Dependabot connector         | medium   |
| Failed logins, auth spikes, rate limits hit                                                                                                                | product usage events                         | medium   |
| Security report per product or group, as PDF                                                                                                               | the findings                                 | low      |

Out of scope: cloud account benchmarks (CIS for AWS, Azure, GCP), employee MFA
in Google Workspace or Microsoft 365, security questionnaires, supplier risk, a
pentest marketplace, phishing simulation, and CVE scanners in the style of
Nuclei (heavy, many false positives, legal risk).

### New areas (each can become an optional module)

| Area                    | Items                                                                                                                                                                                | Seen in                         | Priority                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------------------------------- |
| Data quality            | last event received, ingest delay, invalid, duplicate and dropped events, missing properties, test data in production, instrumentation coverage                                      | PostHog, Segment                | high                               |
| SEO                     | Search Console impressions, clicks, CTR and position; sitemap, robots.txt, noindex, canonical; broken links; meta and Open Graph tags; structured data                               | Search Console, Ahrefs, Semrush | high                               |
| Webhooks                | received, processed, failed, duplicated, out of order, bad signature, expired credentials, sync history, replay                                                                      | Hookdeck, Svix                  | high                               |
| Agents                  | MCP with ready questions ("what changed today?") and safe actions (mute an alert, open an incident)                                                                                  | Sentry, Umami, PostHog          | high                               |
| Email and messages      | sent, delivered, bounces, spam complaints, unsubscribes; DKIM on sent mail (SPF and DMARC live in Security); welcome and password-reset emails arriving; WhatsApp and SMS delivery   | Resend, Postmark, SES           | high for DKIM, medium for the rest |
| Marketing               | UTM builder, tracked links, first and last touch attribution, leads, ad spend, CPC, CPA, ROAS, referrals and affiliates                                                              | GA, Meta Ads, Google Ads        | medium                             |
| Customers and support   | per-customer profile and timeline, last activity, plan, revenue and cost per customer, tickets, response time, NPS, store reviews, churn risk, account health, upgrade opportunities | Intercom, Chatwoot, Vitally     | medium                             |
| Mobile and desktop apps | installs, active versions, ratings, App Store and Google Play revenue                                                                                                                | App Store Connect, RevenueCat   | medium                             |
| Accessibility           | contrast, images without alt text, unlabeled form fields, WCAG checks per release                                                                                                    | Lighthouse, axe                 | low                                |

### Platform

| Item                                                                                                                                                            | Seen in                                       | Priority |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------- |
| Audit log: who changed a rule, a monitor or a channel, who muted or took an incident, exportable                                                                | OpenStatus, Datadog, Grafana                  | medium   |
| Monitoring as code: public API, CLI and a config file for products, monitors and rules                                                                          | OpenStatus, Checkly, Better Stack (Terraform) | medium   |
| Upgrade without losing data: the ingest stays up while the panel restarts (its own Coolify app with rolling updates, or the script and SDKs resend what failed) | Coolify Compose has no rolling updates        | high     |

Out of scope, after the study of Better Stack, Datadog and Grafana on
2026-11-28: automatic instrumentation with eBPF (needs kernel access and
Kubernetes, heavy for a VPS), a free-form dashboard builder in the style of
Grafana (Octadash shows each area ready, and the MCP answers the rest), and a
data warehouse.

## Connectors

Every connector uses the contract in `packages/integrations`: a form generated
from its schema, encrypted secrets and a "Test" button. Read-only access
whenever the service allows it. Built today: Telegram and webhook.

| Category               | Feeds                 | Planned                                                                                 | Backlog                                                                                                 |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Alert channels         | alerts, daily summary | email (SMTP and Resend, built), Telegram (built), webhook (built), Slack, Discord, ntfy | WhatsApp, Microsoft Teams, Google Chat, mobile push, PagerDuty, Pushover, SMS, phone call               |
| Payments               | revenue               | Stripe, Asaas, Paddle                                                                   | Mercado Pago, Pagar.me, Iugu, Hotmart, Kiwify, Eduzz, Lemon Squeezy, RevenueCat, App Store, Google Play |
| AI providers           | AI cost               | OpenAI, Anthropic, OpenRouter, OTel `gen_ai`, PostHog `$ai_generation`                  | Google Gemini, Groq, Mistral, ElevenLabs, Replicate, fal, Vercel AI Gateway                             |
| Hosting and databases  | infra cost            | infra providers (generic)                                                               | Vercel, Neon, Supabase, Coolify, Railway, Fly.io, Hetzner, DigitalOcean, Cloudflare, AWS                |
| Code and deploys       | deploys, releases     | none                                                                                    | GitHub (deploys, releases, issues, Dependabot), GitLab, Vercel and Coolify deploys, Linear, Jira        |
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
| Deploy + new critical security finding           | the new version exposed something      | infra + security      |
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
