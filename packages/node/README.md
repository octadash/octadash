# @octadash/node

Send errors and events from a Node.js server to [Octadash](https://octadash.com).
No dependencies, Node 18 or newer.

```sh
npm install @octadash/node
```

```ts
import { Octadash } from '@octadash/node'

export const octadash = new Octadash({
  key: process.env.OCTADASH_KEY, // the source's key, from Set up in the panel
  host: 'https://ingest.example.com', // your Octadash ingest
  release: process.env.RELEASE,
})

// Product usage
octadash.track('signed_up', { distinctId: user.id, properties: { plan: 'pro' } })

// Errors
try {
  await charge(order)
} catch (err) {
  octadash.captureException(err, { distinctId: user.id, tags: { gateway: 'stripe' } })
}
```

- Uncaught exceptions and unhandled rejections are reported, then the process
  exits with 1, as Node does. `captureUncaught: false` turns that off.
- Calls never throw and never wait. What is sent is batched and tried again a
  few times when the ingest does not answer (a redeploy).
- Without a key every call does nothing, so local runs send nothing.
- In a short script, `await octadash.shutdown()` before it ends.

Docs: [docs.octadash.com/send-data/node](https://docs.octadash.com/send-data/node).
MIT license.
