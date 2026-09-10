import type { ClientOptions, DebugSink } from '../client-config.js';
import { Config } from '../config.js';
import { VrioError } from '../exception/vrio-error.js';
import { Request } from '../http/request.js';
import { Response } from '../http/response.js';
import { assertTimezone } from './file-sink.js';
import { FileSink } from './file-sink.js';
import { Redactor } from './redactor.js';

/**
 * Re-exported so a consumer of this module does not also need to import
 * from `client-config.js` just to name the sink type. Declared once, in
 * `client-config.ts`, because it is also a member of {@link ClientOptions}
 * and that module must not depend on this one; see the comment there.
 */
export type { DebugSink } from '../client-config.js';

/**
 * PHP's boolean cast, `(bool) $value`, and PHP's `empty()` share exactly the
 * same falsy set for a value that is already known to exist: `null`,
 * `false`, the integers/floats `0` and `-0`, the strings `""` and `"0"`, and
 * an empty array. Everything else — including the non-empty string
 * `"false"` — is truthy.
 *
 * This matters because a naive `!!value` in JavaScript disagrees with PHP on
 * exactly one input that operators actually pass: the string `"0"`.
 * `Boolean("0")` is `true` in JavaScript, but PHP's `!empty("0")` is
 * `false`. A caller who sets `debug: process.env.DEBUG` with `DEBUG=0`,
 * meaning "off", would have debug logging silently turned ON — writing
 * request bodies and headers to disk — if this port used `!!value` instead
 * of this function. `debug` and `debugRedact` both key off this exact
 * falsy set, so one helper serves both.
 *
 * @param value The raw option value, prior to any `isset`-style presence
 *   check (this function has no opinion on `undefined`; it treats it as
 *   equivalent to `null`, i.e. falsy).
 * @returns PHP's boolean-cast truthiness of `value`.
 */
function phpBooleanCast(value: unknown): boolean {
  if (value === null || value === undefined || value === false) {
    return false;
  }
  if (typeof value === 'number' && value === 0) {
    // Covers 0, -0 and 0.0: JavaScript's `===` treats 0 and -0 as equal.
    return false;
  }
  if (typeof value === 'string' && (value === '' || value === '0')) {
    return false;
  }
  if (Array.isArray(value) && value.length === 0) {
    return false;
  }
  return true;
}

/**
 * PHP's `isset()`, restricted to a single already-fetched value: true unless
 * the value is `undefined` or `null`. PHP's `isset($options['key'])` is
 * false both when the key is absent (JavaScript's `undefined`) and when its
 * value is `null`, so both are treated the same way here.
 */
function issetOption(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Read a scalar option as a string, falling back when it is absent or not
 * scalar. Mirrors {@link ClientConfig}'s private `stringOption` exactly (a
 * number is stringified, a boolean becomes `"1"` or `""`), duplicated here
 * because that method is private to `ClientConfig` and this module must not
 * reach into it. The two halves of the option bag apply the same leniency
 * so they never disagree about what a given raw value means.
 */
function scalarStringOption(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '';
  }
  return fallback;
}

/**
 * Read a numeric option as an integer, falling back when it is absent or
 * not numeric. Mirrors {@link ClientConfig}'s private `intOption` exactly,
 * including that a boolean is never numeric (`is_numeric(bool)` is `false`
 * in PHP), so `debugRetentionDays: true` falls back rather than becoming
 * `1`.
 */
function numericIntOption(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return fallback;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  }
  return fallback;
}

/**
 * Opt-in request/response logging, redacted by default.
 *
 * Each entry is a copy-pasteable cURL command plus the response it
 * produced. The logger only ever reads from the immutable {@link Request}
 * and {@link Response} value objects and turns them into a string; it holds
 * no reference that could change either one, so enabling logging cannot
 * alter what is sent on the wire or what the caller receives.
 *
 * The URL is logged verbatim by design: an entry that hid the real URL
 * would not be reproducible, and this package only ever accepts a bare
 * hostname from the caller (see {@link ClientConfig}), so a query string or
 * path segment is the only place a resource identifier can appear. See the
 * README for which calls therefore record identifiers there.
 *
 * Logging is off unless `debug` is truthy (by PHP's rules — see
 * {@link phpBooleanCast}). When on, headers and bodies are redacted unless
 * `debugRedact` is explicitly falsy.
 */
export class DebugLogger {
  private readonly enabled: boolean;
  private readonly redact: boolean;
  private readonly sink: DebugSink | null;
  private readonly timezone: string;
  private readonly redactor = new Redactor();

  /**
   * Promise chain writes are serialized through. Concurrent `log()` calls
   * append their sink call to this chain rather than firing in parallel, so
   * two in-flight writes can never interleave into a corrupted line, and
   * entries land in call order even when an earlier sink call is slower
   * than a later one.
   */
  private chain: Promise<void> = Promise.resolve();

  /**
   * @param enabled Master switch.
   * @param redact Whether headers and bodies are masked before logging.
   *   Defaults to `true`.
   * @param sink Receives each formatted entry. `null` disables writing
   *   (equivalent to being permanently idle) even if `enabled` is `true`.
   * @param timezone IANA timezone used to timestamp entries. Defaults to
   *   `"UTC"`.
   * @throws {VrioError} When `timezone` is not a recognised IANA
   *   identifier. Checked unconditionally, even when `enabled` is `false`,
   *   because the PHP client's constructor always resolves the timezone
   *   first and this is a faithful port of that constructor.
   */
  public constructor(enabled: boolean, redact = true, sink: DebugSink | null = null, timezone = 'UTC') {
    assertTimezone(timezone);

    this.enabled = enabled;
    this.redact = redact;
    this.sink = sink;
    this.timezone = timezone;
  }

  /**
   * Build a logger from the client option bag.
   *
   * Recognised options:
   *  - `debug` (boolean-ish): master switch. Default off.
   *  - `debugRedact` (boolean-ish): default on. Explicitly falsy logs
   *    verbatim.
   *  - `debugSink` (function): replaces the built-in file sink entirely.
   *  - `debugFile` (string-ish): base path for the built-in dated file
   *    sink. Required when `debug` is on and no `debugSink` is given.
   *  - `debugRetentionDays` (number-ish): days of history the file sink
   *    keeps. Falls back to {@link FileSink.DEFAULT_RETENTION_DAYS} when
   *    absent or not numeric.
   *  - `debugTimezone` (string-ish): IANA timezone for entry timestamps.
   *    Defaults to `"UTC"`.
   *
   * @param options The full client option bag (not just the debug-related
   *   members), matching the PHP client's `fromOptions(array $options)`.
   * @returns A configured logger. Disabled and requires nothing further
   *   when `debug` is falsy.
   * @throws {VrioError} When `debug` is on and: `debugSink` is present but
   *   not callable; or no `debugSink` is given and `debugFile` is absent or
   *   blank; or the resolved timezone is not a recognised IANA identifier.
   */
  public static fromOptions(options: ClientOptions): DebugLogger {
    const enabled = phpBooleanCast(options.debug);
    const redact = !issetOption(options.debugRedact) || phpBooleanCast(options.debugRedact);
    const timezone = scalarStringOption(options.debugTimezone, 'UTC');

    if (!enabled) {
      return new DebugLogger(false, redact, null, timezone);
    }

    if (issetOption(options.debugSink)) {
      if (typeof options.debugSink !== 'function') {
        throw new VrioError(Config.get('Messages.invalidDebugSink'));
      }

      return new DebugLogger(true, redact, options.debugSink, timezone);
    }

    const file = scalarStringOption(options.debugFile, '');
    if (file.trim() === '') {
      throw new VrioError(Config.get('Messages.debugFileRequired'));
    }

    const retention = numericIntOption(options.debugRetentionDays, FileSink.DEFAULT_RETENTION_DAYS);

    return new DebugLogger(true, redact, new FileSink(file, retention, timezone).asSink(), timezone);
  }

  /**
   * @returns Whether logging is switched on.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * @returns Whether headers and bodies are masked before logging.
   */
  public isRedacting(): boolean {
    return this.redact;
  }

  /**
   * Record one exchange.
   *
   * Never rejects: a logging failure must not break the API call that
   * triggered it. The entry is formatted synchronously, before any await,
   * so a queued write reflects the exchange it was called with rather than
   * whatever the chain happens to be processing by the time it runs — but
   * that formatting step is guarded too, not just the sink call: `format()`
   * cannot throw today (its only failure-prone step, JSON parsing, is
   * guarded inside {@link Redactor}), but that is an invariant of a
   * different class, not one this method should assume will always hold.
   * Writes are chained rather than fired in parallel, because concurrent
   * appends could otherwise interleave and corrupt a line; returning the
   * chain lets a caller `await logger.log(...)` for its own entry to land,
   * matching the PHP client's synchronous write so nothing is lost if the
   * process exits immediately afterwards.
   *
   * @param request The request that was sent.
   * @param response The response it produced (or the transport failure).
   * @returns A promise that resolves once this entry's write has been
   *   attempted, win or lose. Never rejects.
   */
  public log(request: Request, response: Response): Promise<void> {
    if (!this.enabled || this.sink === null) {
      return Promise.resolve();
    }

    const sink = this.sink;

    // Formatted synchronously so a queued entry describes its own exchange
    // rather than a later one — and guarded, because log() must never throw.
    let entry: string;
    try {
      entry = this.format(request, response);
    } catch {
      // Intentionally swallowed: logging must never break the caller.
      return Promise.resolve();
    }

    this.chain = this.chain.then(async () => {
      try {
        await sink(entry);
      } catch {
        // Intentionally swallowed: logging must never break the caller,
        // whether the sink throws synchronously or returns a rejected
        // promise.
      }
    });

    return this.chain;
  }

  /**
   * Wait for every write handed to {@link DebugLogger.log} so far to
   * finish.
   *
   * @returns The current tail of the serialized write chain.
   */
  public flush(): Promise<void> {
    return this.chain;
  }

  /**
   * Render one entry without writing it anywhere.
   *
   * Reads only through `request.get*()` and `response.get*()` accessors —
   * never anything that could hand back a mutable reference — and passes
   * the results through {@link Redactor}, which itself only ever returns
   * new values. Nothing reachable from this method can alter the `Request`
   * or `Response` it was given.
   *
   * @param request The request that was sent.
   * @param response The response it produced (or the transport failure).
   * @returns The formatted log entry: a timestamp line, a copy-pasteable
   *   `curl` command, a blank line, then either the response body or a
   *   transport error line.
   */
  public format(request: Request, response: Response): string {
    const headers = this.redact ? this.redactor.redactHeaders(request.getHeaders()) : request.getHeaders();

    const body = this.redact ? this.redactor.redactBody(request.getBody()) : request.getBody();

    const responseBody = this.redact ? this.redactor.redactBody(response.getBody()) : response.getBody();

    // The URL is logged verbatim by design; see the class-level doc comment.
    const lines: string[] = [`curl --location --request ${request.getMethod()} '${request.getUrl()}' \\`];

    const lastIndex = headers.length - 1;
    headers.forEach((headerLine, index) => {
      const continues = body !== null || index !== lastIndex;
      lines.push(`  --header '${headerLine}'${continues ? ' \\' : ''}`);
    });

    if (body !== null) {
      lines.push(`  --data '${body.replace(/'/g, "'\\''")}'`);
    }

    const entry = `[${this.timestamp(new Date())}]\n${lines.join('\n')}\n\n`;

    if (response.hasTransportError()) {
      return `${entry}# Transport error: ${response.getTransportError()}\n\n`;
    }

    return `${entry}# Response: HTTP ${String(response.getStatusCode())}\n${String(responseBody)}\n\n`;
  }

  /**
   * Render an instant the way the PHP client does: `Y-m-d H:i:s.u T`.
   *
   * Deliberate divergence from the PHP (documented, not a bug to fix): PHP
   * reads real microseconds off `microtime(true)`. JavaScript's `Date` has
   * millisecond resolution only, so the microsecond field here is the
   * millisecond value padded with three trailing zeros — the format and its
   * six-digit width are unchanged, which keeps log lines from the two
   * packages diffable even though the sub-millisecond digits are always
   * zero on this side.
   */
  private timestamp(now: Date): string {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).formatToParts(now);

    const find = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';

    const micros = `${String(now.getMilliseconds()).padStart(3, '0')}000`;
    const zone = find('timeZoneName');

    return `${find('year')}-${find('month')}-${find('day')} ${find('hour')}:${find('minute')}:${find('second')}.${micros} ${zone}`;
  }
}
