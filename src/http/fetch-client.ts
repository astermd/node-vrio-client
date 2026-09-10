import type { HttpClientInterface } from './http-client.js';
import { tunnelRequest } from './proxy-tunnel.js';
import type { Request } from './request.js';
import { Response } from './response.js';

/**
 * Default transport, backed by global `fetch`.
 *
 * TLS peer and host verification are always on. The package deliberately
 * exposes no switch to disable them: this client carries API credentials and
 * order data, and an unverified connection would make both interceptable.
 *
 * Every failure — a bad URL, a refused connection, a timeout — comes back as
 * a transport error on the returned {@link Response} rather than as a thrown
 * error, so the debug logger can record the attempt before the caller
 * decides what to do about it. {@link send} never rejects and never throws.
 *
 * Redirects are followed, matching the PHP transport's
 * `CURLOPT_FOLLOWLOCATION`. The PHP caps redirects at 10 via
 * `CURLOPT_MAXREDIRS`; `fetch` caps at 20 and offers no way to configure
 * that limit. This is a documented deviation, not a gap to work around.
 */
export class FetchClient implements HttpClientInterface {
  private readonly timeout: number;
  private readonly connectTimeout: number;

  /**
   * @param timeout Overall transfer timeout in seconds, covering the whole
   *   exchange including the body read. Defaults to 30.
   * @param connectTimeout Deadline in seconds for response headers to
   *   arrive. Defaults to 10.
   */
  public constructor(timeout = 30, connectTimeout = 10) {
    this.timeout = timeout;
    this.connectTimeout = connectTimeout;
    Object.freeze(this);
  }

  /**
   * Perform the request and return the response.
   *
   * `fetch`'s promise settles as soon as response headers arrive, which
   * gives the PHP transport's two timeout options a faithful mapping onto a
   * single `AbortController`: `connectTimeout` bounds the wait for that
   * promise to settle, and `timeout` bounds the whole exchange, including
   * reading the body afterwards. Both timers run from the start of the
   * call; the connect timer is cleared the moment headers arrive so a fast
   * response followed by a slow body read is blamed on the overall
   * deadline, not the connect one.
   *
   * @param request The request to send.
   * @returns A promise resolving to the response. Never rejects; every
   *   failure is reported via {@link Response.getTransportError}.
   */
  public async send(request: Request): Promise<Response> {
    const url = request.getUrl();
    const method = request.getMethod();

    if (url === '' || method === '') {
      return new Response(0, '', {}, 'A request needs both a URL and an HTTP method');
    }

    if (request.hasProxy()) {
      return tunnelRequest(request, this.timeout, this.connectTimeout);
    }

    const controller = new AbortController();
    let reason = '';

    // Two deadlines over one controller: fetch settles when headers arrive,
    // so connectTimeout covers that phase and timeout covers the whole
    // exchange including the body read.
    const overall = setTimeout(() => {
      reason = `Operation timed out after ${String(this.timeout)} seconds`;
      controller.abort();
    }, this.timeout * 1000);
    let connect: NodeJS.Timeout | undefined = setTimeout(() => {
      reason = `Connect timed out after ${String(this.connectTimeout)} seconds`;
      controller.abort();
    }, this.connectTimeout * 1000);

    try {
      const headers = FetchClient.toHeaderEntries(request.getHeaders());
      const body = request.getBody();

      const raw = await fetch(url, {
        method,
        headers,
        ...(body === null ? {} : { body }),
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(connect);
      connect = undefined;

      const text = await raw.text();

      return new Response(raw.status, text, {
        http_code: raw.status,
        url: raw.url === '' ? url : raw.url,
        content_type: raw.headers.get('content-type') ?? '',
        headers: Object.fromEntries(raw.headers.entries()),
      });
    } catch (error) {
      const message = reason !== '' ? reason : FetchClient.describe(error);
      return new Response(0, '', {}, message);
    } finally {
      clearTimeout(overall);
      if (connect !== undefined) {
        clearTimeout(connect);
      }
    }
  }

  /**
   * Split raw `Name: value` header lines into the pairs `fetch` expects.
   *
   * The package carries headers as raw lines so that `Request` stays a
   * faithful description of the wire request and the debug logger can print
   * them unchanged; this is where that representation is adapted for
   * `fetch`, rather than changing what `Request` carries.
   *
   * @param lines Raw header lines, in `"Name: value"` form.
   * @returns `[name, value]` pairs, trimmed, skipping any line without a
   *   colon.
   */
  private static toHeaderEntries(lines: readonly string[]): [string, string][] {
    const entries: [string, string][] = [];
    for (const line of lines) {
      const separator = line.indexOf(':');
      if (separator === -1) {
        continue;
      }
      entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
    }
    return entries;
  }

  /**
   * Flatten an unknown thrown value into a transport error message.
   *
   * @param error The value caught from a failed `fetch` call.
   * @returns A human-readable description, including any wrapped cause.
   */
  private static describe(error: unknown): string {
    if (error instanceof Error) {
      const cause = error.cause;
      const causeText = cause instanceof Error ? `: ${cause.message}` : '';
      return `${error.message}${causeText}`;
    }
    return String(error);
  }
}
