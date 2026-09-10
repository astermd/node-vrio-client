# Architecture

How a call travels through `@astermd-hq/vrio-client`, why the pieces are split
the way they are, and where to extend it.

---

## Layers

```
        ┌──────────────────────────────────────────────────┐
        │  API                    facade + method dispatch  │
        └───────────────────────┬──────────────────────────┘
                                │ resolves a method name to a resource
        ┌───────────────────────▼──────────────────────────┐
        │  Campaign  Customer  Discount  Offer             │
        │  Order     Route     Cart          resources     │
        └───────────────────────┬──────────────────────────┘
                                │ returns a frozen request descriptor
        ┌───────────────────────▼──────────────────────────┐
        │  Call        execution, accessors, one-shot send  │
        └───────────────────────┬──────────────────────────┘
                                │ URL, headers, body, envelope
        ┌───────────────────────▼──────────────────────────┐
        │  Vrio             descriptor construction        │
        └──────┬────────────────────────────────┬──────────┘
               │ Request                        │ Request + Response
    ┌──────────▼──────────┐          ┌──────────▼──────────┐
    │ HttpClientInterface │          │    DebugLogger      │
    │     FetchClient     │          │  Redactor, FileSink │
    └─────────────────────┘          └─────────────────────┘
```

Two rules hold the design together:

1. **Everything that reaches the network goes through `HttpClientInterface`.**
   No `fetch` call and no socket exists outside `Http\FetchClient` and the
   CONNECT tunnel it delegates to.
2. **Logging is a read-only observer.** It receives immutable `Request` and
   `Response` objects and returns a string. It cannot alter what is sent or
   what the caller receives.

---

## The lifecycle of one call

Take `await api.captureOrder('ord_1', { amount: 1000 }).getInObject()`.

**1. Dispatch.** `captureOrder` is a real, typed method on `API`. It looks its
own name up in `API.METHOD_MAP`, a frozen constant mapping all 18 resource
methods to their class. An unknown name — reachable only from plain JavaScript,
since TypeScript rejects it at compile time — throws `VrioError` here, before
anything else happens.

_Why a map rather than reflection:_ the original implementation enumerated the
methods of every resource and diffed against the parent on every single call.
The map is a constant lookup, it is greppable, and the type checker can see it.

**2. Resource resolution.** `API` instantiates `Order` once and caches it for
the lifetime of the client, handing it the shared `ClientConfig`,
`HttpClientInterface` and `DebugLogger`. A proxy queued by `withProxy()` is
taken from the client now and handed to this one call, then cleared.

**3. The resource describes the request.** `Order.captureOrder()` validates its
arguments and returns a **frozen request descriptor** — HTTP method, section,
fields, query and the header flag — built by one of `Vrio`'s `sendGet` /
`sendPost` / `sendPatch` / `sendPut` / `sendDelete` helpers. It assigns nothing
to itself and it sends nothing. Resource classes contain no HTTP knowledge
whatsoever — that is the whole reason they are thin.

**4. `Call` assembles.** The descriptor, the config, the transport, the logger
and any queued proxy go into a `Call`, which the resource method returns. The
`Call` is lazy: it joins `ClientConfig.getBaseUrl()` to the section, builds the
three headers, and JSON-encodes the body — using `{}` rather than `[]` for an
empty payload — only when an accessor is read or the `Call` is awaited. It
executes at most once, so reading it twice does not send twice.

**5. A fresh `Request` value object is built per attempt** and handed to the
transport. It is immutable and it is never replayed, which is what makes the
logging guarantee in rule 2 structural rather than a matter of discipline.

**6. `FetchClient` sends it.** TLS peer and host verification are on, with no
option to disable them. With no proxy it calls `fetch` directly; with a proxy
it opens an HTTP `CONNECT` tunnel and sends over that socket instead.
`connectTimeout` bounds the wait for response headers and `timeout` bounds the
whole exchange including the body read, both through `AbortSignal`. A transport
failure is _not_ thrown — it is returned as `Response.getTransportError()`, so
the logger can still record the attempt.

**7. `DebugLogger.log()` observes.** No-op unless `debug` is on. Otherwise it
renders the entry — redacted unless you opted out — and passes the string to
the sink, with writes serialised through a per-logger promise chain so
concurrent appends cannot interleave. Any failure inside logging is swallowed.

**8. `Call` normalises.** A transport error sets the error flag and stores the
message. Otherwise `buildEnvelope()` wraps the provider's body in the
`success` / `message` / `data` (/ `validation_code`) envelope.

**9. There is nothing to reset.** The PHP client's step here is `reset()`,
clearing the URL, section, fields, query and proxy from the resource instance
that had just been mutated. This port has no such step: a descriptor is a
per-call value, frozen at creation and owned by exactly one `Call`, so no state
from one call can reach another.

That matters more in Node than it did in PHP. Under PHP's request-per-process
model, calls through one client are strictly sequential, and mutate-then-reset
is safe. In Node, `Promise.all` over a single client is ordinary usage:

```ts
await Promise.all([api.searchOrder().getInObject(), api.getOrder('ord_1').getInObject()]);
```

`API` caches one resource instance per class, so with mutable per-call state
both calls would write to the same `Order` object — the second `section`
assignment landing before the first request was built, sending both requests to
the same URL, or one carrying the other's body. That is a race that only
appears under load and silently produces the wrong request. Stateless resources
remove the possibility rather than managing it.

**10. The caller reads.** `getInObject()` decodes the envelope; `get()` returns
it as a JSON string; `getInArray()` is an alias of `getInObject()`. Passing
`true` adds `payload`, the exact URL and parameters of this call, which is
correct by construction rather than by a snapshot taken before a reset.

---

## Class responsibilities

| Class                            | Owns                                                                                | Never does                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `API`                            | Method dispatch, resource caching, the queued proxy                                 | HTTP, URL building, keeping a call's result |
| `Call`                           | Lazy one-shot execution, URL and header assembly, the envelope, the three accessors | Mutating the descriptor it was given        |
| `ClientConfig`                   | Credentials, host validation, base URL, timeouts                                    | Anything mutable                            |
| `Vrio`                           | Descriptor construction — the `send*` helpers that shape one request                | Direct network calls, per-call state        |
| `Campaign`…`Cart`                | Route shape and argument validation                                                 | HTTP, encoding, per-call state              |
| `Http\Request` / `Http\Response` | Immutable descriptions of one exchange                                              | Behaviour                                   |
| `Http\FetchClient`               | The only `fetch` and the only socket in the package                                 | Throwing on transport failure               |
| `Logging\DebugLogger`            | Entry formatting, sink dispatch                                                     | Mutating anything                           |
| `Logging\Redactor`               | Masking copies of headers and bodies                                                | Touching the URL                            |
| `Logging\FileSink`               | Dated files, retention, pruning                                                     | Throwing                                    |
| `Config` / `Repository`          | Message strings                                                                     | Runtime configuration                       |
| `Errors\VrioError`               | Every error the package raises                                                      | —                                           |

---

## Design decisions worth knowing

### Credentials live in headers, nowhere else

`ClientConfig` holds the key; the header builder is the only place it is read.
It is never merged into the descriptor's fields, never appended to a query
string, and never included in the `payload` an accessor can return.

An earlier version of the PHP client copied the key into the request payload,
from where it reached callers through `get(true)`. Keeping the credential on
exactly one path is what makes that class of leak structurally impossible
rather than a bug waiting to reappear.

### A bare host, not a URL

`ClientConfig` rejects any host containing a scheme, path, query or space. The
client owns the scheme (always HTTPS) and the path assembly. A consumer that
could pass a full URL could downgrade to plaintext or redirect the client
somewhere unintended; a consumer that passes a hostname cannot.

`basePath` exists for APIs served under a version prefix, and is the only
supported way to add a path.

### The transport is an interface

Three things fall out of this: the entire test suite runs without an external
network, consumers can route calls through their own HTTP stack, and the
`fetch` and socket specifics stay in one small class. `Response` carries
transport errors as data rather than throwing, so a failure is observable by
the logger before anyone decides what to do about it.

### Immutable request and response objects

The logging guarantee — redaction cannot change behaviour — is enforced by the
type system rather than by review. `Redactor` receives values and returns new
ones; `Request` and `Response` expose only getters. A test asserts the wire
body and the returned body are untouched while the log entry is masked.

### Field masking, not body dropping

Bodies are masked field by field rather than dropped whole on sensitive routes.
This keeps debug logs useful for support while removing credentials, tokens,
card, bank and identity data. Two backstops widen the net: an unparseable body
is replaced entirely rather than logged, and any 13–19 digit string passing a
Luhn check is masked wherever it appears, even under an unexpected key.

The URL is deliberately exempt — a log entry that does not show the real URL is
not reproducible. The README lists which calls therefore record identifiers.

### Retention reads the filename, not the mtime

Appending to a log file updates its mtime, so mtime-based pruning keeps a
month-old file alive indefinitely as long as something writes to it. The date
in the filename is the file's real age. Pruning also matches only this
package's own dated pattern for the configured base path, so it can never
delete a neighbouring file, and it runs once per process rather than once per
request.

### Resources are stateless

A resource method takes its arguments, validates them, and returns a frozen
descriptor. It stores nothing. `API` caches one instance per resource class for
the client's lifetime, and Node runs calls concurrently, so any per-call field
on a resource would be shared mutable state between overlapping calls. The
descriptor makes the request a value that travels with the call instead of a
side effect left on an object, which is why this port needs no `reset()` and
why two concurrent calls cannot corrupt each other.

### `Call` is lazy and thenable

Lazy, so a resource method is cheap and the accessor decides what the result
looks like — a JSON string, a decoded object, with or without `payload` —
without the resource needing to know. One-shot, so reading the same `Call`
twice does not issue two requests.

Thenable, because in the PHP client `$api->addOrder([...])` on its own sends
the request; the accessor only reads what already happened. A lazy `Call` that
was not awaitable would turn that same line into a silent no-op — a request
that never left the process, with nothing to indicate it. Awaiting a `Call`
therefore resolves to exactly what `getInObject()` returns. It never resolves
to itself, which would be a recursion hazard.

### The proxy needs a tunnel

`fetch` in Node has no proxy option, and the agent that would provide one is
not a Node builtin — reaching for it would mean a runtime dependency for a
feature most consumers never enable. So the proxy path is hand-rolled: a
`node:http` `CONNECT` request to the proxy yields a socket, which is handed to
`node:https` as `{ socket, agent: false }`. Credentials become a
`Proxy-Authorization: Basic` header on the CONNECT itself and never appear on
the tunnelled request. TLS is negotiated inside the tunnel, end to end, with
verification on, so the proxy sees only the host it was asked to connect to.

The default path never touches this code. If your platform can give you a
fixed egress address instead, that is usually the better answer to an IP
allowlist; the tunnel exists for the consumer behind a corporate proxy who has
no infrastructure to reach for.

### No runtime dependencies

A client library is installed alongside the consumer's own stack; every
dependency it adds is a version constraint someone else has to satisfy. The
message table is a static object with dotted-key lookup, the query string is
~40 lines, and the proxy tunnel uses only `node:http` and `node:https`.

---

## Extension points

| You want to                                           | Do this                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Route calls through your own HTTP stack               | Implement `HttpClientInterface`, pass it as the third constructor argument                                                                                         |
| Send logs to a logging library, queue or object store | Supply a `debugSink` function; it replaces the file sink entirely                                                                                                  |
| Change log retention                                  | `debugRetentionDays` (`0` keeps everything), or take it over with your own sink                                                                                    |
| Support a new endpoint                                | Add the method to its resource class, add it to `API.METHOD_MAP` **and to `API` as a typed method**, document it in the README, test URL + method + headers + body |
| Add a redaction rule                                  | Extend the key lists in `Redactor`, and add both tests: the log is masked, the real request and response are not                                                   |
| Target a different host                               | `host` and `basePath` options — never a full URL                                                                                                                   |

Anything requiring a change to `Vrio`, `Call` or `FetchClient` is worth a
second look: those three hold the invariants everything else depends on.

---

## Differences from the PHP client

This package is a port of `astermd/vrio-client`. The public surface is
deliberately the same wherever the two languages allow it. Where they do not,
the difference is listed here, so a reader of both packages finds them in one
place.

| #   | Deviation                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Resources are stateless; `Call` executes. No `reset()`                                   | PHP's mutate-then-reset is a data race under Node concurrency; `API` caches resources and `Promise.all` over one client is ordinary usage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | `CurlClient` -> `FetchClient`                                                            | No cURL in Node; the old name would misdescribe it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 3   | `curlError` envelope key retained                                                        | Maintainer's decision — a consumer migrating from PHP keeps their existing error branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 4   | `Call` is thenable                                                                       | Otherwise a resource call with no accessor would send nothing, unlike the PHP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5   | `getInArray()` is an alias of `getInObject()`                                            | A decoded JSON object is an object in Node                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | `VrioError` for argument validation, not `TypeError`                                     | The PHP source raises its own exception type, not `InvalidArgumentException`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 7   | Log timestamps carry millisecond precision, zero-padded to microseconds                  | JavaScript `Date` has no microseconds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 8   | `Proxy` wrapper on `API`                                                                 | Preserves the unknown-method error for plain-JavaScript consumers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 9   | A hand-rolled CONNECT tunnel replaces two cURL options                                   | `fetch` has no proxy option and the agent that would provide one is not a Node builtin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 10  | `Config` drops the PHP config glob                                                       | No `dist` analogue; the table is statically imported                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 11  | Redirect cap is `fetch`'s 20, not cURL's 10                                              | Not configurable in `fetch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 12  | Transport specs bind loopback HTTP servers                                               | The only way to test a real transport without mocking the subject                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 13  | New files: `call.ts`, `query-string.ts`, `proxy-tunnel.ts`                               | Each forced by an item above                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 14  | `CONTRIBUTING.md` added                                                                  | The PHP repo has none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 15  | Accessors live on `Call`, not `API`; `API.get()` always throws                           | PHP's per-client "last invoked" field is the same mutable state #1 removes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 16  | The redactor preserves `{}` where PHP rewrites it to `[]`                                | PHP decodes a JSON body to an associative array, so an empty JSON object becomes an empty PHP array and the PHP client's own log prints `--data '[]'` for a request that carried `{}` — the log misreports the wire. The port keeps the object so the log reflects what was sent; this also applies to numerically-keyed objects under a sensitive parent, which PHP re-encodes as arrays                                                                                                                                                                                                                                                                                          |
| 17  | `FileSink.pathForDate()` formats in the sink's configured timezone                       | PHP formats in the passed date object's own zone; a JavaScript `Date` carries no zone. `write()` behaves identically in both packages — only a direct call to the public helper with an off-zone date differs, which is not expressible in JavaScript                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 18  | `get()` does not escape forward slashes; PHP's does                                      | PHP's `json_encode` escapes `/` as `\/` by default, so the PHP client's envelope string reads `https:\/\/api.vrio.app`. Both strings parse to identical objects, and emitting `\/` from JavaScript would require post-processing and would itself read as a defect, so the port emits plain slashes. Only a byte-comparison or hash of `get()`'s raw string differs                                                                                                                                                                                                                                                                                                                |
| 19  | `support/query-string.ts`'s `flatten()` raises `VrioError` past a 64-level nesting depth | PHP has no equivalent: `http_build_query()` recurses without a depth cap too, but a consumer forwarding deeply-nested, untrusted JSON as filter parameters would fail there with an uncatchable PHP stack overflow (a fatal error, not an exception), not a value PHP code could catch. Node's call stack is also finite, and an unbounded `flatten()` would fail the same way — surfacing a `RangeError`, which would break this package's contract that only `VrioError` ever escapes its own code. The port adds the cap specifically to convert that failure mode into a typed, catchable error; 64 is generous headroom above the one-to-three levels a real query ever nests |
