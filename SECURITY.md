# Security Policy

## Reporting a vulnerability

Please report security issues privately. **Do not open a public GitHub issue.**

Email **info@astermd.com** with:

- a description of the issue and the impact you believe it has,
- the package version and Node.js version affected,
- steps to reproduce, ideally a minimal snippet.

We aim to acknowledge a report within 5 business days and to agree a
disclosure timeline with you before any public write-up.

You may also use GitHub's private vulnerability reporting on
<https://github.com/astermd/vrio-client/security/advisories/new>.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.0.x   | Yes       |

This package is pre-1.0. Security fixes are released against the latest
published version only; there are no maintained older branches. Pin with
`^0.0.1` and expect breaking changes between patch releases until 1.0.

## Handling credentials

This package ships **no** credentials, no defaults and no environment lookups.
Your API key is a required argument you pass at construction:

```ts
const api = new API(apiKey, { host: 'api.vrio.app' });
```

Guidance for integrators:

- Keep the key in your secret store or environment, never in version control.
- The package is server-side only. Never import it into browser code or into
  any bundle shipped to a browser.
- Never pass the key in a URL — this client sends it as the `X-Api-Key`
  request header only, and never places it in a request body or query string.
- The `payload` key returned when you pass `true` to an accessor deliberately
  excludes credentials, so it is safe to surface in your own diagnostics.
- Rotate the key immediately if it is ever committed, logged verbatim, pasted
  into a ticket, or shared outside your team. Removing a secret from a file
  does not un-expose it.

## Handling sensitive data in logs

Debug logging is off by default. When you turn it on:

- Entries are **redacted by default**. Credentials, tokens, card, bank and
  government identifiers are masked in headers and bodies.
- The **request URL is written verbatim**, so identifiers that appear in a path
  or query string are recorded as-is. See the README for the affected calls.
- `debugRedact: false` disables masking entirely. It exists for local
  debugging. Never enable it in production.
- **Redacted logs are still sensitive.** They record which account touched
  which order, cart, customer and route, and when. Store them on encrypted
  volumes, restrict read access, ship them only to systems cleared for that
  data, and apply a retention period at least as strict as the rest of your
  order data.
- The built-in file sink prunes its own dated files after 7 days by default.
  If you supply your own sink function, retention becomes entirely your
  responsibility.

## Compliance

Using this package does not by itself make your application PCI DSS, HIPAA or
GDPR compliant. It is one component in your system. Scoping, encryption at
rest, access control, audit logging, breach procedures and your agreements
with VRIO and your processors remain your responsibility. For licensing or BAA
enquiries, email **info@astermd.com**.
