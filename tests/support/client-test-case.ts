import { expect } from 'vitest';
import { API } from '../../src/api.js';
import type { ClientOptions } from '../../src/client-config.js';
import type { Request } from '../../src/http/request.js';
import { MockHttpClient } from './mock-http-client.js';

/**
 * Obviously fake placeholder. Never a real credential.
 *
 * Held here rather than inline in each spec so a scan for leaked credentials
 * has exactly one string to recognise across the whole suite.
 */
export const API_KEY = 'test-api-key-not-a-real-credential';

/**
 * Build a client wired to a recording transport.
 *
 * The transport is always injected, so no test in this suite can reach the
 * network even if a URL is assembled wrongly.
 *
 * @param http Recording transport the client sends through.
 * @param options Connection and logging options for the client.
 * @returns A client whose every request lands in `http`.
 */
export function client(http: MockHttpClient, options: ClientOptions = {}): API {
  return new API(API_KEY, options, http);
}

/**
 * Assert the recorded request matches the expected shape.
 *
 * Checks all four things a resource and its `Call` are jointly responsible
 * for: the HTTP method, the URL, the body, and the three headers. The header
 * assertion is exact rather than a containment check, so an extra header
 * appearing (or the credential moving into the body) fails the test.
 *
 * @param http Transport whose most recent request is inspected.
 * @param method Expected HTTP method.
 * @param url Expected absolute URL, query string included.
 * @param body Expected request body, or `null` for a bodyless request.
 * @returns The recorded request, for further assertions.
 */
export function assertRequest(http: MockHttpClient, method: string, url: string, body: string | null = null): Request {
  const request = http.lastRequest();

  expect(request.getMethod()).toBe(method);
  expect(request.getUrl()).toBe(url);
  expect(request.getBody()).toBe(body);
  expect(request.getHeaders()).toEqual([
    'Content-Type: application/json',
    'hostname: api.vrio.app',
    `X-Api-Key: ${API_KEY}`,
  ]);

  return request;
}
