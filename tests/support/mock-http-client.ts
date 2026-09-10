import type { HttpClientInterface } from '../../src/http/http-client.js';
import { Request } from '../../src/http/request.js';
import { Response } from '../../src/http/response.js';

/**
 * Recording transport used by the whole test suite.
 *
 * Nothing here touches the network. Every request is captured so tests can
 * assert the URL, method, headers and body that would have been sent, and
 * responses can be queued up front so a test controls exactly what the code
 * under test sees back.
 */
export class MockHttpClient implements HttpClientInterface {
  private readonly recorded: Request[] = [];
  private readonly queued: Response[] = [];
  private readonly fallback: Response;

  /**
   * @param fallback Response returned once the queue is empty. Defaults to
   *   a bare `200` success so tests that do not care about the response body
   *   do not have to queue one.
   */
  public constructor(fallback?: Response) {
    this.fallback = fallback ?? new Response(200, '{"ok":true}', { http_code: 200 });
  }

  /**
   * Queue a response to be returned by the next call to {@link send}.
   *
   * @param response Response to return, in FIFO order relative to other
   *   queued responses.
   * @returns `this`, for chaining multiple calls.
   */
  public queue(response: Response): this {
    this.queued.push(response);
    return this;
  }

  /**
   * Record the request and return the next queued response, or the fallback
   * once the queue is empty.
   *
   * @param request The request to record.
   * @returns A promise resolving to the next queued response, or the
   *   fallback.
   */
  public send(request: Request): Promise<Response> {
    this.recorded.push(request);
    return Promise.resolve(this.queued.shift() ?? this.fallback);
  }

  /**
   * The most recently recorded request.
   *
   * @returns The last request sent through this client.
   * @throws {Error} If no request has been recorded yet. A plain `Error`,
   *   deliberately, not a `VrioError` — this signals a broken test rather
   *   than a client fault.
   */
  public lastRequest(): Request {
    const last = this.recorded.at(-1);
    if (last === undefined) {
      throw new Error('No request was recorded.');
    }
    return last;
  }

  /**
   * @returns Every request recorded so far, in the order it was sent. A
   *   frozen copy, so a caller cannot corrupt this recorder's internal
   *   state by mutating (or casting away the readonly-ness of) the array
   *   they get back.
   */
  public requests(): readonly Request[] {
    return Object.freeze([...this.recorded]);
  }

  /**
   * @returns The number of requests recorded so far.
   */
  public count(): number {
    return this.recorded.length;
  }
}
