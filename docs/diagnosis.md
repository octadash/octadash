# Diagnosis

The diagnosis visits a product's address the way a first-time visitor would and
answers which observability levels the product already has. It runs when a
product is created, when its address changes, when someone clicks "Run again",
and once a day.

## Levels

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

## What it reads

- The page HTML, following up to 6 redirects.
- The URLs of every script, link, iframe and form target.
- Up to 30 first-party scripts (1.5 MB each, 10 MB in total), where bundled
  SDKs such as Sentry and PostHog live.
- The TLS certificate and whether `http://` redirects to `https://`.

It never follows a URL that resolves to a private address (localhost, 10.x,
192.168.x, 169.254.x and so on), so a product address can't be used to read
internal services. Set `OCTADASH_DIAGNOSIS_ALLOW_PRIVATE=true` on the worker to
diagnose local sites during development.

## How it runs

The `diagnosis` table is also the queue. The panel inserts a queued row and
sends `NOTIFY octadash_diagnosis`; the worker listens, claims rows with
`FOR UPDATE SKIP LOCKED` and runs two at a time. A 30 second poll catches
missed notifications and returns diagnoses left running by a stopped worker.
An hourly job queues products whose last diagnosis is older than 24 hours.
Diagnoses older than 90 days are pruned, except the last one of each product.

## Adding a tool

Tools are regular expressions in
[`packages/diagnosis/src/tools.ts`](../packages/diagnosis/src/tools.ts). Keep
patterns specific (a false "you have Sentry" is worse than a missed one) and add
a test with a real snippet in `tools.test.ts`.
