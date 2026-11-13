# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.2] - 2026-11-13

### Changed

- Documentation and package metadata only.

## [0.0.1] - 2026-09-08

First public release. A port of the `astermd/vrio-client` Composer package,
with the same public surface wherever TypeScript allows it.

### Added

- `API` client covering 18 VRIO endpoints across campaigns, customers, offers,
  discounts, carts, orders and routes, reached through a chainable call
  followed by `get()`, `getInObject()` or `getInArray()`, or by awaiting the
  call directly.
- A lazy, one-shot `Call` returned by every resource method: it sends nothing
  until an accessor is read or the call is awaited, and sends at most once
  however many times it is read.
- Stateless resources, so concurrent calls on one client cannot corrupt each
  other's request. Each call carries its own frozen request descriptor, and
  `Promise.all` over a single client is ordinary usage.
- A normalised response envelope — `success`, `message`, `data` and
  `validation_code` — with provider errors and transport failures reported as
  data rather than as thrown errors.
- A payload flag on each accessor, exposing the exact URL and parameters of
  that call with credentials deliberately excluded, so it is safe to surface in
  a consumer's own diagnostics.
- Credentials supplied entirely by the caller: the API key is a required
  constructor argument, sent only as the `X-Api-Key` header. The package ships
  no defaults and reads no environment variables.
- `host` and `basePath` options taking a bare hostname; full URLs are rejected
  so the scheme and path assembly stay inside the client. Any host VRIO issues
  you is passed the same way.
- `timeout` and `connectTimeout` options, defaulting to 30 and 10 seconds.
  Because `fetch` settles when response headers arrive, `connectTimeout` bounds
  that phase and `timeout` bounds the whole exchange including the body read.
- TLS peer and host verification, always on, with no option to disable it.
- Opt-in debug logging that is redacted by default: credentials, tokens, card,
  bank and government identifiers are masked in both headers and bodies.
  Redaction is proven by test not to alter the real request or response.
- Card numbers additionally caught by shape — any 13–19 digit string passing a
  Luhn check is masked wherever it appears.
- `debugRedact: false` escape hatch for verbatim local debugging, documented
  as never-in-production.
- A built-in file sink writing one file per day from a caller-supplied base
  path, with a retention setting (default 7 days, `0` keeps everything).
  Pruning matches only the package's own dated filenames, reads the date from
  the filename rather than the mtime, and runs once per process.
- A `debugSink` option accepting `(entry: string) => void | Promise<void>`,
  which replaces the file sink entirely, as the vendor-neutral extension point
  for any external log destination.
- `HttpClientInterface` transport seam with a `FetchClient` default, so
  requests can be routed through a consumer's own HTTP stack and the test suite
  can run without touching an external network.
- Opt-in `withProxy()` for per-call HTTP proxy routing, implemented over an
  HTTP `CONNECT` tunnel with no dependencies. The default path never touches
  it.
- `VrioError` as the single error type, extending `Error`.
- `API.supportedMethods()` listing every dispatchable resource method.
- Dual ESM and CJS output with type declarations for both, with `instanceof`
  against the built artefacts verified in each format by the gate.
- Documentation: README, integration guide, architecture notes with the
  differences from the PHP client, security policy, and contributor
  conventions.
- ESLint and Prettier style, TypeScript `strict`, and a Vitest suite covering
  every public method and asserting URL, HTTP method, headers and request body,
  running on Node 22 and 24 in CI.

[Unreleased]: https://github.com/astermd/node-vrio-client/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/astermd/node-vrio-client/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/astermd/node-vrio-client/releases/tag/v0.0.1
