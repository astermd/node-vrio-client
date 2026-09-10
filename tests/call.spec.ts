import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { Call, isEnvelope, isTransportFailure, type RequestSpec } from '../src/call.js';
import { ClientConfig } from '../src/client-config.js';
import { Config } from '../src/config.js';
import { DebugLogger } from '../src/logging/debug-logger.js';
import { Response } from '../src/http/response.js';
import { MockHttpClient } from './support/mock-http-client.js';

const KEY = 'test-api-key-not-a-real-credential';

function spec(overrides: Partial<RequestSpec> = {}): RequestSpec {
  return Object.freeze({
    httpMethod: 'GET',
    section: 'orders',
    fields: {},
    query: {},
    headerRequired: false,
    ...overrides,
  });
}

function makeCall(
  http: MockHttpClient,
  overrides: Partial<RequestSpec> = {},
  options: { basePath?: string } = {},
): Call {
  const config = new ClientConfig(KEY, options.basePath === undefined ? {} : { basePath: options.basePath });
  return new Call(spec(overrides), config, http, DebugLogger.fromOptions({}));
}

describe('Call url assembly', () => {
  it('joins the base url to the section', async () => {
    const http = new MockHttpClient();
    await makeCall(http).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/orders');
  });

  it('prepends a base path', async () => {
    const http = new MockHttpClient();
    await makeCall(http, {}, { basePath: 'v1' }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/v1/orders');
  });

  it('rtrims a trailing slash off a get section, matching the php base path vector', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { section: 'orders/' }, { basePath: 'v1' }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/v1/orders');
  });

  it('strips spaces and leading slashes from the section', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { section: '/orders/ ord 1' }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/orders/ord1');
  });

  it('trims leading slashes before stripping spaces, as the php does', async () => {
    // PHP/src/Vrio.php: str_replace(' ', '', ltrim($section, '/')). ltrim
    // removes only "/", never a space, so a leading space shields the slash
    // and the URL keeps a double slash. Measured on PHP 8.5.
    const http = new MockHttpClient();
    await makeCall(http, { section: ' /orders' }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app//orders');
  });

  it('appends the query string for a get', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { query: { with: 'items' } }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/orders?with=items');
  });

  it('sends no query string for a post', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { httpMethod: 'POST', query: { with: 'items' } }).getInObject();
    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/orders');
  });

  // Faithful to PHP/src/Vrio.php's sendGet(), which tests the params array
  // rather than the encoded string: a parameter that encodes away still
  // produces the "?". Rows measured from the running PHP client and recorded
  // in php-url-edge-vectors.txt.
  const urlEdges: readonly (readonly [string, Record<string, unknown>, string])[] = [
    ['empty_array', {}, 'https://api.vrio.app/orders'],
    ['all_null', { a: null }, 'https://api.vrio.app/orders?'],
    ['null_plus_real', { a: null, b: '1' }, 'https://api.vrio.app/orders?b=1'],
    ['empty_str_val', { a: '' }, 'https://api.vrio.app/orders?a='],
    ['empty_nested', { a: [] }, 'https://api.vrio.app/orders?'],
  ];

  it.each(urlEdges)('matches the php url edge vector %s', async (_name, query, expected) => {
    const http = new MockHttpClient();
    await makeCall(http, { query }).getInObject();
    expect(http.lastRequest().getUrl()).toBe(expected);
  });
});

describe('Call headers and body', () => {
  it('sends the three headers in order', async () => {
    const http = new MockHttpClient();
    await makeCall(http).getInObject();
    expect(http.lastRequest().getHeaders()).toEqual([
      'Content-Type: application/json',
      'hostname: api.vrio.app',
      `X-Api-Key: ${KEY}`,
    ]);
  });

  it('sends no body for a get', async () => {
    const http = new MockHttpClient();
    await makeCall(http).getInObject();
    expect(http.lastRequest().getBody()).toBeNull();
  });

  it('sends no body for a delete', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { httpMethod: 'DELETE' }).getInObject();
    expect(http.lastRequest().getBody()).toBeNull();
  });

  it('encodes an empty payload as an object, not an array', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { httpMethod: 'POST', fields: {} }).getInObject();
    expect(http.lastRequest().getBody()).toBe('{}');
  });

  it('encodes the payload as json for a post', async () => {
    const http = new MockHttpClient();
    await makeCall(http, {
      httpMethod: 'POST',
      fields: { email: 'buyer@example.test' },
    }).getInObject();
    expect(http.lastRequest().getBody()).toBe('{"email":"buyer@example.test"}');
  });

  it.each(['POST', 'PATCH', 'PUT'] as const)('sends a body for %s', async httpMethod => {
    const http = new MockHttpClient();
    await makeCall(http, { httpMethod, fields: { a: 1 } }).getInObject();
    expect(http.lastRequest().getBody()).toBe('{"a":1}');
  });

  it('sends the method through unchanged', async () => {
    const http = new MockHttpClient();
    await makeCall(http, { httpMethod: 'PATCH' }).getInObject();
    expect(http.lastRequest().getMethod()).toBe('PATCH');
  });
});

// Every row of php-envelope-vectors.txt's "wire request per endpoint" table,
// measured from the running PHP client. The section/fields/query columns are
// what a resource method will hand to Call once Tasks 12 and 13 land.
describe('Call reproduces every measured endpoint on the wire', () => {
  const endpoints: readonly (readonly [string, Partial<RequestSpec>, string, string, string | null])[] = [
    [
      'searchOrder',
      { httpMethod: 'GET', section: 'orders', query: { with: 'items' } },
      'GET',
      'https://api.vrio.app/orders?with=items',
      null,
    ],
    ['getOrder', { httpMethod: 'GET', section: 'orders/ord_1' }, 'GET', 'https://api.vrio.app/orders/ord_1', null],
    [
      'addOrder',
      { httpMethod: 'POST', section: 'orders', fields: { email: 'buyer@example.test' } },
      'POST',
      'https://api.vrio.app/orders',
      '{"email":"buyer@example.test"}',
    ],
    [
      'addOrder_empty',
      { httpMethod: 'POST', section: 'orders', fields: {} },
      'POST',
      'https://api.vrio.app/orders',
      '{}',
    ],
    [
      'editOrder',
      {
        httpMethod: 'PATCH',
        section: 'orders/ord_1',
        fields: { order_id: 'ord_1', status: 'paid' },
      },
      'PATCH',
      'https://api.vrio.app/orders/ord_1',
      '{"order_id":"ord_1","status":"paid"}',
    ],
    [
      'processOrder',
      { httpMethod: 'POST', section: 'orders/ord_1/process', fields: {} },
      'POST',
      'https://api.vrio.app/orders/ord_1/process',
      '{}',
    ],
    [
      'captureOrder',
      { httpMethod: 'POST', section: 'orders/ord_1/capture', fields: { amount: 1000 } },
      'POST',
      'https://api.vrio.app/orders/ord_1/capture',
      '{"amount":1000}',
    ],
    [
      'addOrderNote',
      {
        httpMethod: 'POST',
        section: 'orders/ord_1/notes',
        fields: { note: 'called the customer' },
      },
      'POST',
      'https://api.vrio.app/orders/ord_1/notes',
      '{"note":"called the customer"}',
    ],
    [
      'getCampaignItems',
      { httpMethod: 'GET', section: 'campaigns/camp_1/items', query: { with: 'offers' } },
      'GET',
      'https://api.vrio.app/campaigns/camp_1/items?with=offers',
      null,
    ],
    [
      'getCustomer',
      { httpMethod: 'GET', section: 'customers/cus_1' },
      'GET',
      'https://api.vrio.app/customers/cus_1',
      null,
    ],
    [
      'searchOffer',
      { httpMethod: 'GET', section: 'offers', query: { campaign_id: 'camp_1' } },
      'GET',
      'https://api.vrio.app/offers?campaign_id=camp_1',
      null,
    ],
    ['getRoute', { httpMethod: 'GET', section: 'routes/rt_1' }, 'GET', 'https://api.vrio.app/routes/rt_1', null],
    [
      'validateDiscount',
      { httpMethod: 'POST', section: 'discounts/validate', fields: { code: 'SAVE10' } },
      'POST',
      'https://api.vrio.app/discounts/validate',
      '{"code":"SAVE10"}',
    ],
    [
      'calculateDiscount',
      {
        httpMethod: 'POST',
        section: 'discounts/calculate',
        fields: { offers: { offer_id: 'off_1' } },
      },
      'POST',
      'https://api.vrio.app/discounts/calculate',
      '{"offers":{"offer_id":"off_1"}}',
    ],
    [
      'createCart',
      { httpMethod: 'POST', section: 'carts', fields: { campaign_id: 'camp_1' } },
      'POST',
      'https://api.vrio.app/carts',
      '{"campaign_id":"camp_1"}',
    ],
    [
      'createPaypalToken',
      {
        httpMethod: 'POST',
        section: 'carts/crt_1/payment_tokens',
        fields: { cart_token: 'crt_1' },
      },
      'POST',
      'https://api.vrio.app/carts/crt_1/payment_tokens',
      '{"cart_token":"crt_1"}',
    ],
    [
      'getPaypalData',
      { httpMethod: 'GET', section: 'carts/crt_1/payment_tokens/pt_1' },
      'GET',
      'https://api.vrio.app/carts/crt_1/payment_tokens/pt_1',
      null,
    ],
    [
      'getOrder_emptyq',
      { httpMethod: 'GET', section: 'orders/ord_1', query: {} },
      'GET',
      'https://api.vrio.app/orders/ord_1',
      null,
    ],
  ];

  it.each(endpoints)('%s', async (_name, overrides, method, url, body) => {
    const http = new MockHttpClient();
    await makeCall(http, overrides).getInObject();

    const request = http.lastRequest();
    expect(request.getMethod()).toBe(method);
    expect(request.getUrl()).toBe(url);
    expect(request.getBody()).toBe(body);
  });
});

describe('Call execution', () => {
  it('sends exactly one request however many accessors read it', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http);

    await call.get();
    await call.getInObject();
    await call.getInArray();

    expect(http.count()).toBe(1);
  });

  it('sends exactly one request when accessors are read concurrently', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http);

    await Promise.all([call.get(), call.getInObject(), call.getInArray()]);

    expect(http.count()).toBe(1);
  });

  it('fires when awaited without an accessor', async () => {
    const http = new MockHttpClient();
    const result = await makeCall(http);

    expect(http.count()).toBe(1);
    expect(result.response).toMatchObject({ success: true });
  });

  it('does not resolve then to itself', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http);

    expect(await call).not.toBe(call);
  });

  it('sends nothing until it is read', () => {
    const http = new MockHttpClient();
    makeCall(http);
    expect(http.count()).toBe(0);
  });

  it('does not let two calls interfere with each other', async () => {
    const http = new MockHttpClient();
    const config = new ClientConfig(KEY);
    const logger = DebugLogger.fromOptions({});

    const first = new Call(spec({ section: 'orders' }), config, http, logger);
    const second = new Call(
      spec({ section: 'orders/ord_1/capture', httpMethod: 'POST', fields: { amount: 1000 } }),
      config,
      http,
      logger,
    );

    await Promise.all([first.getInObject(), second.getInObject()]);

    const urls = http.requests().map(request => request.getUrl());
    expect(urls).toContain('https://api.vrio.app/orders');
    expect(urls).toContain('https://api.vrio.app/orders/ord_1/capture');

    const bodies = http.requests().map(request => request.getBody());
    expect(bodies).toContain(null);
    expect(bodies).toContain('{"amount":1000}');
  });

  it('passes a queued proxy to the request', async () => {
    const http = new MockHttpClient();
    const call = new Call(
      spec(),
      new ClientConfig(KEY),
      http,
      DebugLogger.fromOptions({}),
      'proxy.example.test:8080',
      'user:placeholder',
    );

    await call.getInObject();

    expect(http.lastRequest().hasProxy()).toBe(true);
    expect(http.lastRequest().getProxyUrl()).toBe('proxy.example.test:8080');
    expect(http.lastRequest().getProxyCredentials()).toBe('user:placeholder');
  });

  it('sends no proxy when none was queued', async () => {
    const http = new MockHttpClient();
    await makeCall(http).getInObject();

    expect(http.lastRequest().hasProxy()).toBe(false);
    expect(http.lastRequest().getProxyUrl()).toBeNull();
    expect(http.lastRequest().getProxyCredentials()).toBeNull();
  });

  it('reports the payload info only when asked', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http, { query: { with: 'items' } });

    expect(await call.getInObject()).not.toHaveProperty('payload');
    expect((await call.getInObject(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders?with=items',
      with: 'items',
    });
  });

  it('reports the payload info from get too', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http, { query: { with: 'items' } });

    expect(await call.get()).not.toHaveProperty('payload');
    expect((await call.get(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders?with=items',
      with: 'items',
    });
  });

  it('lets fields win a payload key collision, as array_merge does', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http, {
      httpMethod: 'POST',
      query: { status: 'from-query' },
      fields: { status: 'from-fields' },
    });

    expect((await call.getInObject(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders',
      status: 'from-fields',
    });
  });

  it('never leaks the api key into the payload info', async () => {
    const http = new MockHttpClient();
    const call = makeCall(http, {
      httpMethod: 'POST',
      fields: { email: 'buyer@example.test' },
    });

    const encoded = JSON.stringify(await call.getInObject(true));

    expect(encoded).not.toContain(KEY);
    expect(encoded).not.toContain('apiKey');
  });

  it('never leaks a credential when the whole call is serialised', async () => {
    // TypeScript's `private` and `readonly` erase at runtime, so a `private`
    // field is still an enumerable own property and every one of these
    // assertions has to reach runtime to prove anything. Three credentials
    // are reachable from a Call: the API key (via the config, and via a
    // transport that retains the requests it sent), and the proxy URL and
    // its "user:password" credentials, which are plaintext in their own
    // right. Serialisers a Call can plausibly meet — JSON.stringify, a
    // structured logger, an error serialiser, util.inspect — must see none
    // of them.
    const PROXY_URL = 'proxy.example.test:8080';
    const PROXY_CREDENTIALS = 'pxuser:pxsecret-placeholder';

    const http = new MockHttpClient();
    const call = new Call(
      spec({ httpMethod: 'POST', fields: { email: 'buyer@example.test' } }),
      new ClientConfig(KEY),
      http,
      DebugLogger.fromOptions({}),
      PROXY_URL,
      PROXY_CREDENTIALS,
    );
    await call.getInObject();

    const serialised = [JSON.stringify(call), JSON.stringify({ call }), inspect(call, { depth: 6 })];

    for (const encoded of serialised) {
      expect(encoded).not.toContain(KEY);
      expect(encoded).not.toContain(PROXY_CREDENTIALS);
      expect(encoded).not.toContain(PROXY_URL);
      expect(encoded).not.toContain('pxsecret');
    }
  });

  it('keeps no credential-bearing field enumerable', async () => {
    const http = new MockHttpClient();
    const call = new Call(
      spec(),
      new ClientConfig(KEY),
      http,
      DebugLogger.fromOptions({}),
      'proxy.example.test:8080',
      'pxuser:pxsecret-placeholder',
    );
    await call.getInObject();

    expect(Object.keys(call)).toEqual(['spec', 'inFlight', 'envelope', 'transportInfo', 'failed', 'lastUrl']);
  });

  it('logs the exchange when logging is on', async () => {
    const entries: string[] = [];
    const http = new MockHttpClient();
    const logger = DebugLogger.fromOptions({
      debug: true,
      debugSink: entry => {
        entries.push(entry);
      },
    });

    await new Call(spec(), new ClientConfig(KEY), http, logger).getInObject();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('https://api.vrio.app/orders');
    expect(entries[0]).not.toContain(KEY);
  });

  it('reports headerRequired results as content and header', async () => {
    const http = new MockHttpClient();
    http.queue(new Response(200, '{"id":"ord_1"}', { http_code: 200 }));

    const result = await makeCall(http, { headerRequired: true }).getInObject();

    expect(result.response).toHaveProperty('content');
    expect(result.response).toHaveProperty('header', { http_code: 200 });
  });

  it('keeps the envelope message wired for the decode guard', () => {
    // decodeEnvelope()'s catch cannot be reached from Call, which always
    // builds the envelope with JSON.stringify. The guard stays for a
    // corrupted envelope; this asserts its message is still resolvable.
    expect(Config.get('Messages.jsonFormatError')).toBe('API response is not valid JSON');
  });
});

describe('isTransportFailure and isEnvelope', () => {
  it('narrows a successful call to an envelope, not a transport failure', async () => {
    const http = new MockHttpClient();
    const { response } = await makeCall(http).getInObject();

    expect(isTransportFailure(response)).toBe(false);
    expect(isEnvelope(response)).toBe(true);

    if (isEnvelope(response)) {
      // Compiles under --strict only because isEnvelope narrowed `response`
      // away from TransportFailure | WithHeader<Envelope>.
      expect(response.success).toBe(true);
    }
  });

  it('narrows a failed call to a transport failure, not an envelope', async () => {
    const http = new MockHttpClient();
    http.queue(new Response(0, '', {}, 'connection refused'));
    const { response } = await makeCall(http).getInObject();

    expect(isTransportFailure(response)).toBe(true);
    expect(isEnvelope(response)).toBe(false);

    if (isTransportFailure(response)) {
      // Compiles under --strict only because isTransportFailure narrowed
      // `response` away from Envelope | WithHeader<Envelope>.
      expect(response.curlError).toBe('connection refused');
    }
  });

  it('does not treat a headerRequired wrapper as a plain envelope', async () => {
    const http = new MockHttpClient();
    http.queue(new Response(200, '{"id":"ord_1"}', { http_code: 200 }));
    const { response } = await makeCall(http, { headerRequired: true }).getInObject();

    expect(isEnvelope(response)).toBe(false);
    expect(isTransportFailure(response)).toBe(false);
  });
});
