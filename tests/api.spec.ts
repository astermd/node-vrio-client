import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { API } from '../src/api.js';
import { Call } from '../src/call.js';
import { VrioError } from '../src/exception/vrio-error.js';
import { MockHttpClient } from './support/mock-http-client.js';
import { API_KEY, assertRequest, client } from './support/client-test-case.js';

/** A client seen the way a plain-JavaScript consumer sees it: untyped. */
function untyped(api: API): Record<string, () => unknown> {
  return api as unknown as Record<string, () => unknown>;
}

describe('API construction', () => {
  it('requires an api key', () => {
    expect(() => new API('', {}, new MockHttpClient())).toThrow(VrioError);
    expect(() => new API('', {}, new MockHttpClient())).toThrow('An API key is required');
  });

  it('rejects a whitespace-only api key', () => {
    expect(() => new API('   ', {}, new MockHttpClient())).toThrow(VrioError);
    expect(() => new API('   ', {}, new MockHttpClient())).toThrow('An API key is required');
  });

  it('needs no transport argument', () => {
    // Constructing the default transport must not perform any I/O, so this
    // stays offline. Nothing is sent, because a Call is lazy.
    expect(() => new API(API_KEY)).not.toThrow();
  });

  it('rejects a host that is not bare', () => {
    expect(() => new API(API_KEY, { host: 'https://api.vrio.app/v1' })).toThrow(VrioError);
  });

  it('reports a debug configuration error from the constructor', () => {
    expect(() => new API(API_KEY, { debug: true }, new MockHttpClient())).toThrow(VrioError);
  });

  it('uses the default host when none is given', async () => {
    const http = new MockHttpClient();
    await client(http).searchOrder();

    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/orders');
  });

  it('honours an explicit host', async () => {
    const http = new MockHttpClient();
    await client(http, { host: 'api.vrio.app' }).searchOrder();

    const request = http.lastRequest();

    expect(request.getUrl()).toBe('https://api.vrio.app/orders');
    expect(request.getHeaders()).toContain('hostname: api.vrio.app');
  });

  it('prepends a base path to every route', async () => {
    const http = new MockHttpClient();
    await client(http, { basePath: 'v1' }).searchOrder();

    expect(http.lastRequest().getUrl()).toBe('https://api.vrio.app/v1/orders');
  });

  it('is recognisable with instanceof through its proxy', () => {
    expect(client(new MockHttpClient())).toBeInstanceOf(API);
  });
});

describe('API dispatch', () => {
  it('rejects unknown methods', () => {
    // A JS consumer's typo. TypeScript would reject this at compile time.
    const api = untyped(client(new MockHttpClient()));

    expect(() => api['thisMethodDoesNotExist']!()).toThrow(VrioError);
    expect(() => api['thisMethodDoesNotExist']!()).toThrow('No such method found');
  });

  it('returns an unsent Call', () => {
    const http = new MockHttpClient();
    const call = client(http).searchOrder();

    expect(call).toBeInstanceOf(Call);
    expect(http.count()).toBe(0);
  });

  it('reuses one resource instance across calls', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.searchOrder();
    await api.getOrder('ord_1');

    expect(http.count()).toBe(2);
  });

  it('hands back a distinct Call per invocation', () => {
    const api = client(new MockHttpClient());

    expect(api.searchOrder()).not.toBe(api.searchOrder());
  });

  it('does not let concurrent calls interfere', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await Promise.all([api.searchOrder().getInObject(), api.getOrder('ord_1').getInObject()]);

    const urls = http
      .requests()
      .map(request => request.getUrl())
      .sort();

    expect(urls).toEqual(['https://api.vrio.app/orders', 'https://api.vrio.app/orders/ord_1']);
  });

  it('propagates a resource error for a missing required field', () => {
    const api = client(new MockHttpClient());

    expect(() => api.createPaypalToken({})).toThrow(VrioError);
    expect(() => api.createPaypalToken({})).toThrow('Missing required fields');
  });

  it('lists every resource method', () => {
    const methods = API.supportedMethods();

    expect(methods).toHaveLength(18);
    expect(methods).toContain('captureOrder');
    expect(methods).toContain('getPaypalData');
    expect(methods).not.toContain('get');
  });

  it('lists the resource methods in the PHP client order', () => {
    expect(API.supportedMethods()).toEqual([
      'getCampaignItems',
      'getCustomer',
      'validateDiscount',
      'calculateDiscount',
      'searchOffer',
      'searchOrder',
      'getOrder',
      'addOrder',
      'editOrder',
      'processOrder',
      'completeOrder',
      'authorizeOrder',
      'captureOrder',
      'addOrderNote',
      'getRoute',
      'createCart',
      'createPaypalToken',
      'getPaypalData',
    ]);
  });

  it('exposes every listed method as a real function', () => {
    const api = untyped(client(new MockHttpClient()));

    for (const method of API.supportedMethods()) {
      expect(typeof api[method]).toBe('function');
    }
  });
});

describe('API proxy guard', () => {
  it('passes the thenable probe through so awaiting the client does not throw', async () => {
    const api = client(new MockHttpClient());

    expect(untyped(api)['then']).toBeUndefined();
    await expect(Promise.resolve(api)).resolves.toBeInstanceOf(API);
  });

  it.each(['then', 'catch', 'finally', 'toJSON', 'inspect'] as const)(
    'passes the well-known name %s through instead of returning a thrower',
    name => {
      const api = untyped(client(new MockHttpClient()));

      expect(api[name]).toBeUndefined();
    },
  );

  it.each(['toString', 'valueOf', 'constructor', 'hasOwnProperty'] as const)(
    'keeps the inherited member %s callable',
    name => {
      const api = untyped(client(new MockHttpClient()));

      expect(typeof api[name]).toBe('function');
    },
  );

  it('survives inspection and serialisation', () => {
    const api = client(new MockHttpClient());

    expect(() => inspect(api, { depth: 6 })).not.toThrow();
    expect(() => JSON.stringify(api)).not.toThrow();
    expect(inspect(api)).toContain('API');
  });

  it('passes symbol lookups through', () => {
    const api = client(new MockHttpClient()) as unknown as Record<symbol, unknown>;

    expect(api[Symbol.iterator]).toBeUndefined();
    expect(api[Symbol.toPrimitive]).toBeUndefined();
    expect(api[Symbol.asyncIterator]).toBeUndefined();
  });

  it('keeps the stringification members callable rather than throwing', () => {
    const api = untyped(client(new MockHttpClient()));
    const invoke = (name: string): unknown => api[name]!();

    // A thrower here would break template literals, `util.inspect` and any
    // logger that stringifies its arguments. `typeof` alone would not catch a
    // regression, because the guard hands back a function either way; only
    // invoking them proves the well-known names were passed through.
    expect(() => invoke('toString')).not.toThrow();
    expect(() => invoke('valueOf')).not.toThrow();
    expect(invoke('toString')).toBe('[object Object]');
  });

  it('returns a stable function for a repeated method lookup', () => {
    const api = untyped(client(new MockHttpClient()));

    expect(api['searchOrder']).toBe(api['searchOrder']);
  });
});

describe('API credential containment', () => {
  it('keeps the api key out of serialisation and inspection after a call', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.addOrder({ email: 'buyer@example.test' });

    // The transport retains the requests it was sent, and a Request's headers
    // carry the credential, so a TS-`private` field on the client would put
    // the key one property walk away. These assertions run at runtime for
    // exactly that reason; a type-level claim would prove nothing.
    expect(JSON.stringify(api)).not.toContain(API_KEY);
    expect(inspect(api, { depth: 6 })).not.toContain(API_KEY);
  });

  it('exposes no enumerable properties at all', () => {
    const api = client(new MockHttpClient());

    expect(Object.keys(api)).toEqual([]);
    expect(JSON.stringify(api)).toBe('{}');
  });

  it('keeps queued proxy credentials off the serialisation path', () => {
    const api = client(new MockHttpClient()).withProxy('proxy.example.test:8080', 'user:secret-placeholder');

    expect(JSON.stringify(api)).not.toContain('secret-placeholder');
    expect(inspect(api, { depth: 6 })).not.toContain('secret-placeholder');
  });
});

describe('API accessors', () => {
  it.each(['get', 'getInArray', 'getInObject'] as const)('fails on %s before any method is invoked', accessor => {
    const api = client(new MockHttpClient());

    expect(() => api[accessor]()).toThrow(VrioError);
    expect(() => api[accessor]()).toThrow('No API method has been invoked yet');
  });

  it.each(['get', 'getInArray', 'getInObject'] as const)(
    'still fails on %s after a successful call, pointing at the chain',
    async accessor => {
      const http = new MockHttpClient();
      const api = client(http);

      await api.searchOrder().getInObject();

      expect(() => api[accessor]()).toThrow(VrioError);
      expect(() => api[accessor]()).toThrow('No API method has been invoked yet');
    },
  );

  it('names the accessors as real methods rather than unknown ones', () => {
    const api = untyped(client(new MockHttpClient()));

    // The distinction matters to someone migrating PHP code: "No such method
    // found" would send them looking for a typo that is not there.
    expect(() => api['get']!()).toThrow('No API method has been invoked yet');
    expect(() => api['getSomethingElse']!()).toThrow('No such method found');
  });
});

describe('API payload info', () => {
  it('omits the payload by default', async () => {
    const http = new MockHttpClient();
    const result = await client(http).searchOrder({ with: 'items' }).get();

    expect(result).not.toHaveProperty('payload');
    expect(result).toHaveProperty('response');
  });

  it('returns the payload on request for a get query', async () => {
    const http = new MockHttpClient();
    const result = await client(http).searchOrder({ with: 'items' }).get(true);

    expect(result.payload).toEqual({
      endPoint: 'https://api.vrio.app/orders?with=items',
      with: 'items',
    });
  });

  it('returns the payload on request for post fields', async () => {
    const http = new MockHttpClient();
    const result = await client(http).addOrder({ email: 'buyer@example.test' }).get(true);

    expect(result.payload).toEqual({
      endPoint: 'https://api.vrio.app/orders',
      email: 'buyer@example.test',
    });
  });

  it('returns the payload on request for a patch', async () => {
    const http = new MockHttpClient();
    const result = await client(http).editOrder({ order_id: 'ord_1', status: 'paid' }).get(true);

    expect(result.payload).toEqual({
      endPoint: 'https://api.vrio.app/orders/ord_1',
      order_id: 'ord_1',
      status: 'paid',
    });
  });

  it('never contains the api key', async () => {
    const http = new MockHttpClient();
    const result = await client(http).addOrder({ email: 'buyer@example.test' }).get(true);

    const encoded = JSON.stringify(result);

    expect(encoded).not.toContain(API_KEY);
    expect(encoded).not.toContain('apiKey');
  });

  it('sends the api key as a header and never in the body', async () => {
    const http = new MockHttpClient();
    await client(http).addOrder({ email: 'buyer@example.test' });

    assertRequest(http, 'POST', 'https://api.vrio.app/orders', '{"email":"buyer@example.test"}');
  });
});

describe('API withProxy', () => {
  it('applies to the next call only', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.withProxy('proxy.example.test:8080', 'user:secret-placeholder').searchOrder();
    const first = http.lastRequest();

    expect(first.hasProxy()).toBe(true);
    expect(first.getProxyUrl()).toBe('proxy.example.test:8080');
    expect(first.getProxyCredentials()).toBe('user:secret-placeholder');

    await api.searchOrder();
    const second = http.lastRequest();

    expect(second.hasProxy()).toBe(false);
    expect(second.getProxyUrl()).toBeNull();
  });

  it('is chainable and ignores an empty address', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    expect(api.withProxy('')).toBe(api);

    await api.searchOrder();

    expect(http.lastRequest().hasProxy()).toBe(false);
  });

  it('omits credentials when none are given', async () => {
    const http = new MockHttpClient();
    await client(http).withProxy('proxy.example.test:8080').searchOrder();

    expect(http.lastRequest().getProxyCredentials()).toBeNull();
  });

  it('clears the queued proxy even when the call throws for a missing field', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    // PHP's __call consumes the queued proxy before invoking the resource, so
    // a rejected call must not leave the proxy armed for the next one.
    expect(() => api.withProxy('proxy.example.test:8080').createPaypalToken({})).toThrow(VrioError);

    await api.searchOrder();

    expect(http.lastRequest().hasProxy()).toBe(false);
  });

  it('does not leak a queued proxy between clients sharing a transport', async () => {
    const http = new MockHttpClient();
    const first = client(http);
    const second = client(http);

    first.withProxy('proxy.example.test:8080');
    await second.searchOrder();

    expect(http.lastRequest().hasProxy()).toBe(false);
  });
});

describe('API endpoints', () => {
  it('issues every read endpoint with the right method and url', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.getCampaignItems('camp_1', { with: 'offers' });
    assertRequest(http, 'GET', 'https://api.vrio.app/campaigns/camp_1/items?with=offers');

    await api.getCustomer('cus_1');
    assertRequest(http, 'GET', 'https://api.vrio.app/customers/cus_1');

    await api.searchOffer({ campaign_id: 'camp_1' });
    assertRequest(http, 'GET', 'https://api.vrio.app/offers?campaign_id=camp_1');

    await api.getRoute('rt_1');
    assertRequest(http, 'GET', 'https://api.vrio.app/routes/rt_1');

    await api.searchOrder({ with: 'items' });
    assertRequest(http, 'GET', 'https://api.vrio.app/orders?with=items');

    await api.getOrder('ord_1');
    assertRequest(http, 'GET', 'https://api.vrio.app/orders/ord_1');

    await api.getOrder('ord_1', {});
    assertRequest(http, 'GET', 'https://api.vrio.app/orders/ord_1');

    await api.getPaypalData({ cart_token: 'crt_1', payment_token_id: 'pt_1' });
    assertRequest(http, 'GET', 'https://api.vrio.app/carts/crt_1/payment_tokens/pt_1');
  });

  it('issues every write endpoint with the right method, url and body', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.validateDiscount({ code: 'SAVE10' });
    assertRequest(http, 'POST', 'https://api.vrio.app/discounts/validate', '{"code":"SAVE10"}');

    await api.calculateDiscount({ offer_id: 'off_1' });
    assertRequest(http, 'POST', 'https://api.vrio.app/discounts/calculate', '{"offers":{"offer_id":"off_1"}}');

    await api.addOrder({ email: 'buyer@example.test' });
    assertRequest(http, 'POST', 'https://api.vrio.app/orders', '{"email":"buyer@example.test"}');

    await api.addOrder();
    assertRequest(http, 'POST', 'https://api.vrio.app/orders', '{}');

    await api.editOrder({ order_id: 'ord_1', status: 'paid' });
    assertRequest(http, 'PATCH', 'https://api.vrio.app/orders/ord_1', '{"order_id":"ord_1","status":"paid"}');

    await api.processOrder('ord_1');
    assertRequest(http, 'POST', 'https://api.vrio.app/orders/ord_1/process', '{}');

    await api.completeOrder('ord_1');
    assertRequest(http, 'POST', 'https://api.vrio.app/orders/ord_1/complete', '{}');

    await api.authorizeOrder('ord_1', { amount: 1000 });
    assertRequest(http, 'POST', 'https://api.vrio.app/orders/ord_1/authorize', '{"amount":1000}');

    await api.captureOrder('ord_1', { amount: 1000 });
    assertRequest(http, 'POST', 'https://api.vrio.app/orders/ord_1/capture', '{"amount":1000}');

    await api.addOrderNote('ord_1', { note: 'called the customer' });
    assertRequest(http, 'POST', 'https://api.vrio.app/orders/ord_1/notes', '{"note":"called the customer"}');

    await api.createCart({ campaign_id: 'camp_1' });
    assertRequest(http, 'POST', 'https://api.vrio.app/carts', '{"campaign_id":"camp_1"}');

    await api.createPaypalToken({ cart_token: 'crt_1' });
    assertRequest(http, 'POST', 'https://api.vrio.app/carts/crt_1/payment_tokens', '{"cart_token":"crt_1"}');
  });

  it('covers all eighteen endpoints in one client', async () => {
    const http = new MockHttpClient();
    const api = client(http);

    await api.getCampaignItems('camp_1');
    await api.getCustomer('cus_1');
    await api.validateDiscount({ code: 'SAVE10' });
    await api.calculateDiscount({ offer_id: 'off_1' });
    await api.searchOffer();
    await api.searchOrder();
    await api.getOrder('ord_1');
    await api.addOrder();
    await api.editOrder({ order_id: 'ord_1' });
    await api.processOrder('ord_1');
    await api.completeOrder('ord_1');
    await api.authorizeOrder('ord_1');
    await api.captureOrder('ord_1');
    await api.addOrderNote('ord_1');
    await api.getRoute('rt_1');
    await api.createCart();
    await api.createPaypalToken({ cart_token: 'crt_1' });
    await api.getPaypalData({ cart_token: 'crt_1', payment_token_id: 'pt_1' });

    expect(http.count()).toBe(API.supportedMethods().length);
  });
});
