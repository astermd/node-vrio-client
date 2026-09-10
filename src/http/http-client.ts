import type { Request } from './request.js';
import type { Response } from './response.js';

/**
 * Transport seam.
 *
 * Implement this to route requests through your own HTTP stack — a shared
 * agent, an instrumented wrapper, a recorded fixture — and pass the
 * implementation as the third `API` constructor argument. The package's own
 * test suite uses this seam, which is why no test performs network I/O.
 *
 * Implementations must not throw on transport failure. Report it through
 * {@link Response.getTransportError} instead, so the debug logger can record
 * the attempt before the caller decides what to do about it.
 */
export interface HttpClientInterface {
  /**
   * Perform the request and return the response.
   *
   * @param request The request to send.
   * @returns A promise resolving to the response. Never rejects on transport
   *   failure; that is reported via {@link Response.getTransportError}.
   */
  send(request: Request): Promise<Response>;
}

/** HTTP methods this client issues. */
export const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const);

/** One of the HTTP methods this client issues. */
export type HttpMethod = (typeof HTTP_METHODS)[number];
