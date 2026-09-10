# Contributing

Thanks for considering a contribution. This is a small, dependency-free client
library with a narrow job, so most changes are small and most of the review is
about invariants rather than style.

Security issues do **not** belong here: email **info@astermd.com** and never
open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Getting set up

```bash
npm ci
npm run gate
```

`npm ci` installs the pinned dev dependencies; there are no runtime ones. The
gate is the whole quality bar and it runs locally in seconds.

Node **22 is the minimum** and 24 is supported. CI runs the gate on both.
Raising the floor is a breaking change: it goes in the changelog and in
`engines`, never quietly.

## The gate

`npm run gate` runs six stages, in this order, stopping at the first failure:

| #   | Stage        | Command                                                                          |
| --- | ------------ | -------------------------------------------------------------------------------- |
| 1   | Lint         | `eslint .`                                                                       |
| 2   | Types        | `tsc --noEmit`                                                                   |
| 3   | Tests        | `vitest run`                                                                     |
| 4   | Build        | `tsup` — ESM, CJS and declarations                                               |
| 5   | Dist interop | `import` and `require` the built output and check `instanceof VrioError` in both |
| 6   | Package lint | `publint`                                                                        |

The order is deliberate: style before types, types before tests, tests before a
build, and the built artefact checked before the package metadata that
describes it.

**Every stage must pass on both supported Node versions before anything is
tagged.** A release is cut from a green gate, not from a green subset.

## Style

- ESLint and Prettier, with lines wrapping at **120 columns**.
- `npm run lint:fix` fixes most findings; `npm run format` handles the rest.
- Full TSDoc on every class, method and exported type. Public classes get a
  short description of what they are for, methods get a couple of sentences
  plus `@param`, `@returns` and `@throws`.
- Error classes end in `Error`.
- Relative imports carry a `.js` extension, so the ESM output resolves.
- Method and variable names in `camelCase`, classes in `PascalCase`. API
  payload keys stay in whatever case the provider uses — `order_id`,
  `cart_token`.
- Comments explain _why_, not _what_. Do not narrate the code.

## Architectural rules a change must not break

These are the invariants the package's security and testability rest on. A
change that needs one of them relaxed needs a conversation first.

- **All network access goes through `HttpClientInterface`.** No `fetch` call
  and no socket outside `Http/FetchClient` and the CONNECT tunnel it delegates
  to.
- **Credentials travel in headers only.** Never merge the API key into a body,
  a query string, or the `payload` an accessor can return.
- **Never accept a full URL from a consumer.** `ClientConfig` takes a bare host
  and rejects anything containing a scheme, path, query or space. The client
  owns the scheme and the path assembly.
- **Never disable TLS verification, and never add an option to.**
- **Logging cannot change behaviour.** `DebugLogger` reads immutable `Request`
  and `Response` objects and returns a string. It mutates nothing and swallows
  its own failures.
- **Resources stay stateless.** A resource method validates its arguments and
  returns a frozen request descriptor. It stores nothing per call: `API` caches
  one instance per resource class and Node runs calls concurrently, so any
  per-call field would be a data race.

## Testing rules

- Every public method has a test.
- **No test may reach an external network.** Use the mock transport for
  resource and envelope tests.
- Transport tests that need a real socket bind a **loopback HTTP server on port
  0** and read the assigned host and port from the server, rather than
  hardcoding an address or a port.
- Resource tests assert the URL, the HTTP method, the headers and the request
  body — all four, not just the URL.
- Credentials in tests are obviously fake placeholders. Never a real key, not
  even an expired one.
- A new redaction rule needs **both** tests: one proving the log entry is
  masked, and one proving the real request and the returned response are
  unchanged.

## Adding an endpoint

Four places, all of them required:

1. The method on its resource class, returning a descriptor from one of the
   `send*` helpers.
2. `API.METHOD_MAP`, plus the matching typed method on `API` that delegates
   through it.
3. The README's method table for that resource group.
4. A test asserting URL, HTTP method, headers and body.

`API.supportedMethods()` reads from `METHOD_MAP`, so a method missing from the
map is invisible to consumers even if the resource implements it.

## Commits and changelog

- One logical change per commit, with a short imperative subject line prefixed
  by its kind: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- The body explains why, not what — the diff already says what.
- A user-visible change comes with a `CHANGELOG.md` entry under
  `[Unreleased]`, in the Keep a Changelog sections. Internal refactors that
  change nothing observable do not need one.
- Run `npm run gate` before you push. CI runs the same thing, twice.
