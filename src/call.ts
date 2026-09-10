import type { ClientConfig } from './client-config.js';
import { Config } from './config.js';
import { VrioError } from './exception/vrio-error.js';
import type { HttpClientInterface, HttpMethod } from './http/http-client.js';
import { Request } from './http/request.js';
import type { DebugLogger } from './logging/debug-logger.js';
import { buildQuery } from './support/query-string.js';

/**
 * Frozen description of exactly one HTTP request, produced by a resource
 * method and executed by a {@link Call}.
 *
 * A descriptor is a value, not state. The PHP client this package mirrors
 * stored the section and fields on the resource instance and cleared them
 * afterwards with a `reset()`; that is safe only because PHP runs one request
 * per process. Node does not, and `API` shares one instance of each resource
 * for the client's lifetime, so two overlapping calls on the same resource
 * would overwrite each other's section and body. Handing back an immutable
 * descriptor makes that race impossible rather than merely unlikely, and it
 * is why this port has no `reset()` at all.
 */
export interface RequestSpec {
  /** HTTP method to issue. */
  readonly httpMethod: HttpMethod;

  /**
   * Path below the base URL, e.g. `"orders/ord_1/capture"`. Leading slashes
   * and embedded spaces are removed when the URL is assembled.
   */
  readonly section: string;

  /** Body fields, JSON-encoded for a `POST`, `PATCH` or `PUT`. */
  readonly fields: Record<string, unknown>;

  /** Query string parameters, appended for a `GET`. */
  readonly query: Record<string, unknown>;

  /** Whether the caller asked for transport metadata alongside the body. */
  readonly headerRequired: boolean;
}

/**
 * The package's normalized response envelope.
 *
 * Every provider body is wrapped in this shape, whatever the HTTP status was:
 * a provider-reported error is data to be inspected, not an exception to be
 * caught. Key order is part of the contract, because {@link Call.get} returns
 * this object's JSON encoding as a string and the PHP client builds it in
 * exactly this order.
 */
export interface Envelope {
  /** `false` only when the decoded body carried a non-null `error` node. */
  success: boolean;

  /**
   * The provider's `error.message` when it was a scalar, otherwise an empty
   * string. A non-string scalar is stringified the way PHP's `(string)` cast
   * stringifies it, so a boolean `true` becomes `"1"` and `false` becomes
   * `""`.
   */
  message: string;

  /** The parsed provider body, or `null` when the body was not valid JSON. */
  data: unknown;

  /**
   * The provider's `error.code`, present only when the provider reported an
   * error. An error carrying no code (or a null one) yields an empty string;
   * a non-string code is passed through as it arrived.
   */
  validation_code?: unknown;
}

/**
 * Returned in place of an envelope when the request never reached the
 * provider.
 *
 * `curlError` is a compatibility name, kept verbatim from the PHP client even
 * though this port issues no cURL calls, so a consumer's existing error
 * branch transfers between the two packages unchanged.
 */
export interface TransportFailure {
  /** The transport's own description of why the transfer failed. */
  curlError: string;
}

/**
 * Shape produced when `headerRequired` is set on the resource: the envelope
 * alongside the transport metadata that accompanied it.
 */
export interface WithHeader<T> {
  /** The envelope, in whichever form the accessor returns it. */
  content: T;

  /** Transport metadata for the exchange, e.g. status code and timing. */
  header: Record<string, unknown>;
}

/**
 * The URL and parameters of one call.
 *
 * Credentials are deliberately absent. The API key travels in a request
 * header and is read in exactly one place in this package, so this value is
 * safe to log or hand to an end user.
 */
export interface PayloadInfo {
  /** The fully-assembled request URL, query string included. */
  endPoint: string;

  /** The call's query parameters and body fields, merged. */
  [key: string]: unknown;
}

/** What {@link Call.get} resolves to. */
export interface StringResult {
  /**
   * The envelope as a JSON string, the bare transport error message when the
   * transfer failed, or a `{ content, header }` wrapper under
   * `headerRequired`.
   */
  response: string | WithHeader<string>;

  /** Present only when the accessor was called with its payload flag set. */
  payload?: PayloadInfo;
}

/** What {@link Call.getInObject} and {@link Call.getInArray} resolve to. */
export interface ObjectResult {
  /**
   * The decoded envelope, a {@link TransportFailure} when the transfer never
   * reached the provider, or a `{ content, header }` wrapper under
   * `headerRequired`.
   */
  response: Envelope | TransportFailure | WithHeader<Envelope>;

  /** Present only when the accessor was called with its payload flag set. */
  payload?: PayloadInfo;
}

/**
 * Narrow an {@link ObjectResult}'s `response` to a {@link TransportFailure}.
 *
 * A transport failure means the request never reached the provider at all —
 * a DNS failure, a timeout, a TLS problem — which is why there is no
 * {@link Envelope} to inspect: the provider never got a chance to answer.
 * `response.success` and `response.data` do not exist on this shape, so
 * `--strict` TypeScript refuses to let a consumer read them without narrowing
 * first. This guard is the narrowing step; a returned `true` means the only
 * usable field is `curlError`, the transport's own description of what went
 * wrong.
 *
 * @param response The `response` field of an {@link ObjectResult} or
 *   {@link StringResult}-shaped read.
 * @returns `true` when the call never reached the provider.
 */
export function isTransportFailure(
  response: Envelope | TransportFailure | WithHeader<Envelope>,
): response is TransportFailure {
  return 'curlError' in response;
}

/**
 * Narrow an {@link ObjectResult}'s `response` to a plain {@link Envelope}.
 *
 * Use this when `headerRequired` is not set on the call, so the response is
 * either the envelope itself or a {@link TransportFailure} -- never the
 * `{ content, header }` wrapper. Combine with {@link isTransportFailure} (or
 * simply check this guard first) to read `success`, `message`, `data` and
 * `validation_code` under `--strict` without TypeScript rejecting the access
 * because one branch of the union lacks that property.
 *
 * @param response The `response` field of an {@link ObjectResult} or
 *   {@link StringResult}-shaped read.
 * @returns `true` when `response` is the decoded envelope itself, rather than
 *   a {@link TransportFailure} or a `{ content, header }` wrapper.
 */
export function isEnvelope(response: Envelope | TransportFailure | WithHeader<Envelope>): response is Envelope {
  return !('curlError' in response) && !('content' in response);
}

/**
 * PHP's `isset()`, narrowed to a single already-fetched value: false both
 * when a key is absent (JavaScript's `undefined`) and when its value is
 * `null`.
 *
 * This distinction is load-bearing twice over in the envelope. A body of
 * `{"error":null}` is a **success**, because `isset($body['error'])` is false
 * for a null value; and an error node of `{"code":null}` yields an empty
 * `validation_code` rather than a null one. Both were measured against the
 * running PHP client.
 */
function isset(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Apply PHP's `(string)` cast to a scalar.
 *
 * PHP writes `true` as `"1"` and `false` as `""` — not `"true"`/`"false"`,
 * which is what JavaScript's `String()` would produce. This is deliberately
 * *not* the same conversion `buildQuery` applies, where PHP's
 * `http_build_query()` writes `false` as `"0"` instead.
 *
 * @param value A scalar drawn from a decoded JSON body.
 * @returns The value as PHP's string cast would spell it, or an empty string
 *   when the value is not a scalar (PHP's `is_scalar` gate).
 */
function phpStringCast(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '';
  }
  return '';
}

/**
 * Read a value as a plain record, or `null` when it is not one.
 *
 * Mirrors PHP's `is_array($error)` guard on a body decoded with
 * `json_decode($body, true)`. A JSON array decodes to a PHP array too, but
 * `isset($array['message'])` is false for it, so excluding arrays here
 * reproduces the same outcome.
 */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * One executable API call: a {@link RequestSpec} plus everything needed to
 * send it and read the answer back.
 *
 * A `Call` sends nothing until it is read. The first accessor triggers the
 * request; every later read — a second accessor, the same accessor twice, or
 * several read concurrently — shares that one in-flight promise, so a `Call`
 * executes **at most once**. A fresh {@link Request} is materialized from the
 * descriptor at that point rather than a stored one being replayed.
 *
 * It is also thenable, resolving to exactly what {@link Call.getInObject}
 * returns, so `await api.addOrder({ ... })` fires the request even with no
 * accessor named — as the PHP client's dispatch always did. `then` never
 * resolves to the `Call` itself; a thenable that resolves to itself is a
 * recursion hazard.
 *
 * Credentials travel in the request headers only. The API key is read in one
 * place — {@link Call.buildHeaders} — and reaches neither the request body,
 * the query string, nor {@link PayloadInfo}.
 */
export class Call implements PromiseLike<ObjectResult> {
  /**
   * The three collaborators are held in true private fields, not TypeScript
   * `private` ones. The `private` modifier erases at compile time and leaves
   * an ordinary enumerable property, so `JSON.stringify(call)` would walk
   * straight into all three — and every one of them can reach a credential:
   * `ClientConfig` holds the API key, a transport may retain the requests it
   * sent (whose headers carry the key), and a logger holds the sink those
   * entries are written through. A `#`-declared field is invisible to
   * `JSON.stringify`, `Object.keys` and `for...in`, so none of that is
   * reachable by accident. `ClientConfig`'s own `#apiKey` is the second line
   * of defence, not the only one.
   */
  readonly #config: ClientConfig;

  readonly #http: HttpClientInterface;

  readonly #logger: DebugLogger;

  /**
   * The queued proxy. Private fields for the same reason as the three
   * collaborators above, and for a more direct one: `proxyCredentials` is
   * documented as `"user:password"`, so it *is* a plaintext credential rather
   * than merely a route to one. Under the erased `private` modifier it was an
   * enumerable own property, and `JSON.stringify(call)` printed it in full.
   */
  readonly #proxyUrl: string | null;

  readonly #proxyCredentials: string | null;

  private readonly spec: RequestSpec;

  /** The single in-flight (or settled) execution, or `null` before first read. */
  private inFlight: Promise<void> | null = null;

  /**
   * The normalized envelope as a JSON string, or the transport error message
   * when the transfer failed.
   *
   * Stored as a string, exactly as the PHP client stores it, with the
   * accessors parsing it back. Keeping the object instead would be marginally
   * faster but would make the decode guard's message unreachable and would
   * stop the envelope being comparable byte-for-byte with the PHP client's.
   */
  private envelope = '';

  private transportInfo: Record<string, unknown> = {};
  private failed = false;
  private lastUrl = '';

  /**
   * @param spec The frozen descriptor to execute.
   * @param config Connection settings; the only source of the host and key.
   * @param http Transport the request is handed to.
   * @param logger Debug logger the exchange is recorded through.
   * @param proxyUrl Proxy queued for this call, or `null` for none.
   * @param proxyCredentials Proxy credentials, or `null` when none apply.
   */
  public constructor(
    spec: RequestSpec,
    config: ClientConfig,
    http: HttpClientInterface,
    logger: DebugLogger,
    proxyUrl: string | null = null,
    proxyCredentials: string | null = null,
  ) {
    this.spec = spec;
    this.#config = config;
    this.#http = http;
    this.#logger = logger;
    this.#proxyUrl = proxyUrl;
    this.#proxyCredentials = proxyCredentials;
  }

  /**
   * The raw response envelope from this call, as a JSON string.
   *
   * Under `headerRequired` the envelope arrives wrapped as
   * `{ content, header }` — but not when the transfer failed, matching the
   * PHP client, which checks its error flag before wrapping.
   *
   * @param payloadFlag Include the request URL and parameters alongside the
   *   response.
   * @returns The envelope string, or the bare transport error message. A
   *   transport failure is never thrown; it arrives as this text.
   */
  public async get(payloadFlag = false): Promise<StringResult> {
    await this.execute();

    const response: string | WithHeader<string> =
      this.spec.headerRequired && !this.failed ? { content: this.envelope, header: this.transportInfo } : this.envelope;

    return payloadFlag ? { response, payload: this.getPayloadInfo() } : { response };
  }

  /**
   * The response envelope from this call, decoded.
   *
   * @param payloadFlag Include the request URL and parameters alongside the
   *   response.
   * @returns The decoded envelope, or `{ curlError }` when the transfer never
   *   reached the provider.
   * @throws {VrioError} When the stored envelope is not valid JSON.
   */
  public async getInObject(payloadFlag = false): Promise<ObjectResult> {
    await this.execute();

    if (this.failed) {
      const failure: TransportFailure = { curlError: this.envelope };
      return payloadFlag ? { response: failure, payload: this.getPayloadInfo() } : { response: failure };
    }

    const decoded = this.decodeEnvelope();
    const response: Envelope | WithHeader<Envelope> = this.spec.headerRequired
      ? { content: decoded, header: this.transportInfo }
      : decoded;

    return payloadFlag ? { response, payload: this.getPayloadInfo() } : { response };
  }

  /**
   * Alias of {@link Call.getInObject}.
   *
   * The PHP client this package mirrors distinguishes an associative array
   * from an object and offers a separate accessor for each. A decoded JSON
   * object is simply an object in Node, so both names return the same value.
   * The name is kept so PHP examples and support answers transfer verbatim.
   *
   * @param payloadFlag Include the request URL and parameters alongside the
   *   response.
   * @returns Exactly what {@link Call.getInObject} returns.
   */
  public getInArray(payloadFlag = false): Promise<ObjectResult> {
    return this.getInObject(payloadFlag);
  }

  /**
   * Make the call awaitable on its own, so a resource method whose result is
   * awaited without naming an accessor still sends its request.
   *
   * @param onfulfilled Called with what {@link Call.getInObject} resolves to.
   * @param onrejected Called if execution or decoding failed.
   * @returns A promise for the handler's result. Never the `Call` itself.
   */
  public then<T1 = ObjectResult, T2 = never>(
    onfulfilled?: ((value: ObjectResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.getInObject().then(onfulfilled, onrejected);
  }

  /**
   * Send the request if it has not been sent, exactly once.
   *
   * Reading two accessors, or reading one twice, must not issue two requests.
   * Caching the in-flight promise also de-duplicates concurrent reads: the
   * second reader awaits the first reader's transfer rather than starting its
   * own.
   */
  private execute(): Promise<void> {
    this.inFlight ??= this.run();
    return this.inFlight;
  }

  private async run(): Promise<void> {
    const url = this.buildUrl();
    this.lastUrl = url;

    // A fresh Request built from the descriptor, never a stored one replayed:
    // a Request describes one attempt and is frozen for exactly that reason.
    const request = new Request(
      this.spec.httpMethod,
      url,
      this.buildHeaders(),
      this.bodyFor(this.spec.httpMethod),
      this.#proxyUrl,
      this.#proxyCredentials,
    );

    const response = await this.#http.send(request);

    // Task 8 guarantees log() never rejects, but that is an invariant of a
    // different class. Guarded here too, because a logging failure must never
    // discard a response whose request actually succeeded. Still awaited, so
    // entry ordering and the flush guarantee are unchanged.
    try {
      await this.#logger.log(request, response);
    } catch {
      // Intentionally swallowed; see above.
    }

    this.transportInfo = response.getInfo();

    if (response.hasTransportError()) {
      this.failed = true;
      this.envelope = response.getTransportError();
      return;
    }

    this.failed = false;
    this.envelope = this.buildEnvelope(response.getBody());
  }

  /**
   * Assemble the absolute request URL.
   *
   * Ports the PHP client's `setApiUrl()` and the URL half of its `sendGet()`:
   * spaces are stripped from the section, leading slashes trimmed, and for a
   * `GET` a trailing slash is trimmed before the query string is appended.
   */
  private buildUrl(): string {
    // Order matters, and it is the PHP's order: `str_replace(' ', '',
    // ltrim($section, '/'))` trims leading slashes FIRST, and `ltrim` removes
    // only "/", never a space. So a section of " /orders" keeps its slash and
    // the URL carries a double slash. Doing it the other way round would
    // quietly produce a different URL than the PHP client for that shape.
    const path = this.spec.section.replace(/^\/+/, '').replaceAll(' ', '');
    let url = `${this.#config.getBaseUrl()}/${path}`;

    if (this.spec.httpMethod === 'GET') {
      url = url.replace(/\/+$/, '');

      // Faithful to the PHP client: the presence of parameters decides,
      // not whether they encode to anything. A query of `{ a: null }`
      // therefore leaves a bare "?" on the URL, as measured.
      if (Object.keys(this.spec.query).length > 0) {
        url += `?${buildQuery(this.spec.query)}`;
      }
    }

    return url;
  }

  /**
   * The three request headers, in the order the PHP client sends them.
   *
   * This is the only place in this class that reads the API key, and the
   * only path by which the credential leaves {@link ClientConfig}.
   */
  private buildHeaders(): string[] {
    return [
      'Content-Type: application/json',
      `hostname: ${this.#config.getHost()}`,
      `X-Api-Key: ${this.#config.getApiKey()}`,
    ];
  }

  /** `GET` and `DELETE` are sent bodyless, as in the PHP client. */
  private bodyFor(httpMethod: HttpMethod): string | null {
    if (httpMethod === 'GET' || httpMethod === 'DELETE') {
      return null;
    }
    return this.encodeFields();
  }

  /**
   * Encode the request body, keeping an empty payload a JSON object rather
   * than an array — the PHP client encodes `new stdClass()` for the same
   * reason, since `json_encode([])` would send `[]`.
   */
  private encodeFields(): string {
    try {
      return JSON.stringify(this.spec.fields);
    } catch {
      // A field value that cannot be encoded (a BigInt, a circular
      // reference) falls back to an empty object, as the PHP client falls
      // back on json_encode() returning false.
      return '{}';
    }
  }

  /**
   * Wrap the provider's body in the package's success/message/data envelope.
   *
   * Ported from the PHP client's `buildEnvelope()`, including two behaviours
   * that read like bugs and are not: a null `error` node is a success (PHP's
   * `isset()` is false for null), and a body that is not JSON at all yields
   * `data: null` with `success: true`.
   *
   * @param body The provider's raw response body.
   * @returns The envelope's JSON encoding, or the PHP client's verbatim
   *   fallback string if it could not be encoded.
   */
  private buildEnvelope(body: string): string {
    const parsed = Call.tryParse(body);

    const asObject = asRecord(parsed);
    const errorNode = asObject === null ? undefined : asObject['error'];
    const hasError = isset(errorNode);

    const errorRecord = hasError ? asRecord(errorNode) : null;
    const message = phpStringCast(errorRecord?.['message']);

    // Key order matters: get() returns this object's JSON encoding, and the
    // PHP client builds the envelope in exactly this order.
    const envelope: Envelope = { success: !hasError, message, data: parsed };

    if (hasError) {
      const code = errorRecord?.['code'];
      envelope.validation_code = isset(code) ? code : '';
    }

    try {
      return JSON.stringify(envelope);
    } catch {
      // Verbatim from the PHP client's json_encode() === false branch.
      return '{"success":false,"message":"","data":null}';
    }
  }

  /**
   * Decode the stored envelope string.
   *
   * The guard is unreachable from this class today, since the envelope is
   * always produced by `JSON.stringify`. It stays because the alternative is
   * a silent `undefined` should that ever stop being true.
   *
   * @throws {VrioError} When the stored envelope is not valid JSON.
   */
  private decodeEnvelope(): Envelope {
    try {
      return JSON.parse(this.envelope) as Envelope;
    } catch {
      throw new VrioError(Config.get('Messages.jsonFormatError'));
    }
  }

  /**
   * The URL and parameters used by this call.
   *
   * `endPoint` comes first, then the query parameters, then the body fields,
   * so a field wins a key collision — the order the PHP client's
   * `array_merge` produces. Credentials are absent by construction: the API
   * key is only ever read into a header.
   */
  private getPayloadInfo(): PayloadInfo {
    return { endPoint: this.lastUrl, ...this.spec.query, ...this.spec.fields };
  }

  /** Parse a body, returning `null` when it is not JSON — as `json_decode` does. */
  private static tryParse(body: string): unknown {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return null;
    }
  }
}
