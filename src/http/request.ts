/**
 * Immutable description of an outbound HTTP request.
 *
 * Passing this to the transport gives tests a single object to assert URL,
 * method, headers and body against. Because a `Request` is frozen — the
 * instance itself and the header array it carries — the guarantee that a
 * debug logger can never mutate what is actually sent is structural: there is
 * no code path by which a logger, or any other reference to the same
 * instance, could change the request after it was described, rather than
 * that guarantee resting on every caller remembering not to.
 */
export class Request {
  /**
   * All six fields are true `#private` fields, not TypeScript `private` ones.
   * The `private` modifier erases at compile time and leaves an ordinary
   * enumerable own property behind, so `Object.keys(request)`,
   * `JSON.stringify(request)` and `util.inspect(request)` would all walk
   * straight into the API key (via a header line) and the proxy credentials
   * carried in `proxyCredentials`. `Request` is the one object this package
   * hands to consumer code — the documented `HttpClientInterface.send(request)`
   * seam — so a consumer instrumenting their transport with
   * `logger.info({ request })` must not write plaintext secrets into their
   * log store. A `#`-declared field is invisible to all three, which is what
   * makes that structurally impossible rather than a bug waiting to reappear.
   */
  readonly #method: string;
  readonly #url: string;
  readonly #headers: readonly string[];
  readonly #body: string | null;
  readonly #proxyUrl: string | null;
  readonly #proxyCredentials: string | null;

  /**
   * @param method Request method in any case; stored upper-cased.
   * @param url Fully-qualified request URL.
   * @param headers Raw header lines in `"Name: value"` form, order preserved.
   *   Copied and frozen so a caller mutating their own array afterwards
   *   cannot change a request that has already been described.
   * @param body Request body, or `null` for a bodyless request.
   * @param proxyUrl Proxy host, or `null`/empty string for no proxy.
   * @param proxyCredentials Proxy credentials, or `null` when none apply.
   */
  public constructor(
    method: string,
    url: string,
    headers: readonly string[] = [],
    body: string | null = null,
    proxyUrl: string | null = null,
    proxyCredentials: string | null = null,
  ) {
    this.#method = method.toUpperCase();
    this.#url = url;
    this.#headers = Object.freeze([...headers]);
    this.#body = body;
    this.#proxyUrl = proxyUrl;
    this.#proxyCredentials = proxyCredentials;
    Object.freeze(this);
  }

  /**
   * @returns The request method, upper-cased.
   */
  public getMethod(): string {
    return this.#method;
  }

  /**
   * @returns The fully-qualified request URL.
   */
  public getUrl(): string {
    return this.#url;
  }

  /**
   * @returns The raw header lines, in the order they were given.
   */
  public getHeaders(): readonly string[] {
    return this.#headers;
  }

  /**
   * @returns The request body, or `null` if there is none.
   */
  public getBody(): string | null {
    return this.#body;
  }

  /**
   * @returns The proxy host, or `null` if there is none.
   */
  public getProxyUrl(): string | null {
    return this.#proxyUrl;
  }

  /**
   * @returns The proxy credentials, or `null` if there are none.
   */
  public getProxyCredentials(): string | null {
    return this.#proxyCredentials;
  }

  /**
   * Whether this request should be routed through a proxy.
   *
   * An empty proxy URL does not count as a proxy, matching how the setting
   * would arrive from an unset environment variable or config value.
   *
   * @returns `true` when a non-empty proxy URL is set.
   */
  public hasProxy(): boolean {
    return this.#proxyUrl !== null && this.#proxyUrl !== '';
  }
}
