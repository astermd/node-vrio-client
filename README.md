<p align="center">
  <a href="https://www.astermd.com/"><img src="https://raw.githubusercontent.com/astermd/node-vrio-client/main/.github/assets/astermd-logo.svg" alt="AsterMD" height="48"></a>
</p>

# @astermd-hq/vrio-client

A small, dependency-free Node.js client for the VRIO commerce API — campaigns,
customers, offers, discounts, carts, orders and routes — with opt-in request
logging that is redacted by default.

> **Unofficial.** This is an independent client library. It is not the official
> VRIO SDK and is not affiliated with, endorsed by or supported by VRIO.
> "VRIO" and related marks belong to their owner, <https://www.vrio.com/>. The
> name is used here only to identify the API this library talks to. See
> [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md) for the full notice.

API reference: **<https://docs.vrio.com/reference/vrio-api-overview>**

## Requirements

- Node.js **22 minimum**, **24 supported**
- No runtime dependencies
- **Server-side only.** The package is given an API key, so it must never run
  in a browser or in any bundle shipped to one.

CI runs the full gate on 22 and 24.

## Installation

```bash
npm install @astermd-hq/vrio-client
```

## Quick start

```ts
import { API, isEnvelope } from '@astermd-hq/vrio-client';

const api = new API(apiKey); // host defaults to api.vrio.app

const orders = await api.searchOrder({ with: 'items' }).getInObject();

if (isEnvelope(orders.response) && orders.response.success) {
  // `data` is deliberately `unknown` — this package invents no per-endpoint
  // response shapes. Cast it to whatever your integration expects.
  const list = orders.response.data as ReadonlyArray<Record<string, unknown>>;
  for (const order of list) {
    // ...
  }
}
```

`orders.response` is typed `Envelope | TransportFailure | WithHeader<Envelope>` —
`isEnvelope()` narrows it before `.success` and `.data` are readable. See
[Reading a response](#reading-a-response) for `isTransportFailure()`, the
counterpart guard for a request that never reached the provider.

The API key is a **required argument**. This package ships no default
credentials and reads none from the environment.

## Configuration

```ts
const api = new API(apiKey, {
  host: 'api.vrio.app',
  basePath: '',
  timeout: 30,
  connectTimeout: 10,
  debug: false,
  debugRedact: true,
  // debugFile: '/var/log/vrio/client.log', // required when debug is on and no debugSink is given
  debugRetentionDays: 7,
  debugTimezone: 'UTC',
  // debugSink: (entry) => { /* ... */ },   // replaces the file sink entirely
});
```

| Option               | Type     | Default        | Purpose                                                                                              |
| -------------------- | -------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `host`               | string   | `api.vrio.app` | **Bare hostname only.** A scheme, path, query or space is rejected.                                  |
| `basePath`           | string   | `''`           | Optional path prefix below the host, e.g. `v1`.                                                      |
| `timeout`            | number   | `30`           | Transfer timeout in seconds.                                                                         |
| `connectTimeout`     | number   | `10`           | Connection timeout in seconds.                                                                       |
| `debug`              | boolean  | `false`        | Master switch for request/response logging.                                                          |
| `debugRedact`        | boolean  | `true`         | Mask credentials and sensitive fields in log entries.                                                |
| `debugFile`          | string   | —              | Base path for the built-in dated file sink. Required when `debug` is on and no `debugSink` is given. |
| `debugRetentionDays` | number   | `7`            | Days of log history to keep. `0` keeps everything.                                                   |
| `debugTimezone`      | string   | `UTC`          | IANA timezone for log timestamps and dated filenames.                                                |
| `debugSink`          | function | —              | Replaces the file sink entirely.                                                                     |

`fetch` settles when the response headers arrive, so `connectTimeout` bounds
that phase and `timeout` bounds the whole exchange including the body read.

### Choosing an environment

Pass whichever host VRIO issued you. Production defaults to `api.vrio.app`; if
your account has a separate test host, supply it the same way:

```ts
const test = new API(testKey, { host: testHostFromYourVrioAccount });
```

Full URLs are rejected on purpose — the scheme is always HTTPS and path
assembly stays inside the client:

```ts
new API(apiKey, { host: 'https://api.vrio.app' }); // throws VrioError
new API(apiKey, { host: 'api.vrio.app/v1' }); // throws VrioError
new API(apiKey, { host: 'api.vrio.app', basePath: 'v1' }); // correct
```

## Reading a response

Every resource method returns a lazy `Call`. Nothing is sent until you read the
result. Three accessors read it:

```ts
await api.searchOrder().get(); // envelope as a JSON string
await api.searchOrder().getInObject(); // envelope decoded to an object
await api.searchOrder().getInArray(); // alias of getInObject()
```

`getInArray()` returns exactly the same value as `getInObject()`, because a
decoded JSON object is an object in Node. It is kept so examples transfer from
the PHP client unchanged.

A `Call` sends at most once, so reading it twice does not issue two requests.

### Awaiting without an accessor

Awaiting the `Call` itself sends the request and resolves to what
`getInObject()` returns:

```ts
await api.addOrder({ connection_id: 'con_1', email: 'buyer@example.test' });
```

Pass `true` to an accessor to also receive the request URL and payload:

```ts
await api.searchOrder({ with: 'items' }).getInObject(true);
```

```ts
const shape = {
  response: {
    success: true,
    message: '',
    data: {/* the provider's body, verbatim */},
  },
  payload: {
    endPoint: 'https://api.vrio.app/orders?with=items',
    with: 'items',
  },
};
```

`payload` never contains your API key — it is safe to surface in your own
diagnostics.

When the provider returns an error the envelope carries it:

```ts
const shape = {
  success: false,
  message: 'Order not found',
  validation_code: 'not_found',
  data: {/* the provider's error body */},
};
```

If the request never reached the provider, the object accessors return
`{ curlError: '...' }` instead, and `get()` returns the bare message.

The accessor names also exist on `API` itself, where they always throw
`VrioError('No API method has been invoked yet')`. Read the result from the
`Call` the resource method returned.

## Available methods

Consult the [VRIO API reference](https://docs.vrio.com/reference/vrio-api-overview)
for the fields each endpoint accepts. `params` is sent as query parameters on
`GET` calls and as the JSON body on the rest. Every `params` argument is
optional and typed `Record<string, unknown>`.

`API.supportedMethods()` returns the names of all 18 methods.

### Campaigns

| Method                                          | Request                             |
| ----------------------------------------------- | ----------------------------------- |
| `getCampaignItems(campaignId: string, params?)` | `GET /campaigns/{campaignId}/items` |

### Customers

| Method                                     | Request                       |
| ------------------------------------------ | ----------------------------- |
| `getCustomer(customerId: string, params?)` | `GET /customers/{customerId}` |

### Offers

| Method                 | Request       |
| ---------------------- | ------------- |
| `searchOffer(params?)` | `GET /offers` |

### Routes

| Method                               | Request                 |
| ------------------------------------ | ----------------------- |
| `getRoute(routeId: string, params?)` | `GET /routes/{routeId}` |

### Discounts

| Method                       | Request                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `validateDiscount(params?)`  | `POST /discounts/validate`                                                      |
| `calculateDiscount(params?)` | `POST /discounts/calculate` — the params are sent as the body's `offers` member |

### Orders

| Method                                     | Request                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `searchOrder(params?)`                     | `GET /orders`                                                |
| `getOrder(orderId: string, params?)`       | `GET /orders/{orderId}`                                      |
| `addOrder(params?)`                        | `POST /orders`                                               |
| `editOrder(params?)`                       | `PATCH /orders/{order_id}` — requires `order_id` in `params` |
| `processOrder(orderId: string, params?)`   | `POST /orders/{orderId}/process`                             |
| `completeOrder(orderId: string, params?)`  | `POST /orders/{orderId}/complete`                            |
| `authorizeOrder(orderId: string, params?)` | `POST /orders/{orderId}/authorize`                           |
| `captureOrder(orderId: string, params?)`   | `POST /orders/{orderId}/capture`                             |
| `addOrderNote(orderId: string, params?)`   | `POST /orders/{orderId}/notes`                               |

### Carts

| Method                       | Request                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `createCart(params?)`        | `POST /carts`                                                               |
| `createPaypalToken(params?)` | `POST /carts/{cart_token}/payment_tokens` — requires `cart_token`           |
| `getPaypalData(params?)`     | `GET /carts/{cart_token}/payment_tokens/{payment_token_id}` — requires both |

Examples:

```ts
await api.getCampaignItems('camp_1', { with: 'offers' }).getInObject();

await api
  .addOrder({
    connection_id: 'con_1',
    campaign_id: 'camp_1',
    email: 'buyer@example.test',
  })
  .getInObject();

await api.captureOrder('ord_1', { amount: 1000 }).getInObject();
```

## Errors

Everything the package raises is a `VrioError`, one class, which extends
`Error`:

```ts
import { VrioError } from '@astermd-hq/vrio-client';

try {
  const result = await api.getOrder(orderId).getInObject();
} catch (error) {
  if (error instanceof VrioError) {
    // empty API key, non-bare host, missing required argument,
    // unknown method, or an undecodable response
  }
}
```

The name is kept from the PHP client so an error branch carried over from that
package keeps working.

Provider-side errors and transport failures are **not** thrown — they come back
in the envelope, as shown above, and a transport failure arrives as
`{ curlError: '...' }`.

## Debug logging

Logging is off unless you turn it on. When on, entries are redacted by default
and written as copy-pasteable cURL commands with the response beneath.

```ts
const api = new API(apiKey, {
  debug: true,
  debugFile: '/var/log/vrio/client.log',
  debugRetentionDays: 7,
  debugTimezone: 'UTC',
});
```

Which produces `/var/log/vrio/client-2026-08-16.log` containing:

```
[2026-08-16 09:14:02.481000 UTC]
curl --location --request POST 'https://api.vrio.app/orders' \
  --header 'Content-Type: application/json' \
  --header 'hostname: api.vrio.app' \
  --header 'X-Api-Key: [REDACTED]' \
  --data '{"email":"buyer@example.test","card":{"number":"[REDACTED]","cvv":"[REDACTED]"}}'

# Response: HTTP 201
{"id":"ord_1","access_token":"[REDACTED]"}
```

Timestamps carry millisecond resolution written into the microsecond field, so
the last three digits are always zero. The format is otherwise identical to the
PHP client's.

### What is redacted

Headers and bodies. In headers: `X-Api-Key`, `Authorization` (the scheme is
kept, so `Bearer [REDACTED]`), `Proxy-Authorization`, `Cookie`. In bodies, by
field name: API keys and secrets, passwords, every `*_token` including
`access_token` and `refresh_token`, card numbers, CVV/CVC, expiry fields, bank
account and routing numbers, IBAN, and government identifiers such as SSN, tax
ID and date of birth. Card numbers are additionally caught by shape — any
13–19 digit string that passes a Luhn check is masked wherever it appears.

A body that is not decodable JSON cannot be field-masked, so it is replaced
whole rather than logged on the chance it is harmless.

**Redaction never changes what is sent or what you receive.** The logger reads
from immutable request and response objects and produces a string; the wire
request and the value returned to your code are untouched. The test suite
asserts this directly.

### The URL is logged verbatim

By design — you need the real URL for a log entry to be reproducible. That
means anything the API takes in a path segment or query string is written to
the log even with redaction on. In this client that is:

| Call                                                                                                                     | What lands in the log                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `getPaypalData()`                                                                                                        | the cart token and the payment token, both in the path |
| `createPaypalToken()`                                                                                                    | the cart token, in the path                            |
| `getCustomer()`                                                                                                          | the customer ID, in the path                           |
| `getOrder()`, `processOrder()`, `completeOrder()`, `authorizeOrder()`, `captureOrder()`, `addOrderNote()`, `editOrder()` | the order ID, in the path                              |
| `getCampaignItems()`, `getRoute()`                                                                                       | the campaign or route ID, in the path                  |
| any `GET` with `params`                                                                                                  | every query parameter you passed, encoded but unmasked |

Do not pass sensitive values as query parameters to `GET` calls if your log
retention cannot accommodate them.

### Turning redaction off

```ts
const api = new API(apiKey, {
  debug: true,
  debugRedact: false, // logs the real API key and full bodies
  debugFile: '/tmp/vrio-debug.log',
});
```

This writes live credentials and complete payloads to disk. It exists for local
debugging. **Never enable it in production.**

### File rotation and retention

The built-in sink writes one file per calendar day, deriving the name from your
base path: `/var/log/vrio/client.log` becomes `client-2026-08-16.log`,
`client-2026-08-17.log`, and so on.

Pruning removes files older than `debugRetentionDays` (default 7; `0` keeps
everything). It only ever matches this package's own dated filename pattern for
your base path — other files in the directory are never touched — and it reads
the age from the filename rather than the modification time, so an appended-to
or restored file keeps its true age. It runs once per process, not once per
request.

### Sending logs somewhere else

Supply a function and the file sink is replaced entirely. The package then
writes no files, and retention becomes your responsibility:

```ts
const api = new API(apiKey, {
  debug: true,
  debugSink: (entry: string): void => {
    myLogger.debug(entry);
  },
});
```

The sink signature is `(entry: string) => void | Promise<void>`. It receives
the finished entry, already redacted unless you opted out, and a returned
promise is awaited before the call resolves. This is the extension point for
any external destination — a logging library, a queue, a log shipper, an object
store.

A failure inside your sink is caught and discarded: logging must never break an
API call.

### Logs stay sensitive after redaction

A redacted entry still records which account touched which order, cart,
customer and route, and when. Store logs on encrypted volumes, restrict read
access, ship them only to systems cleared for that data, and apply a retention
period at least as strict as the rest of your order data.

## Proxy support

```ts
await api.withProxy('proxy.example.test:8080', 'user:password').searchOrder().getInObject();
```

The setting applies to the next call only.

The bundled transport uses `fetch` directly and switches to an HTTP `CONNECT`
tunnel only when a proxy is set, so the default path is unaffected. If your
platform gives you a fixed egress address — a NAT gateway with a static IP, for
instance — that is usually the better way to satisfy an IP allowlist.

## Custom transport

Pass anything implementing `HttpClientInterface` as the third constructor
argument to route requests through your own stack, or to test without a
network:

```ts
import { API, type HttpClientInterface, Request, Response } from '@astermd-hq/vrio-client';

class MyTransport implements HttpClientInterface {
  async send(request: Request): Promise<Response> {
    // ... hand the request to your own stack, or a fixture ...
    return new Response(200, body, { http_code: 200 });
  }
}

const api = new API(apiKey, {}, new MyTransport());
```

An implementation must never throw on transport failure; report it through the
response so the logger can record the attempt first.

TLS peer and host verification are always on in the bundled transport, and
there is no option to disable them.

## Further documentation

- [Integration guide](docs/INTEGRATION_GUIDE.md) — setup, environments,
  production logging, error handling, troubleshooting.
- [Architecture](docs/ARCHITECTURE.md) — how a call flows through the package,
  where to extend it, and how it differs from the PHP client.
- [Contributing](CONTRIBUTING.md) — the gate, the style rules and the
  invariants a change must not break.
- [Security policy](SECURITY.md) — private disclosure and credential handling.
- [Changelog](CHANGELOG.md)

## Development

```bash
npm ci
npm run gate     # lint -> typecheck -> test -> build -> dist interop -> publint
```

See [CLAUDE.md](CLAUDE.md) for the conventions the gate enforces. No test in
this suite makes an external network call.

## Support

Email **hello@astermd.com**, or open an issue at
<https://github.com/astermd/node-vrio-client/issues>. The API reference for the
endpoints themselves lives in your AsterMD dashboard and at
<https://docs.vrio.com/reference/vrio-api-overview>.

Report security issues privately — see [SECURITY.md](SECURITY.md). Do not open
a public issue for a vulnerability.

## Compliance

Using this package does not by itself make your application PCI DSS, HIPAA or
GDPR compliant. It is one component in your system. Scoping, encryption at
rest, access control, audit logging, breach procedures and your agreements with
VRIO and your payment processors remain your responsibility. For licensing or
BAA enquiries, email **hello@astermd.com**.

## License

MIT — see [LICENSE](LICENSE). The trademark and affiliation notice is in
[NOTICE.md](NOTICE.md).

Maintained by [AsterMD](https://www.astermd.com/). Contact: hello@astermd.com
