# Decisions log

Decisions taken without the owner while he was away, so he can review them in
one place. Newest at the bottom of each night. Each line says what was decided
and why; anything here can be reversed.

## Night of 2026-11-28

- **Uptime board shows "Slow" as a display state, not an emergency.** The
  emergencies canvas lists slow responses as a signal that never sends a
  message. Until signals have their engine, a monitor reads "Slow" on the
  Uptime board when its median over the last hour is at least 2 s and at least
  twice its median over the period shown.
- **"Late" on the board** means a heartbeat is past its due time but still
  inside its grace. After the grace it is down, as before.
- **Same-IP note.** Each check remembers the address the host resolved to, and
  a monitor that goes down keeps it on its emergency. When two or more open
  emergencies of different products share an address and started within 10
  minutes of each other, the board says so. They are never merged.
- **Certificates tile** counts certificates that expire in 14 days or less,
  the same line where the board already paints them in amber.
- **Cloud sign-up** (decided by the project coordinator): open sign-up with the
  email confirmed before the first step. Self-hosted stays owner plus
  invitations.
- **Emergency page.** Anyone in the organization can take an emergency over
  from someone else ("Take over"): at night, whoever is awake fixes it. Each
  take, note and manual close is kept as an event (`incident_event`), so the
  page reads as a record and nothing is overwritten.
- **"Close anyway" asks why**, and the reason goes on the record. Closing an
  emergency whose monitor is still failing does not open a new one until the
  monitor recovers and fails again.
- **What Octadash checked** runs once, when a site or API goes down: where the
  name resolves, the certificate, the last answer, the control addresses
  (`OCTADASH_UPTIME_REFERENCE_URLS`) with their times, and whether the address
  is Octadash's own server. It is kept on the emergency, not repeated.
- **"Down at the same time"** lists the other open emergencies that started
  within an hour of this one, those on the same address first. Ticking them
  and pressing "I'm on these too" takes them all at once.
- **CI runs the migrations before the tests.** Tests in several packages read
  the auth tables, and the order of parallel runs decided whether they existed.
- **The emergency strip shows an emergency once its rule's wait is over**
  (2 minutes for a site down by default), the same moment the message goes
  out. A blip shorter than that never reaches the strip, and never turns it
  green.
- **"Octadash can't reach its outside watcher"** is a second strip line, shown
  only to owners and admins: it is about the install, not a product, and a
  member cannot fix it.
- **The strip names up to 3 emergencies**; from 4 on it counts them, says when
  they started together and which server most of them share. "See all" lists
  every one; nothing is grouped.
- **Ended by hand turns the strip green too**, saying "closed by Ana" instead of
  "is back", so nobody reads a closed emergency as a recovery.
- **Link-style buttons use the brand accent** (`--brand`) instead of the
  primary magenta: the primary failed contrast on the dark theme.
- **The 11 kinds of emergency**: the rules list shows the 8 not built yet,
  dimmed and already set, each in its area (domain expiring sits under Uptime
  as coming later). "Octadash itself" stays the outside watcher for now; the
  queue and disk checks come with the install health page, since the worker
  cannot see the database disks from its container.
- **A visit is a visitor on one calendar day** (in the organization's time
  zone). Entry page, channel, source and campaign come from the visit's first
  page view, so a click inside the site never counts as "Direct".
- **Channels** are worked out from the referrer and UTM tags, in this order:
  paid, email, AI assistants, search, social, direct, other sites.
- **Returning visitors** are counted only for sources that turned on "Count
  returning visitors"; the tile says how many sources count them. A visitor
  returns when the same id was seen on an earlier day in the last 90 days.
- **Today compares with yesterday up to the same hour**, so the numbers are
  fair in the morning. Periods are Today, 24 hours, 7 and 30 days; a custom
  range comes later.
- **Places show countries only** for now. Regions and cities need a larger
  location database in the ingest; the list is built so they fit as tabs.
- **The chart has no split by product yet**; the Products card lists each
  product's numbers and filters by it.
- **Filters** are one value per list (up to 6 at once), kept in the address so
  a link shows the same view. Details opens a side sheet with search, "load
  more" and CSV export (up to 10,000 rows).
- **Set up Traffic** reuses a product's existing source ("Use for Traffic")
  before asking for a new one, so the same key sends errors, events and page
  views. Step 3 asks every 3 seconds whether a page view arrived.
- **Product settings** follow the ProductSettings canvas: General (name,
  address, every area with its state, rules, danger zone), Sources (list, one
  page per source) and Alert rules (the rules list moved there from the
  General page).
- **Old product keys became a source named "Main"**, with platform "Other",
  so every key belongs to a source and shows on the Sources page. Products
  that never used that key show "Main · Never received"; delete it there.
  New products start with no key.
- **Renaming keeps old links working** through an alias table. If another
  product later takes the old address, that product wins.
- **Deleting a product asks for its name**, typed, as the canvas says.
- **Key rotation** offers Now, 1 hour, 24 hours (default) and 7 days. Old keys
  still working show with when they stop and a "Stop now" button.
- **Not built yet from the canvas**: the OpenTelemetry endpoint (the ingest
  does not take OTLP yet), counting data sent with an old or deleted key, who
  marked an area "not used" and when, and payment connections under "Also
  sending data". Each comes with its engine. "What it sends" shows Errors and
  Logs as "coming later".
- **A source "went quiet"** after 24 hours without data: the Sources page then
  says "Nothing for 3 days" with a diamond, instead of the green dot.
- **TV mode** follows the TV canvas: the strip of emergencies on top, one tile
  per product (status in word and icon, who is on it, 4 hours of checks, three
  numbers, a sparkline), "What happened" in the footer. Products in trouble
  come first and stay on every page; the screen turns the page every 20
  seconds. It opens from "TV mode" on the Overview, a group and a product.
- **The numbers offered on a tile are only the ones already built**: online
  now, page views today, events today and response time. Errors, sales and
  sign-ups join the list when their areas exist.
- **One private link per organization**. Making a new one stops the old one;
  "Stop link" turns it off. The token is shown once and only its hash is
  stored. The link opens the screen with the settings chosen when it was made,
  and shows nothing else. "Last opened" has no place or device, only the time.
- **Sound is off by default.** Browsers only play sound after a click, so the
  TV shows "Allow sound" once.
- **A product whose monitor is down counts as down** on the TV, even before
  its emergency opens, so the header never says "all up" while a tile says
  "Down".
- **Errors engine first, screens next.** The ingest takes Sentry envelopes and
  `/store/` (tested with the real `@sentry/node` 9) and the Octadash script now
  reports uncaught errors and rejected promises (at most 10 per page, each
  message once) plus `octadash.captureException`. `data-release` and
  `data-environment` on the script tag mark the release.
- **Errors keep 90 days** by default (Sentry's paid plans keep 90). Per-area
  retention will change it.
- **The person hit is what the app sends as its user**, as Sentry does; with
  no user, the daily visitor hash. E-mails and names are stored only when the
  app sends them. Masking comes with the retention settings.
- **"Resolve in next release"** follows Sentry: events from the release the
  issue was last seen in, or with no release, do not reopen it.
- **A batch retried after a failure counts twice in the issue's total** in
  Postgres; screens read counts from ClickHouse, which drops the repeated
  insert, so only the "ignore until N more events" condition can fire early.
- **Errors screens follow the canvas**: four numbers on top (errors, issues
  hit, new issues, people hit), the chart with the period before, then the
  issues table with tabs (Unresolved, New, Regressed, Mine, Resolved, Ignored)
  and the order by people hit first. The issue page has its actions, numbers,
  30 days in bars, where it happened (only the app's frames by default), what
  the person did before, who it hits and the event itself.
- **pt-BR keeps the word "issue"** ("issues", "Abertas", "Voltaram"). It is
  the word Sentry, GitHub and developers in Brazil use. Confirmed by the maintainer
  on the morning of 2026-11-28.
- **Not built yet, on purpose**: release marks on the chart and a SPIKE badge
  (they need the alert rule first), a search box for filters, source maps and
  commit details on the stack. "Set up Errors" is not a page yet: the empty
  state points to the source settings, where the DSN is.
- **Error spike follows the Emergencies canvas** (5× normal, at least 20
  errors, in 15 minutes). "Normal" is the same hour on each of the last 7 days,
  not the shape × level of signals: an emergency must be simple to explain. A
  product with no history fires on the minimum alone. Errors of ignored issues
  never count, as the Ignore dialog promises. The multiple and the minimum are
  editable per product (at least 1, so a rule cannot fire on every error).
- **A new issue is not an emergency.** Sentry tells on every new issue by
  default; here a new issue is data (the New tab and the number on top) and only
  a spike sends a message, so a busy product does not flood the channels.
- **The warning badge text now uses the theme's warning color**: the amber on
  its pale background failed contrast in the light theme.
- **Set up Errors is built** (`/p/<product>/errors/setup`, as in the Configure
  canvas): sources with "Use for Errors", a new source, the DSN, the code for
  11 platforms (the Octadash script for plain sites, the Sentry SDK for the
  rest), "Send test error" from the browser and a live wait for the first one.
  The snippets say plainly which SDKs were tested (so far `@sentry/node` 9).
  "Set up" on a product's Errors and Traffic cards now opens their setup page.
- **Errors joins the Overview and the product page**: an Errors number (fewer
  reads as good, so a drop is green), an Errors tab on the chart, an Errors
  column in the products table (events and issues hit) and, on the product
  page, an Errors card with the 3 unresolved issues hit most and errors per day
  over 14 days. Deploy marks and "out of normal" signals wait for their engine.
- **Product usage engine first, screens next.** The ingest takes PostHog SDKs
  (checked live with posthog-js and posthog-node), the script gains
  `identify(id)` and `reset()`, and the worker runs "Key event stopped".
  Recent posthog-js gzips its batches without saying so in the address or a
  header, so the ingest also recognizes gzip by its first bytes.
- **Person ids are stored as hashes, for every event.** `distinct_id` was kept
  as sent; now it is a hash of the product and the id, as the Product usage
  canvas promises ("Person ids are kept as hashes"). Traffic counts the same
  people as before, since it only needs the id to be stable.
- **Personal data is dropped at the door, not masked later.** Properties named
  like e-mail, phone, CPF, CNPJ, password or address, values that look like an
  e-mail or a document number, and PostHog's person properties never reach the
  queue. URL properties are kept as sent. Errors keep a plain user id (it finds
  the support case) but hash an e-mail.
- **Octadash keeps no person profiles.** PostHog's `$set`, `/engage/` and
  person properties are accepted and dropped. Funnels and retention work on the
  hashed id alone.
- **PostHog's extras are switched off by our flags answer** (autocapture,
  session recording, surveys, heatmaps), and the events they would send are
  dropped if they come anyway. Product usage is the events the app chooses to
  send; recordings and heatmaps are not on the roadmap.
- **Sign-ups need no setting**: `signup.completed` (the standard name),
  `signed_up` (the name the setup suggests) and the names other tools use all
  count. The canvas and the roadmap differed (snake_case or dotted); both work.
- **Key event stopped waits by the event's own pace**: the silence must pass
  the time 5 events normally take at this hour, and at least 30 minutes. A
  checkout that comes 60 times an hour fires after 30 minutes; one that comes
  twice an hour after 2.5 hours; one rarer than 5 a day at that hour never
  fires. It closes only when the next event arrives, so a night that turns
  quiet does not say "back". The minimum is called `silence`, not `minutes`,
  because `minutes` already means "wait before telling" on every rule.
- **"Key event" is "evento importante" in pt-BR**, as the rules preview
  already said.
- **The browser script grew to about 5 KB before gzip** (2 KB gzipped) with
  `identify`; the budget in the test moved from 4.5 KB to 5 KB.

### Product usage screens (2026-11-28)

- **"Normal?" compares with the same stretch one to four weeks before**, not
  the period just before: a Monday is read against Mondays. A month steps back
  in whole weeks (35 days) so it never overlaps itself. Out of normal is more
  than 30% under or 50% over; with fewer than 5 expected and seen, the column
  says "too few to tell" instead of a percentage.
- **Key events stay on the list with 0 in the period**, and a key event with
  an open "Key event stopped" goes to the top. That is when they matter.
- **A funnel belongs to one product.** On Overview or a group the "New funnel"
  form asks which product. Steps are typed one per line (up to 8), with the
  names seen lately offered as a hint; a picker can come later.
- **Retention shows whole weeks only.** A cohort that started before the
  period showed a partial first week and looked like a drop.
- **Retention cells use the primary color** at 50% or more; the brand tint
  with white text failed AA contrast in the dark theme.
- **Set up Product usage reuses a Traffic source** ("Use for Product usage")
  instead of making a second key, since the browser script already sends both.
- **Tables that scroll sideways on a phone are focusable regions**
  (`scrollLabel` on `Table`), so keyboard users can scroll them; axe flagged
  them at 390 px.

### Logs engine (2026-11-28)

- **OTLP only, as the canvas says**, protobuf and JSON. Protobuf is decoded
  by hand (about 200 lines) instead of adding protobufjs and generated code:
  the ingest is bundled into one file, and the logs messages are few and
  stable.
- **Traces and metrics are answered, not kept.** A Collector that exports all
  three gets a partial success saying so, instead of a 404 it would retry
  forever. Traces get their own step later.
- **Masking replaces, it does not drop.** Logs are for investigating, so the
  line stays and only the value becomes `[email]`, `[card]`, `[document]`,
  `[key]` or `[secret]`. Bare digit runs are left alone (they are usually
  ids); cards need a valid Luhn check. Product usage keeps dropping personal
  properties whole, as before.
- **Retention is per product and per line.** The canvas offers 7, 14, 30 or
  90 days per product. Each line keeps the days its product had when it
  arrived, and the table is partitioned by retention and day, so ClickHouse
  drops whole parts at night. Shortening the retention deletes older lines at
  once; lengthening it applies to new lines only.
- **Retention lives on `project_area`** (new `retention_days` column), so
  other areas can use the same setting later instead of a table each.
- **A saved search belongs to the organization**, like the canvas shows on
  All products; `product:` inside the query narrows it.
- **Log alert opens one emergency per product**, matching how every other
  emergency works (10 products failing at once read as 10, grouped in one
  message). It only counts lines that arrive after Alert is turned on, and it
  looks back at most an hour, so the quiet spell is capped at 60 minutes.
- **Errors now keep the trace id** (ClickHouse migration 0007), for "1 error
  in Errors" on a log line.

### Logs screens (2026-11-28)

- **The search lives in the address.** `?q=` and `?period=` make any search a
  link to share; Live, Load older and the saved searches only add to that.
- **Live asks every 3 seconds for lines newer than the newest on screen**, the
  same polling the other areas use, and stops while the person scrolls down,
  as the canvas says. The list keeps at most 1,000 lines in the browser.
- **Anyone saves a search; only owners and admins turn Alert on or off or
  delete a search with Alert on**, since that is a rule that tells everyone.
- **Counts inside labels are written as "New lines: 3"** instead of plurals
  inside a client string, so the browser needs no message formatter.
- **Set up Logs reuses a source that already sends errors** ("Use for Logs",
  same key), like Product usage does with the Traffic script. The service
  name in the snippets starts as the product's address and is meant to be
  changed per service.
- **The disk estimate on step 2 comes from the last 24 hours** times the
  table's real compression, and says "at today's rate"; before any line it
  says nothing instead of guessing.

### Money engine (2026-11-28)

- **Webhooks land on the panel, not the ingest.** The canvas shows the
  panel's address, and checking a signature needs the decrypted secret, which
  only the panel and the worker hold. The gateway's own retries are the queue:
  a failed store answers 500 and the gateway sends it again.
- **Stripe is pinned to API version 2024-06-20** and a secret key (`sk_`) is
  refused, so Octadash can never charge or refund. The key needs Read on
  charges, invoices, subscriptions, products and balance (the canvas listed
  "customers count and payouts"; invoices give the product of a charge and
  balance gives the fee, so those replace them).
- **Asaas keys cannot be read-only.** Asaas has no restricted keys, so the
  "i" says to create one just for Octadash and that Octadash only sends GET
  requests with it. Asaas lists give only the day of a payment; webhooks give
  the moment.
- **Asaas does not say when a subscription ended**: Octadash keeps the first
  time it saw it ended, so churn may be off by up to an hour without the
  webhook.
- **Paddle refunds are not read yet** (they are adjustments, another list);
  Paddle revenue counts what was billed.
- **MRR uses each subscription's current price**, so a plan change moves its
  whole history. MRR movements (expansion, contraction) are on the backlog.
- **Exchange rates from Frankfurter (ECB)**, free and without a key; weekends
  take Friday's rate. A currency the ECB does not publish shows unconverted.
- **Payments failing looks at the last 15 minutes with at least 10 charges**,
  as the canvas says, so two failed cards at night do not wake anyone.
- **A failed first import (a wrong key) tries again every 15 minutes**, not
  every minute, so a bad key does not hammer the gateway.
- **Tested against the gateways' documented shapes, not live accounts.** A
  fake Asaas key reached the real Asaas sandbox and came back with its error
  message, which confirms the address and header; the rest needs a real key.

### Money screens (2026-11-28)

- **The key is checked before saving.** "Connect and import" reads the
  gateway with the key first and refuses a wrong one with the gateway's own
  message, instead of saving and failing at the first import. A fake Stripe
  key reached the real Stripe API and came back with "Invalid API Key".
- **The webhook URL exists before the connection.** The page makes the token,
  so the URL can be added at the gateway while filling the form. For Asaas,
  which has no signing secret, the page also makes the access token Asaas
  sends with each webhook; it is shown once and stored encrypted.
- **One account, several products: only one product can take "All of this
  account".** A second one must pick products or metadata, and then the "All"
  one keeps what nobody else claims. The more specific rule wins.
- **Changing a rule or a product leaving reads the account again from the
  start**, after clearing what was stored from it, so no payment keeps an old
  product. The numbers of the products it serves fill again in a few minutes.
  A product joining reads again without clearing. The last product to leave
  deletes the connection and its data; the gateway is not touched.
- **"Update keys" keeps an empty field's old value**, and a new key makes a
  failing connection try again in the next minute.
- **Margin is not on the Money table yet**: it needs Costs. The table says
  "Margin is in Costs", as the canvas does.
- **"Custom" period is not built**: Money uses the same periods as Traffic
  (Today, 24h, 7d, 30d), like the other areas.

### Costs engine (2026-11-28)

- **OpenAI and Anthropic first; AWS, Neon, Vercel and Google Cloud later.**
  Both AI reports were checked in their current documentation and answered a
  fake admin key with their own "invalid key" message. Neon's API gives usage
  (compute hours, storage), not money, so it needs each plan's prices; AWS
  Cost Explorer charges US$ 0.01 a request and needs request signing;
  Vercel's billing export is not settled. The provider contract holds them
  all; each is one file.
- **Anthropic is read through the new cost analytics report** (the old cost
  report is legacy). It refreshes about every 4 hours, so its last hours
  arrive late and a runaway shows up to 4 hours after it starts.
- **OpenAI gives days only.** Read every hour, the growth of today's total
  is that hour's spend, which is what Cost runaway looks at.
- **A shared account is divided when reading, not when storing.** Changing
  the split changes the whole history. The canvas says past months keep their
  split; that needs a frozen month table and is on the backlog.
- **Cost runaway needs at least US$ 5 in the hour** besides 3× normal, so a
  product that spends cents never wakes anyone. Traffic split counts as equal
  parts for the runaway check.
- **Costs stay in Postgres**: a few hundred rows a day per account, and
  re-reading a day must replace it, which Postgres does simply.

### Costs screens (2026-11-28)

- **Periods are This month (the default), 7d and 30d**, not Today, 24h and
  Custom as in the canvas. Providers publish days, and a budget is about the
  month, so hours and a custom range add nothing yet.
- **The budget is per product, on its own card of "Connect a cost"**, not a
  step of connecting: one product can share several connections, and the
  budget is about the product. "Forecast this month" compares the forecast of
  the products that have a budget with the sum of their budgets; when only
  some products have one, the tile says so ("2 products with a budget: $X of
  $Y") instead of comparing every product with part of the budgets. The table
  says "Forecast over budget" or "near budget" per product.
- **A fixed bill is a connection like a provider**, so it is shared and split
  the same way. Changing its amount changes every day since it started; a new
  price is a new bill from the day it changed (said under the form).
- **The split is the connection's**, the same for every product sharing it;
  changing it on one product says it changes for the others too.
- **Percent split: a product without a percent takes an equal part of what
  the typed percents leave.** Before, switching to percents and typing 50 for
  one product gave it the whole rest, since the others counted 0.
- **A project or workspace belongs to one product**; claiming one another
  product has is refused with its name. The rest can be shared.
- **No marks on the chart yet**: Cost runaway marks need the incident list in
  this loader; the emergency still shows in the strip and the timeline.

### Overview and product page: Sign-ups, Revenue and Costs (2026-11-28)

- **The Overview gets the Sign-ups, Revenue and Costs tiles and the Sign-ups,
  Revenue · MRR and Margin columns** of the panel canvas, each only where some
  product uses the area (set up, or with sign-ups, a gateway or a cost), as
  the other areas do. The chart gets Sign-ups and Revenue tabs.
- **Costs are by whole days**, so with 24 hours the tile reads "Costs today"
  and compares with yesterday; it has no chart tab, since a day per point
  does not fit the hourly chart.
- **Margin per product is the Costs page's margin**: revenue from Money less
  costs, over the same days.
- **The product page shows real numbers for Usage, Money, Costs and Logs**
  once they receive data, instead of the "Example" card: sign-ups against the
  period before; revenue and MRR; cost and margin; lines, errors and warnings
  with bars over the period (the numbers say it, the bars only draw it).
- **Money's "Margin is in Costs" is now a link** to the Costs page of the
  same scope.

## Morning review, 2026-11-28

The maintainer reviewed the night's decisions that change the product or its risk.

- **A change to a cost split holds from that day on.** Every change to a
  connection's split or to a product's part keeps a copy of the whole
  division from that day, in the organization's time zone
  (`cost_split_history`); each day of cost is divided by the version of its
  day. Past months keep their margins, as the Costs canvas said. Costs read
  back from before the connection existed use its first version. Existing
  connections got their current division from the start.
- **The Money form says what each key can do, in the open**, not only in the
  "i": Stripe takes restricted keys only, Paddle keys get Read only, and an
  Asaas key can also charge (Asaas has no read-only keys), shown as a warning
  before the key is pasted.
- **PostHog compatibility covers events in v1.** Click autocapture, person
  profiles and heatmaps go to the backlog as per-product options, off by
  default; session recording is its own module after v1, since it needs file
  storage (S3 or MinIO), masking and retention.
- **A new issue can send a message, as an optional rule off by default.** The
  error spike stays the emergency.
- **"New issue" is a notice, not an emergency.** Its rule is "Send a
  message" or "Off" (no signal) and starts off. Each new issue is kept as an
  incident so channels, grouping and the message record work as for
  emergencies, but notices are left out of the strip, the timeline and every
  list of emergencies, and close themselves once sent. New issues in the same
  minute go out as one message per channel, never mixed with an emergency.
- **A rule set to Off is no longer faded**: the faded text failed AA contrast,
  and the level toggle already says Off.

## Money for one-off sales (2026-11-28, maintainer)

- A product sold one purchase at a time (one-off sales, credit packs) showed MRR, new subscriptions and churn at zero.
- Money now reads how each product is paid for from the last year of sales: subscriptions only, one-off only, or mixed. No setting.
- One-off: Revenue, Customers who paid, Bought again (paid before the period too), Average sale and Failed payments. MRR and churn are hidden and come back by themselves when a subscription arrives.
- Mixed: the subscription numbers stay, and Revenue says how much was recurring and how much one-off.
- Credit packs count as revenue when bought. How much credit was used is not in the gateway; it would come from a Product usage event (backlog).

## Empty pages that teach (2026-11-28, maintainer)

- An area with nothing yet says what it gives, shows an example of the page marked as an example, and offers the shortest next step for where the product stands. Errors is the first; the other areas follow the same model.
- Errors, one product: never sent an error, so one click on where the code runs makes a source (Site for the script) and shows its code, a test error and a live wait. A product with a source that sends something else gets "Use {source}" first.
- Errors, several products: before any sends, a table of products with each one's next step, quickest first. Once one sends, the issue list takes the page and the table folds into "N more products can send errors" at the end.
- Sent before, nothing now and nothing open: "No errors in the last 24 hours", with the last error, a wider period and the resolved issues, instead of a page of zeros.
- A zero is only real if the source is alive: each source set for Errors shows whether it sent any data (page view, event, log or error) in the period. One that sent nothing gets a warning, since its zero may be only silence.
- Money, Costs and Uptime follow the same model. Money and Costs show the connect form on the empty page itself, after "use an account another product already has" when there is one. Uptime starts from the site address and one click (a site monitor every minute); /health, heartbeats and other intervals stay in the full form.

## Received data, 2026-11-28

- **Nothing received is thrown away** (asked by the owner). Data no area reads
  yet goes to the ClickHouse table `received`, masked, for 30 days
  (`OCTADASH_RECEIVED_RETENTION_DAYS`). A kind nobody has seen is kept by
  default. Every discard has a reason in `DISCARDS` and a `dropped:` count.
- **PostHog `$exception` goes to Errors**: it was refused before. The other
  events that are not product events, and `/engage/`, go to `received`.
- **File storage is the fourth bundled store** (decided by the owner):
  replays, attachments and profiles go to an S3-compatible store that ships in
  the compose and is managed by Octadash (generated password, bucket created on
  start), with no size limit beyond the request's. `.env` can point to an
  external S3 or R2 instead. Retention is applied by Octadash, not by bucket
  rules, so it behaves the same on every store.
- **Garage, not MinIO or SeaweedFS.** MinIO's community edition went into
  maintenance in December 2025 and was archived in 2026, with no official
  Docker images since October 2025. Garage is one binary with embedded
  metadata, built for small servers, stable at v2 and in production since
  2020; its gaps (versioning, bucket policies) are features Octadash does not
  use. SeaweedFS covers more of S3 but runs several processes even on one
  node. Garage is AGPL, like Octadash. Its memory and image size are measured
  in the load test before the first release, not assumed.
- **No fifth store.** Log search, metrics and vector search fit in
  ClickHouse; the queue fits in Valkey (Kafka only for the cloud at high
  volume). A Chromium for uptime screenshots would be an optional profile.
- **Still left out, on purpose**: personal data (masked), areas marked "I
  won't use this" (counted on the card), `/flags` and config requests (no
  data). Gateway and AI cost data is read from the provider, which keeps it,
  so fields Octadash does not read today can be read again later.
- **Traces are kept before their screen**: OTLP spans, Sentry transactions and
  Sentry spans go to `spans` (OpenTelemetry's shape), 14 days by default
  (`OCTADASH_TRACE_RETENTION_DAYS`), shorter than received data because spans
  are the largest stream. Sentry logs go to Logs.
- **Metrics are kept before their screen**: every OTLP metric type goes to
  one table, `metrics`, 30 days by default (`OCTADASH_METRIC_RETENTION_DAYS`).
  Points are small, so they keep longer than spans; a product's own setting
  comes with the Metrics area.
- **The whole error event is kept**, masked, next to the columns the screens
  read. Cookies are now masked by name everywhere (logs included).
- **Uptime keeps what each check learned** (resolved address, redirects,
  https redirect, certificate issuer and trust, the failed answer) and a
  heartbeat keeps the output its job posts, the last 100,000 characters.
- **Masking scans long lines once**: the e-mail patterns used to try every
  position of a long line with no spaces (a token, a minified bundle), which
  took seconds on 100 KB. Found while keeping heartbeat output.

## Uptime is "Disponibilidade" in Portuguese (2026-11-28, maintainer)

- "No ar" read as a status, not as an area beside Tráfego, Uso, Erros and Logs. The area is now Disponibilidade in Portuguese and stays Uptime in English, in the panel, the docs and octadash.com.
- The status words stay: a monitor is "no ar" or "fora do ar", and the Overview tile says "9 de 10 no ar agora".
- A tile whose label is the area's own name shows the name once.

## File storage, 2026-11-28

- **Garage v2.5.0, started with `--single-node --default-bucket`.** Since v2.3
  Garage makes its layout, key and bucket from environment variables, so the
  compose needs no setup container and Octadash needs no admin token. v2.6.0
  came out four days ago; v2.5.0 (a month old) is pinned. The image is about
  28 MB compressed (Docker Hub); its memory is measured in the load test.
- **SQLite for Garage's metadata, with a snapshot every 6 hours.** Garage's
  docs recommend LMDB for clusters of two or more nodes and warn it can break
  after an unclean shutdown; one node has no other copy to rebuild from.
- **Settings in `.env`, not in the panel.** The store is reached by the ingest
  and the worker before anyone signs in, like Postgres and ClickHouse, and
  changing it moves where data goes. The panel shows the status and how to
  change it.
- **What is a file**: Sentry attachments, replays and profiles always, PostHog
  `$snapshot`, and any other item over 1 MB. The rest stays in its
  `received` row, where ClickHouse searches it.
- **Files are masked like rows** (JSON and text); bytes are kept as sent, as
  they were in base64 before.
- **The ingest writes the file before answering**, never through Valkey, so a
  20 MB attachment does not sit in memory. Storage down: under 1 MB stays in
  the row, over it is counted (`storage_unavailable`) and logged.
- **Sentry envelopes up to 20 MB** (were 10 MB), 40 MB unpacked: the default
  attachment limit of most Sentry SDKs. More would let a few uploads at once
  fill the memory of a small server.
- **20 GB limit by default** (`OCTADASH_STORAGE_LIMIT_GB`, 0 for none). With no
  limit a burst of replays could fill the disk Postgres and ClickHouse share.
  Past it, whole days go, oldest first, never today, each counted per product
  (`dropped:file`, `storage_limit`). Files follow the retention of the rows
  that point to them (`OCTADASH_RECEIVED_RETENTION_DAYS`).
- **Where the panel warns**: a page under Settings > This install, a banner on
  settings pages for owners (not set, not answering, almost full at 90%) and a
  red bar in the emergency strip while storage does not answer, since files
  are being lost.
- **Keys start with the day** (`files/<day>/<org>/...`) so retention lists a
  handful of folders instead of every file. The cloud counts quotas per
  organization from the `received` rows, not by listing.
- **CI starts the dev compose's Garage** and runs the S3 client against it, so
  the bootstrap and the signing are tested for real.

## Settings follow the picker, and @octadash/node (2026-11-28)

- **Three kinds of settings, one place each.** The sidebar's settings item is
  the chosen product's or group's, and is not shown for All products. Octadash's
  own settings (members, channels, organization rules, updates, the install)
  are in the account menu at the top right, as on Vercel and Sentry.
- **Errors asks where the code runs first** (browser or server), then the
  language. Next.js is in both lists, since one SDK covers the page and the
  server. The docs show the same two lists.
- **@octadash/node is MIT**, not AGPL like the rest: an SDK is linked into the
  customer's own code, and AGPL there would keep people from adopting it. One
  file, no dependencies, Node 18+. It retries a few times when the ingest does
  not answer, which is the part of "upgrade without losing data" an SDK can do.
  Published from a `node-v*` tag by `.github/workflows/publish-node.yml`, which
  needs the `NPM_TOKEN` secret. Set up keeps showing the Sentry SDK and the HTTP
  call until the package is on npm.
- **No "Octadash wrapper" for AI cost** (approved by the owner). AI cost reads
  OpenTelemetry `gen_ai` spans and PostHog `$ai_generation` events, which the
  usual AI SDKs already send. A wrapper of our own would be one more package to
  keep in step with every provider's SDK.
- **MCP server without the SDK.** The panel answers MCP itself at
  `/api/mcp` (JSON over HTTP, no session): four methods, read-only tools, so
  the official SDK and its session and stream handling would add more than it
  saves. Tokens are per organization, read every product and are revoked in
  Octadash settings > API tokens.
- **Token scopes item by item** (asked by the owner, as PostHog's API keys).
  Each token gives every item no access, read or write; delete is a separate
  permission, off by default and only where it can write. Presets "Read only"
  and "Setup with AI". Tokens made before read everything. The MCP server lists
  only the tools a token's scopes allow, so whoever makes the token decides
  what the assistant can do.
- **The setup skill lives in its own repository**, `octadash/skills`, as
  Sentry (`getsentry/sentry-for-ai`) and PostHog (`PostHog/skills`) do: the
  Agent Skills format (a folder with `SKILL.md`) installs in Claude Code,
  Codex, Cursor and others with `npx skills add octadash/skills`, and the same
  repository is a Claude Code plugin marketplace. MIT, like `@octadash/node`.

## Octadash settings back in the menu (2026-11-28)

- **Three settings, each with its own place in the sidebar** (corrected by the
  owner). "Octadash settings" sits at the bottom of the menu at all times. With
  a product or a group chosen, a line and "Product settings" or "Group
  settings" follow the areas. All products shows only the bottom one. The
  account menu keeps its shortcut too. Replaces the entry above that moved
  Octadash's own settings to the account menu only.
