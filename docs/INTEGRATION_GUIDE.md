# Integration guide

Getting `@astermd-hq/vrio-client` into a production application, and the
decisions worth making deliberately along the way.

This guide assumes you already have VRIO API credentials. For what each
endpoint accepts and returns, use the API reference in your AsterMD dashboard
and the provider's own reference:
<https://docs.vrio.com/reference/vrio-api-overview>.

---

## 1. Install

```bash
npm install @astermd-hq/vrio-client
```

Requires **Node.js 22 or newer**; 24 is supported and covered by CI. There are
no runtime dependencies, so the package will not drag a framework or an HTTP
library into your application.

The package is **server-side only**. It is given an API key and sends it as a
request header, so it must never be imported into browser code or into any
bundle shipped to a browser.

---

## 2. Supply credentials

The API key is a **required constructor argument that you pass in**. The
package has no credential discovery of any kind: it ships no defaults, reads no
environment variables, opens no config file, and consults no global state.
Whatever you hand the constructor is what it uses.

```ts
import { API } from '@astermd-hq/vrio-client';

const api = new API(apiKey);
```

That is deliberate. A key can never arrive from somewhere you did not intend,
and nothing changes behaviour between machines because of an environment
difference.

Where _you_ get `apiKey` from is entirely your decision — a secrets manager,
your application's configuration, or a per-account record in your own database.
The package neither knows nor cares.

### Multiple VRIO accounts

Because the key is a constructor argument rather than ambient configuration,
integrating several accounts is just several instances. Nothing is shared or
cached between them:

```ts
import { API } from '@astermd-hq/vrio-client';

interface Account {
  readonly apiKey: string;
  readonly host?: string;
}

export function apiForAccount(account: Account): API {
  return new API(account.apiKey, { host: account.host ?? 'api.vrio.app' });
}
```

Build the client at the point of use, from the account you are acting for.
Avoid registering a single process-wide instance unless you genuinely only ever
talk to one account.

### Wiring it into a container

If you do have exactly one account, a single long-lived instance is fine — just
note that the key still arrives as an argument you supply:

```ts
export const api = new API(keyFromWhereverYouKeepIt, {
  host: 'api.vrio.app',
  debug: false,
  // when debug is on, one of debugFile / debugSink is required
});
```

### Handling the key itself

If the key has ever been committed, pasted into a ticket, or logged verbatim,
rotate it — removing it from a file does not un-expose it.

---

## 3. Choose the host

The client takes a **bare hostname**. It builds the scheme and the path itself,
so a full URL is rejected:

```ts
new API(key, { host: 'api.vrio.app' }); // fine
new API(key, { host: 'https://api.vrio.app' }); // VrioError
new API(key, { host: 'api.vrio.app/v1' }); // VrioError
new API(key, { host: 'api.vrio.app', basePath: 'v1' }); // fine
```

Omitting `host` gives you `api.vrio.app`.

### Test accounts

If VRIO issued you a separate test or sandbox host, pass it exactly the same
way — the client treats every host identically and applies no environment
branching of its own:

```ts
const test = new API(testKey, { host: testHostFromYourVrioAccount });
```

Keep that host and its key in configuration rather than in code, so the same
build can be pointed at either environment.

> The non-production hostname is issued per account, so this document does not
> name one. Take it from your VRIO account or from VRIO support, and record it
> in your own environment configuration.

---

## 4. Make a call and read the result

A resource method returns a lazy `Call`; an accessor sends the request and
produces the result.

```ts
import { isEnvelope } from '@astermd-hq/vrio-client';

const result = await api.searchOrder({ with: 'items' }).getInObject();

if (isEnvelope(result.response) && result.response.success) {
  // `data` is deliberately `unknown` -- cast it to whatever your integration expects.
  const orders = result.response.data as ReadonlyArray<Record<string, unknown>>;
}
```

`result.response` is typed `Envelope | TransportFailure | WithHeader<Envelope>`.
`isEnvelope()` narrows it to the plain envelope before `.success` and `.data`
are readable; its counterpart `isTransportFailure()` narrows the other way,
covered in [§5c](#c-the-request-never-arrived).

Three accessors, same envelope:

| Accessor        | `response` contains                                   |
| --------------- | ----------------------------------------------------- |
| `get()`         | the envelope as a JSON string                         |
| `getInObject()` | the envelope decoded to an object                     |
| `getInArray()`  | an alias of `getInObject()`, returning the same value |

Awaiting the `Call` without an accessor sends the request too, and resolves to
what `getInObject()` returns:

```ts
await api.addOrderNote('ord_1', { note: 'Shipped' });
```

A `Call` sends at most once, however many times you read it.

Pass `true` to an accessor to add a `payload` key with the exact URL called and
the parameters sent. It never includes your API key, so it is safe to attach to
your own error reports.

The three accessor names also exist on `API`, where they always throw
`VrioError('No API method has been invoked yet')`. Read the result from the
`Call` the resource method returned.

---

## 5. Handle failures

There are three distinct failure modes, and they surface differently. Handling
all three is the difference between a robust integration and a fragile one.

### a. Your mistake — a `VrioError`

Thrown before or during the call: an empty API key, a host that is not bare, a
missing required argument, an unknown method, an undecodable envelope.

```ts
import { VrioError } from '@astermd-hq/vrio-client';

try {
  const result = await api.getOrder(orderId).getInObject();
} catch (error) {
  if (error instanceof VrioError) {
    // programming or configuration error — log it and fail loudly
  }
}
```

### b. The provider rejected the request

Not thrown. The envelope reports it:

```ts
const { response } = await api.getOrder(orderId).getInObject();

if (isEnvelope(response) && !response.success) {
  const message = response.message; // e.g. 'Order not found'
  const code = response.validation_code; // e.g. 'not_found'
}
```

### c. The request never arrived

A DNS failure, a timeout, a TLS problem. Also not thrown:

```ts
const { response } = await api.searchOrder().getInObject();

if ('curlError' in response) {
  // transport failure — safe to retry
}
```

The key is spelled `curlError` even though this package uses `fetch`. It is
kept from the PHP client so an error branch carried over from that package
keeps working. `isTransportFailure(response)`, exported alongside `isEnvelope`,
narrows the same way and reads more directly at a call site with several
branches.

A complete handler:

```ts
async function fetchOrder(api: API, orderId: string): Promise<unknown | null> {
  let response;

  try {
    ({ response } = await api.getOrder(orderId).getInObject());
  } catch (error) {
    report(error);
    return null;
  }

  if (isTransportFailure(response)) {
    throw new TransientVrioFailure(response.curlError); // retry this
  }

  if (!isEnvelope(response) || !response.success) {
    return null; // do not retry
  }

  return response.data;
}
```

### Timeouts and retries

Defaults are 30 s overall, 10 s to the response headers. Tighten them for
user-facing paths and widen them for background jobs:

```ts
const interactive = new API(key, { timeout: 5, connectTimeout: 2 });
const batch = new API(key, { timeout: 120, connectTimeout: 10 });
```

Because `fetch` settles when the response headers arrive, `connectTimeout`
bounds that phase and `timeout` bounds the whole exchange including the body
read. An elapsed deadline surfaces as a transport failure naming which one it
was.

The package performs no retries — retry policy belongs to your job runner,
where it can be observed and bounded. Retry on `curlError`; do not blindly
retry `authorizeOrder` or `captureOrder`, which are not idempotent.

---

## 6. Logging in production

Logging is off unless you enable it. Enabling it needs a destination — either
`debugFile` or `debugSink` — or construction throws.

### Recommended production shape

```ts
const api = new API(key, {
  debug: true,
  debugFile: '/var/log/vrio/client.log',
  debugRetentionDays: 7,
  debugTimezone: 'UTC',
});
```

- Redaction is on by default. Leave it on.
- One file per day: `client-2026-08-16.log`, `client-2026-08-17.log`, …
- Files older than the retention window are pruned once per process. Pruning
  only matches this package's own dated pattern and reads the date from the
  filename, never the mtime.
- Point `debugFile` at a directory your service user can write to and your
  application cannot serve. Never under a public document root.

### Shipping elsewhere

A sink function replaces the file sink entirely — the package then writes no
files, and retention becomes yours to manage:

```ts
const api = new API(apiKey, {
  debug: true,
  debugSink: (entry: string): void => {
    myLogger.debug(entry);
  },
});
```

The signature is `(entry: string) => void | Promise<void>`; a returned promise
is awaited before the call resolves, so an entry is never lost to process exit.
Anything throwing or rejecting inside your sink is caught and discarded; a
logging failure will not break an API call.

### Before you ship logs anywhere

- The **URL is written verbatim**. Order IDs, customer IDs, cart tokens and
  payment token IDs appear in the path, and every query parameter you pass to a
  `GET` is recorded unmasked. See the README table for the exact calls.
- `debugRedact: false` writes live credentials and complete bodies to disk.
  Local debugging only.
- Redacted logs remain sensitive. They record who touched what and when.
  Encrypt at rest, restrict read access, and retain them no longer than the
  order data they describe.

---

## 7. Testing your own code

Inject a fake transport instead of stubbing the client:

```ts
import { expect } from 'vitest';
import { API, type HttpClientInterface, Request, Response } from '@astermd-hq/vrio-client';

class FakeVrio implements HttpClientInterface {
  public lastRequest?: Request;

  async send(request: Request): Promise<Response> {
    this.lastRequest = request;

    return new Response(200, '{"id":"ord_1"}', { http_code: 200 });
  }
}

const transport = new FakeVrio();
const api = new API('test-key-placeholder', {}, transport);

await api.getOrder('ord_1').getInObject();

expect(transport.lastRequest?.getUrl()).toBe('https://api.vrio.app/orders/ord_1');
```

Note the `await`: a `Call` sends nothing until it is read, so a test that
inspects the request must read the result first.

Use obviously fake keys. Never a real credential, not even an expired one.

---

## 8. Reusing the client

A single `API` instance is safe to reuse across many calls, including
concurrent ones. Resources hold no per-call state — each call carries its own
frozen request descriptor — so fields from one call cannot leak into another,
and `Promise.all` over one client is fine:

```ts
const [orders, customer] = await Promise.all([
  api.searchOrder({ with: 'items' }).getInObject(),
  api.getCustomer('cus_1').getInObject(),
]);
```

Two caveats:

- `withProxy()` applies to the **next call only** and then clears itself. It is
  the one piece of client-level state, so chain it directly onto the call that
  needs it and do not start other calls between the two.
- Each account still needs its own instance, because the key and the host are
  fixed at construction.

---

## 9. Troubleshooting

| Symptom                                     | Cause                                                         | Fix                                                                  |
| ------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| `An API key is required`                    | Empty or whitespace key                                       | Check the value you passed to the constructor — nothing is defaulted |
| `The host must be a bare hostname…`         | A full URL in `host`                                          | Strip `https://` and move any path to `basePath`                     |
| `Debug logging needs either a "debugFile"…` | `debug: true` with no destination                             | Add `debugFile` or `debugSink`                                       |
| `No API method has been invoked yet`        | An accessor called on `API` instead of on the returned `Call` | `await api.searchOrder().getInObject()`                              |
| `No such method found`                      | Typo, or a method this client does not implement              | `API.supportedMethods()` lists all 18                                |
| `Missing required fields`                   | An empty ID, or a missing `order_id` / `cart_token`           | Validate before calling                                              |
| Nothing appears on the wire                 | A resource call that was never read or awaited                | A `Call` is lazy — `await` it, or read an accessor                   |
| `curlError` on every call                   | Network, DNS, TLS or firewall                                 | Verify the host, and that egress to it is allowed                    |
| No log file appears                         | Directory not writable, or `debug` still off                  | Check permissions on the `debugFile` directory                       |
| Log file has yesterday's date               | Files are per calendar day in `debugTimezone`                 | Expected — set `debugTimezone` to match your ops timezone            |

---

## 10. Migrating from the PHP client

If you are moving an integration off `astermd/vrio-client`, the surface is
deliberately the same wherever the two languages allow it. These are the
differences that touch your code:

| PHP                                        | Node                                                          |
| ------------------------------------------ | ------------------------------------------------------------- |
| `use AsterMD\VrioClient\API;`              | `import { API } from '@astermd-hq/vrio-client';`              |
| `new API($apiKey, $options)`               | `new API(apiKey, options)`                                    |
| `$api->searchOrder($p)->getInArray()`      | `await api.searchOrder(p).getInObject()`                      |
| `$api->searchOrder(); $api->getInArray();` | not supported — read the result from the returned `Call`      |
| `catch (VrioException $e)`                 | `catch (error) { if (error instanceof VrioError) … }`         |
| `HttpClientInterface::send()`              | `HttpClientInterface.send()`, returning a `Promise<Response>` |
| `'debugSink' => fn (string $e) => …`       | `debugSink: (entry: string) => void \| Promise<void>`         |

Everything else carries over: the option names and their defaults, the
envelope, the `curlError` key, the `payload` contents, the redaction rules and
the log format, and all 18 method names and signatures.

Behaviour worth knowing about as you port:

- Every call is asynchronous. A resource method returns a lazy `Call` and sends
  nothing until it is awaited or an accessor is read, so a call whose result you
  ignored in PHP needs an `await` here to happen at all.
- `getInArray()` returns the same value as `getInObject()` — a decoded JSON
  object is an object in Node. It exists so examples transfer unchanged.
- `payload` is correct per call rather than being the last call's snapshot,
  because it belongs to the `Call` rather than to the client.
- TLS verification is enforced, as it was in the PHP client. If requests fail
  against a proxy with a self-signed certificate, install the CA properly
  rather than looking for a switch — there is not one.
- Log timestamps have millisecond resolution written into the microsecond
  field, so the last three digits are always zero.
