# Contributing notes for AI agents and humans

This file describes how to work in this repository. It is public; keep it that
way. Anything internal belongs in `CLAUDE.local.md`, which is gitignored.

## What this package is

A small, dependency-free Node.js client for the VRIO commerce API. It has one
job: turn a method call into a well-formed HTTP request, and turn the response
into a predictable envelope. It keeps no state between calls and no credentials
of its own. It runs server-side only.

## Language and tooling

- Node **22 minimum**, 24 supported. CI runs the gate on both.
- TypeScript with `strict` on. No `any` in the public surface, and no
  suppression comment without a reason next to it.
- Raising the minimum Node version is a breaking change — it goes in the
  changelog and in `engines`, never quietly.
- **Zero runtime dependencies.** Adding one needs a strong argument: consumers
  install this alongside their own stack, and every dependency is a version
  constraint someone else has to satisfy.

## Style

- ESLint and Prettier, enforced by `npm run lint`. Lines wrap at 120 columns.
- Full TSDoc on every class, method and exported type, including `@param`,
  `@returns` and `@throws`. Public classes get a short description of what they
  are for; internal ones are documented too.
- Error classes end in `Error`.
- Relative imports carry a `.js` extension, so the ESM output resolves.
- Class names in `PascalCase`, methods and variables in `camelCase`; API
  payload keys stay in whatever case the provider uses (`order_id`,
  `cart_token`).
- Comments explain _why_, not _what_. Do not narrate the code.

## Architecture rules

- `API` is the only entry point a consumer touches. It resolves a method name
  to a resource class through `METHOD_MAP` and a typed method per endpoint, and
  delegates.
- Resource classes (`Order`, `Cart`, …) extend `Vrio` and return a descriptor
  from one of the `sendGet` / `sendPost` / `sendPatch` / `sendPut` /
  `sendDelete` helpers. They contain no HTTP logic.
- **Resources are stateless: they return a frozen descriptor and never hold
  per-call state.** `API` caches one instance per resource class and Node runs
  calls concurrently, so a per-call field on a resource is a data race.
- `Call` owns execution: URL assembly, header construction, body encoding, the
  response envelope and the three accessors. It is lazy and sends at most once.
- All network access goes through `HttpClientInterface`. Never call `fetch` or
  open a socket outside `Http/FetchClient` and the CONNECT tunnel it delegates
  to.
- Credentials travel in headers only. Never merge the API key into a body, a
  query string, or the `payload` an accessor can return.
- Never accept a full URL from a consumer. `ClientConfig` takes a bare host and
  rejects anything containing a scheme, path, query or space.
- Never disable TLS verification, and never add an option to.
- Logging must not be able to change behaviour. `DebugLogger` reads from
  `Request`/`Response` value objects and returns a string; it mutates nothing
  and swallows its own failures.
- Adding a resource method means adding it to `API.METHOD_MAP`, adding the
  typed method on `API`, and adding it to the README.

## Testing rules

- Every public method has a test.
- **No test may touch an external network.** Use the mock transport.
- Transport tests that need a real socket bind a loopback HTTP server on
  **port 0** and read the assigned host and port from the server rather than
  hardcoding an address or a port.
- Resource tests assert the URL, the HTTP method, the headers and the request
  body — all four.
- Credentials in tests are obviously fake placeholders. Never a real key, not
  even an expired one.
- New redaction rules need a test proving the real request and response are
  unchanged, alongside the test proving the log entry is masked.

## Running the gate

```bash
npm ci
npm run gate
```

which runs, in order and stopping at the first failure:

| #   | Stage          | Checks                                                           |
| --- | -------------- | ---------------------------------------------------------------- |
| 1   | `eslint .`     | style                                                            |
| 2   | `tsc --noEmit` | types, `strict`                                                  |
| 3   | `vitest run`   | the full suite                                                   |
| 4   | `tsup`         | ESM, CJS and declarations                                        |
| 5   | dist interop   | `import` and `require` the build, `instanceof VrioError` in both |
| 6   | `publint`      | package metadata and the exports map                             |

`npm run lint:fix` fixes most style findings automatically. All six stages must
pass on every supported Node version before anything is tagged.
