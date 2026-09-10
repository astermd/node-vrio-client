import { Config } from './config.js';
import { VrioError } from './exception/vrio-error.js';

/**
 * Signature for a debug-log sink: a function that receives one formatted log
 * entry and may return a promise if writing it is asynchronous.
 *
 * Declared here (rather than in the debug-logging module) because it is a
 * member of {@link ClientOptions}, and this keeps the public option type free
 * of a dependency on that module. `src/logging/debug-logger.ts` re-exports
 * this same type so the package's public export path still reads naturally.
 */
export type DebugSink = (entry: string) => void | Promise<void>;

/**
 * The full set of options a consumer may pass when constructing a client.
 *
 * Every member is optional; an absent, empty, or wrongly-typed value falls
 * back to a sensible default rather than throwing — see {@link ClientConfig}
 * for exactly which fields validate strictly (the API key, the host) versus
 * which coerce leniently (everything else).
 */
export interface ClientOptions {
  /**
   * Bare hostname the client talks to, e.g. `"api.vrio.app"`. Must carry no
   * scheme, path, query string, or embedded space. Omit it, or pass an empty
   * or whitespace-only string, to use {@link ClientConfig.DEFAULT_HOST}. At
   * runtime a number or boolean is also accepted and coerced the way the PHP
   * client's `(string)` cast coerces it, so a value carried over from a PHP
   * config keeps working.
   */
  host?: string;

  /**
   * Optional path prefix appended to the host when building the base URL,
   * e.g. `"v1"`. Surrounding slashes are trimmed, so `"/v1/"` and `"v1"`
   * produce the same URL. At runtime a number or boolean is also accepted
   * and coerced the way the PHP client's `(string)` cast coerces it.
   */
  basePath?: string;

  /**
   * Transfer timeout in seconds. A non-numeric or non-finite value falls
   * back to {@link ClientConfig.DEFAULT_TIMEOUT}. At runtime a numeric
   * string (e.g. `"5"`, `"5.7"`, `"1e3"`, from an environment variable) is
   * also accepted and truncated, the way the PHP client's `is_numeric` gate
   * plus `(int)` cast accepts and truncates it.
   */
  timeout?: number;

  /**
   * Connection timeout in seconds. A non-numeric or non-finite value falls
   * back to {@link ClientConfig.DEFAULT_CONNECT_TIMEOUT}. At runtime a
   * numeric string is also accepted and truncated, matching
   * {@link ClientOptions.timeout}.
   */
  connectTimeout?: number;

  /**
   * Enables request/response debug logging when `true`. Consumed by the
   * debug-logging component landing in a later task.
   */
  debug?: boolean;

  /**
   * When debug logging is enabled, redacts sensitive fields (such as the API
   * key) from logged payloads. Consumed by a later task.
   */
  debugRedact?: boolean;

  /**
   * Base file path debug log entries are written to, when no
   * {@link ClientOptions.debugSink} is supplied. Consumed by a later task.
   */
  debugFile?: string;

  /**
   * Number of days debug log files are retained before rotation deletes
   * them. Consumed by a later task.
   */
  debugRetentionDays?: number;

  /**
   * IANA timezone identifier used to timestamp debug log entries. Consumed
   * by a later task.
   */
  debugTimezone?: string;

  /**
   * Custom sink that receives each formatted debug log entry instead of (or
   * in addition to) writing to {@link ClientOptions.debugFile}. Consumed by
   * a later task.
   */
  debugSink?: DebugSink;
}

/**
 * Immutable connection settings for the VRIO API.
 *
 * The consumer supplies a bare hostname — never a full URL. This keeps the
 * scheme, path assembly, and query encoding under the package's control:
 * accepting a full URL from the caller would let a stray scheme, path, or
 * query string silently change request behaviour in ways this package
 * cannot validate.
 *
 * The API key is read in exactly one place in this whole package: the
 * private {@link ClientConfig.apiKey} field, surfaced only through
 * {@link ClientConfig.getApiKey}. There is no public field, no `toJSON`, and
 * nothing else that would place the key on a serialisation path. Keeping the
 * credential on exactly one path is what makes a leak structurally
 * impossible rather than a bug waiting to reappear.
 *
 * The API key is held in a true JavaScript private field (`#apiKey`), not a
 * TypeScript `private`-modifier field: the latter is erased at compile time
 * and remains an ordinary enumerable property at runtime, which would leak
 * the key through `JSON.stringify`, `Object.keys`, `for...in`, and similar.
 * A `#`-declared field is invisible to all of those, so the key cannot
 * surface by accident even if a future edit forgets it is sensitive.
 */
export class ClientConfig {
  /**
   * Host used when the consumer does not supply one.
   */
  public static readonly DEFAULT_HOST = 'api.vrio.app';

  /**
   * Default transfer timeout in seconds.
   */
  public static readonly DEFAULT_TIMEOUT = 30;

  /**
   * Default connection timeout in seconds.
   */
  public static readonly DEFAULT_CONNECT_TIMEOUT = 10;

  readonly #apiKey: string;

  private readonly host: string;

  private readonly basePath: string;

  private readonly timeout: number;

  private readonly connectTimeout: number;

  /**
   * Builds an immutable configuration from a required API key and an
   * optional bag of settings.
   *
   * @param apiKey VRIO API key. Supplied by the caller; the package ships no
   *               default. Trimmed before the emptiness check, so a
   *               whitespace-only key is rejected the same as an empty one.
   * @param options Optional connection and debug-logging settings. Absent,
   *                empty, or wrongly-typed members fall back to their
   *                defaults rather than throwing — see {@link ClientOptions}.
   * @throws {VrioError} When the API key is empty (or whitespace-only), or
   *                      the resolved host is not a bare hostname.
   */
  public constructor(apiKey: string, options: ClientOptions = {}) {
    if (apiKey.trim() === '') {
      throw new VrioError(Config.get('Messages.invalidAuth'));
    }

    let host = ClientConfig.stringOption(options, 'host', '').trim();
    if (host === '') {
      host = ClientConfig.DEFAULT_HOST;
    }
    ClientConfig.assertBareHost(host);

    this.#apiKey = apiKey;
    this.host = host;
    this.basePath = ClientConfig.stringOption(options, 'basePath', '').replace(/^\/+|\/+$/g, '');
    this.timeout = ClientConfig.intOption(options, 'timeout', ClientConfig.DEFAULT_TIMEOUT);
    this.connectTimeout = ClientConfig.intOption(options, 'connectTimeout', ClientConfig.DEFAULT_CONNECT_TIMEOUT);

    Object.freeze(this);
  }

  /**
   * Reads a scalar option as a string, falling back when it is absent or not
   * scalar. Mirrors the PHP client's `stringOption`, which accepts anything
   * `is_scalar` and applies PHP's `(string)` cast: a number is stringified
   * (`12.5` -> `"12.5"`), and a boolean becomes `"1"` or `""` — not
   * `"true"`/`"false"`. This is the leniency that lets a config value
   * carried over from a PHP caller (or a `process.env` string) keep working
   * unchanged; the option types stay narrow (`string`) precisely because
   * this coercion is a runtime safety net, not a documented input shape.
   *
   * @param options The option bag supplied to the constructor.
   * @param key The option key to read.
   * @param fallback Value returned when the option is absent or not scalar
   *                 (an array, object, or `null`).
   * @returns The option's string value, or `fallback`.
   */
  private static stringOption(options: ClientOptions, key: 'host' | 'basePath', fallback: string): string {
    const value: unknown = options[key];
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
   * Reads a numeric option as an integer, falling back when it is absent or
   * not numeric. Mirrors the PHP client's `intOption`, which gates on
   * `is_numeric` before applying `(int)` — so a numeric string such as
   * `"5"`, `"5.7"`, or `"1e3"` (the shape a `process.env` variable arrives
   * in) is accepted and truncated toward zero, while `""`, whitespace-only
   * strings, booleans, and non-numeric strings fall back. `Number("")` and
   * `Number("  ")` are `0` in JavaScript but `is_numeric` rejects both in
   * PHP, so an empty-or-whitespace string is rejected before conversion
   * rather than relying on `Number()` alone. The option type stays narrow
   * (`number`) precisely because this coercion is a runtime safety net, not
   * a documented input shape.
   *
   * @param options The option bag supplied to the constructor.
   * @param key The option key to read.
   * @param fallback Value returned when the option is absent, not numeric,
   *                 or not finite (this also catches `NaN`).
   * @returns The option's truncated integer value, or `fallback`.
   */
  private static intOption(options: ClientOptions, key: 'timeout' | 'connectTimeout', fallback: number): number {
    const value: unknown = options[key];
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
   * Rejects anything that is not a bare hostname: a scheme, a path, an
   * embedded space, or a query string all indicate the caller passed a full
   * URL rather than a hostname.
   *
   * @param host The candidate host, already trimmed and defaulted.
   * @throws {VrioError} When the host contains `://`, `/`, a space, or `?`.
   */
  private static assertBareHost(host: string): void {
    const looksLikeUrl = host.includes('://') || host.includes('/') || host.includes(' ') || host.includes('?');

    if (looksLikeUrl) {
      throw new VrioError(Config.get('Messages.invalidHost'));
    }
  }

  /**
   * Returns the API key exactly as supplied to the constructor.
   *
   * This is the package's single read path for the credential — see the
   * class-level documentation for why that matters.
   *
   * @returns The configured API key.
   */
  public getApiKey(): string {
    return this.#apiKey;
  }

  /**
   * Returns the resolved bare hostname (the default when none was supplied).
   *
   * @returns The configured host.
   */
  public getHost(): string {
    return this.host;
  }

  /**
   * Builds the absolute base URL with no trailing slash, e.g.
   * `"https://api.vrio.app"` or `"https://api.vrio.app/v1"`. Callers append
   * the resource path themselves.
   *
   * @returns The absolute base URL.
   */
  public getBaseUrl(): string {
    let url = `https://${this.host}`;
    if (this.basePath !== '') {
      url += `/${this.basePath}`;
    }
    return url;
  }

  /**
   * Returns the configured transfer timeout in seconds.
   *
   * @returns The transfer timeout.
   */
  public getTimeout(): number {
    return this.timeout;
  }

  /**
   * Returns the configured connection timeout in seconds.
   *
   * @returns The connection timeout.
   */
  public getConnectTimeout(): number {
    return this.connectTimeout;
  }
}
