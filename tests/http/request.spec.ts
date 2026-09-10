import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Request } from '../../src/http/request.js';
import { Response } from '../../src/http/response.js';

describe('Request', () => {
  it('never leaks the api key or proxy credentials when serialised', () => {
    // TypeScript's `private` and `readonly` erase at runtime, so a `private`
    // field is still an enumerable own property and every one of these
    // assertions has to reach runtime to prove anything. `Request` is the one
    // object this package hands to consumer code (the `HttpClientInterface`
    // seam), so a consumer instrumenting their transport with
    // `logger.info({ request })` must never write the API key or the proxy
    // password into their log store.
    const API_KEY_HEADER = 'X-Api-Key: SUPER-SECRET-KEY-123';
    const PROXY_URL = 'proxy.example.test:8080';
    const PROXY_CREDENTIALS = 'pxuser:pxsecret-placeholder';

    const request = new Request(
      'POST',
      'https://api.vrio.app/orders',
      ['Content-Type: application/json', API_KEY_HEADER],
      '{"email":"buyer@example.test"}',
      PROXY_URL,
      PROXY_CREDENTIALS,
    );

    const serialised = [JSON.stringify(request), JSON.stringify({ request }), inspect(request, { depth: 6 })];

    for (const encoded of serialised) {
      expect(encoded).not.toContain('SUPER-SECRET-KEY-123');
      expect(encoded).not.toContain(PROXY_CREDENTIALS);
      expect(encoded).not.toContain(PROXY_URL);
      expect(encoded).not.toContain('pxsecret');
    }
  });

  it('keeps no credential-bearing field enumerable', () => {
    const request = new Request(
      'POST',
      'https://api.vrio.app/orders',
      ['Content-Type: application/json', 'X-Api-Key: SUPER-SECRET-KEY-123'],
      '{"email":"buyer@example.test"}',
      'proxy.example.test:8080',
      'pxuser:pxsecret-placeholder',
    );

    expect(Object.keys(request)).toEqual([]);
  });

  it('exposes everything it was constructed with', () => {
    const request = new Request(
      'post',
      'https://api.vrio.app/orders',
      ['Content-Type: application/json'],
      '{"a":1}',
      'proxy.example.test:8080',
      'user:placeholder',
    );

    expect(request.getMethod()).toBe('POST');
    expect(request.getUrl()).toBe('https://api.vrio.app/orders');
    expect(request.getHeaders()).toEqual(['Content-Type: application/json']);
    expect(request.getBody()).toBe('{"a":1}');
    expect(request.getProxyUrl()).toBe('proxy.example.test:8080');
    expect(request.getProxyCredentials()).toBe('user:placeholder');
    expect(request.hasProxy()).toBe(true);
  });

  it('defaults to no body and no proxy', () => {
    const request = new Request('GET', 'https://api.vrio.app/orders');

    expect(request.getBody()).toBeNull();
    expect(request.getProxyUrl()).toBeNull();
    expect(request.getProxyCredentials()).toBeNull();
    expect(request.hasProxy()).toBe(false);
    expect(request.getHeaders()).toEqual([]);
  });

  it('uppercases the method', () => {
    expect(new Request('patch', 'https://api.vrio.app/orders/1').getMethod()).toBe('PATCH');
  });

  it('does not count an empty proxy url as a proxy', () => {
    const request = new Request('GET', 'https://api.vrio.app/orders', [], null, '');
    expect(request.hasProxy()).toBe(false);
  });

  it('is frozen, so a logger cannot mutate what is sent', () => {
    const request = new Request('GET', 'https://api.vrio.app/orders');
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('does not alias the caller header array', () => {
    const headers = ['A: 1'];
    const request = new Request('GET', 'https://api.vrio.app/orders', headers);
    headers.push('B: 2');
    expect(request.getHeaders()).toEqual(['A: 1']);
  });
});

describe('Response', () => {
  it('exposes everything it was constructed with', () => {
    const response = new Response(201, '{"id":"ord_1"}', { http_code: 201 });

    expect(response.getStatusCode()).toBe(201);
    expect(response.getBody()).toBe('{"id":"ord_1"}');
    expect(response.getInfo()).toEqual({ http_code: 201 });
    expect(response.getTransportError()).toBe('');
    expect(response.hasTransportError()).toBe(false);
  });

  it('carries a transport error as data rather than throwing', () => {
    const response = new Response(0, '', {}, 'connection refused');

    expect(response.hasTransportError()).toBe(true);
    expect(response.getTransportError()).toBe('connection refused');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new Response(200, ''))).toBe(true);
  });

  it('does not let a mutation of getInfo() leak back into the response', () => {
    const response = new Response(200, '', { http_code: 200 });

    const info = response.getInfo();
    expect(() => {
      info['http_code'] = 999;
    }).toThrow();

    expect(response.getInfo()).toEqual({ http_code: 200 });
  });
});
