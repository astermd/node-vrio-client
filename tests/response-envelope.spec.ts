import { describe, expect, it } from 'vitest';
import { Call, type Envelope, type RequestSpec, type TransportFailure } from '../src/call.js';
import { ClientConfig } from '../src/client-config.js';
import { DebugLogger } from '../src/logging/debug-logger.js';
import { Response } from '../src/http/response.js';
import { MockHttpClient } from './support/mock-http-client.js';

const KEY = 'test-api-key-not-a-real-credential';

const GET_ORDERS = Object.freeze({
  httpMethod: 'GET',
  section: 'orders',
  fields: {},
  query: {},
  headerRequired: false,
}) as RequestSpec;

function callWith(response: Response, spec: RequestSpec = GET_ORDERS): Call {
  const http = new MockHttpClient();
  http.queue(response);
  return new Call(spec, new ClientConfig(KEY), http, DebugLogger.fromOptions({}));
}

function envelopeOf(response: unknown): Envelope {
  return response as Envelope;
}

/**
 * Every row of php-envelope-vectors.txt, measured from the running PHP
 * client: the provider body, the exact JSON string get() returns, and the
 * value getInObject()/getInArray() decode it to.
 */
const rows: readonly (readonly [string, Response, string, unknown])[] = [
  [
    'success',
    new Response(200, '{"id":"ord_1"}', { http_code: 200 }),
    '{"success":true,"message":"","data":{"id":"ord_1"}}',
    { success: true, message: '', data: { id: 'ord_1' } },
  ],
  [
    'error_full',
    new Response(404, '{"error":{"message":"Order not found","code":"not_found"}}', {
      http_code: 404,
    }),
    '{"success":false,"message":"Order not found","data":{"error":{"message":"Order not found","code":"not_found"}},"validation_code":"not_found"}',
    {
      success: false,
      message: 'Order not found',
      data: { error: { message: 'Order not found', code: 'not_found' } },
      validation_code: 'not_found',
    },
  ],
  [
    'error_no_code',
    new Response(400, '{"error":{"message":"Bad"}}', { http_code: 400 }),
    '{"success":false,"message":"Bad","data":{"error":{"message":"Bad"}},"validation_code":""}',
    {
      success: false,
      message: 'Bad',
      data: { error: { message: 'Bad' } },
      validation_code: '',
    },
  ],
  [
    'error_no_message',
    new Response(400, '{"error":{"code":"bad"}}', { http_code: 400 }),
    '{"success":false,"message":"","data":{"error":{"code":"bad"}},"validation_code":"bad"}',
    {
      success: false,
      message: '',
      data: { error: { code: 'bad' } },
      validation_code: 'bad',
    },
  ],
  [
    'error_nonscalar',
    new Response(400, '{"error":{"message":{"a":1}}}', { http_code: 400 }),
    '{"success":false,"message":"","data":{"error":{"message":{"a":1}}},"validation_code":""}',
    {
      success: false,
      message: '',
      data: { error: { message: { a: 1 } } },
      validation_code: '',
    },
  ],
  [
    // PHP's isset() is false for a null value, so a null error node never
    // reaches the failure branch. Faithful, not a bug.
    'error_null',
    new Response(200, '{"error":null}', { http_code: 200 }),
    '{"success":true,"message":"","data":{"error":null}}',
    { success: true, message: '', data: { error: null } },
  ],
  [
    'not_json',
    new Response(502, 'Bad Gateway', { http_code: 502 }),
    '{"success":true,"message":"","data":null}',
    { success: true, message: '', data: null },
  ],
  [
    'empty_body',
    new Response(204, '', { http_code: 204 }),
    '{"success":true,"message":"","data":null}',
    { success: true, message: '', data: null },
  ],
  [
    'json_array',
    new Response(200, '[{"id":"a"}]', { http_code: 200 }),
    '{"success":true,"message":"","data":[{"id":"a"}]}',
    { success: true, message: '', data: [{ id: 'a' }] },
  ],
  [
    'transport_fail',
    new Response(0, '', {}, 'connection refused'),
    'connection refused',
    { curlError: 'connection refused' },
  ],
];

describe('the response envelope matches the measured php vectors', () => {
  it.each(rows)('get() returns the %s envelope string', async (_name, response, expected) => {
    const result = await callWith(response).get();
    expect(result.response).toBe(expected);
  });

  it.each(rows)('getInObject() decodes the %s envelope', async (_name, response, _s, decoded) => {
    const result = await callWith(response).getInObject();
    expect(result.response).toEqual(decoded);
  });

  it.each(rows)('getInArray() decodes the %s envelope alike', async (_n, response, _s, decoded) => {
    const result = await callWith(response).getInArray();
    expect(result.response).toEqual(decoded);
  });
});

describe('the response envelope', () => {
  it('wraps a successful body', async () => {
    const result = await callWith(new Response(200, '{"id":"ord_1"}')).getInObject();
    expect(result.response).toEqual({
      success: true,
      message: '',
      data: { id: 'ord_1' },
    });
  });

  it('reports a provider error as data, not as a throw', async () => {
    const body = '{"error":{"message":"Order not found","code":"not_found"}}';
    const result = await callWith(new Response(404, body)).getInObject();

    const envelope = envelopeOf(result.response);
    expect(envelope.success).toBe(false);
    expect(envelope.message).toBe('Order not found');
    expect(envelope.validation_code).toBe('not_found');
    expect(envelope.data).toMatchObject({ error: { message: 'Order not found' } });
  });

  it('omits validation_code when there is no error', async () => {
    const result = await callWith(new Response(200, '{"id":"ord_1"}')).getInObject();
    expect(result.response).not.toHaveProperty('validation_code');
  });

  it('uses an empty validation_code when the error carries no code', async () => {
    const result = await callWith(new Response(400, '{"error":{"message":"Bad"}}')).getInObject();
    expect(envelopeOf(result.response).validation_code).toBe('');
  });

  it('uses an empty validation_code when the code is null, matching isset', async () => {
    const result = await callWith(new Response(400, '{"error":{"code":null}}')).getInObject();
    expect(envelopeOf(result.response).validation_code).toBe('');
  });

  it('keeps a non-string code as it arrived', async () => {
    const result = await callWith(new Response(400, '{"error":{"code":42}}')).getInObject();
    expect(envelopeOf(result.response).validation_code).toBe(42);
  });

  it('uses an empty message when the error carries no message', async () => {
    const result = await callWith(new Response(400, '{"error":{"code":"bad"}}')).getInObject();
    expect(envelopeOf(result.response).message).toBe('');
  });

  it('uses an empty message when the error message is not scalar', async () => {
    const result = await callWith(new Response(400, '{"error":{"message":{"a":1}}}')).getInObject();
    expect(envelopeOf(result.response).message).toBe('');
  });

  it('casts a numeric error message the way php does', async () => {
    const result = await callWith(new Response(400, '{"error":{"message":42}}')).getInObject();
    expect(envelopeOf(result.response).message).toBe('42');
  });

  it.each([
    ['true', '{"error":{"message":true}}', '1'],
    ['false', '{"error":{"message":false}}', ''],
  ])('casts a %s error message the way php casts a bool to string', async (_n, body, expected) => {
    const result = await callWith(new Response(400, body)).getInObject();
    expect(envelopeOf(result.response).message).toBe(expected);
  });

  it('treats a null error node as success, matching isset semantics', async () => {
    const result = await callWith(new Response(200, '{"error":null}')).getInObject();
    expect(envelopeOf(result.response).success).toBe(true);
  });

  it.each([
    ['false', '{"error":false}'],
    ['zero', '{"error":0}'],
    ['a string', '{"error":"boom"}'],
    ['an array', '{"error":["a"]}'],
  ])('treats a non-null %s error node as a failure with no detail', async (_name, body) => {
    const result = await callWith(new Response(400, body)).getInObject();

    const envelope = envelopeOf(result.response);
    expect(envelope.success).toBe(false);
    expect(envelope.message).toBe('');
    expect(envelope.validation_code).toBe('');
  });

  it('sets data to null when the provider body is not json', async () => {
    const result = await callWith(new Response(200, '<html>nope</html>')).getInObject();
    expect(result.response).toEqual({ success: true, message: '', data: null });
  });

  it('keeps a json scalar body as data', async () => {
    const result = await callWith(new Response(200, '123')).getInObject();
    expect(result.response).toEqual({ success: true, message: '', data: 123 });
  });

  it('reports a transport failure under curlError', async () => {
    const result = await callWith(new Response(0, '', {}, 'connection refused')).getInObject();
    expect(result.response).toEqual<TransportFailure>({ curlError: 'connection refused' });
  });

  it('returns the raw transport error from get', async () => {
    const result = await callWith(new Response(0, '', {}, 'connection refused')).get();
    expect(result.response).toBe('connection refused');
  });

  it('reports a transport failure the same way through getInArray', async () => {
    const result = await callWith(new Response(0, '', {}, 'connection refused')).getInArray();
    expect(result.response).toEqual<TransportFailure>({ curlError: 'connection refused' });
  });

  it('returns identical values from getInArray and getInObject', async () => {
    const call = callWith(new Response(200, '{"id":"ord_1"}'));
    expect(await call.getInArray()).toEqual(await call.getInObject());
  });
});

describe('the envelope under headerRequired', () => {
  const withHeader = Object.freeze({
    httpMethod: 'GET',
    section: 'orders',
    fields: {},
    query: {},
    headerRequired: true,
  }) as RequestSpec;

  it('attaches transport metadata to the string envelope', async () => {
    const call = callWith(new Response(200, '{"id":"ord_1"}', { http_code: 200, total_time: 0.12 }), withHeader);

    expect(await call.get()).toEqual({
      response: {
        content: '{"success":true,"message":"","data":{"id":"ord_1"}}',
        header: { http_code: 200, total_time: 0.12 },
      },
    });
  });

  it('attaches transport metadata to the decoded envelope', async () => {
    const call = callWith(new Response(200, '{"id":"ord_1"}', { http_code: 200, total_time: 0.12 }), withHeader);

    expect(await call.getInObject()).toEqual({
      response: {
        content: { success: true, message: '', data: { id: 'ord_1' } },
        header: { http_code: 200, total_time: 0.12 },
      },
    });
  });

  it('does not wrap a transport failure', async () => {
    const call = callWith(new Response(0, '', {}, 'connection refused'), withHeader);

    expect((await call.get()).response).toBe('connection refused');
    expect((await call.getInObject()).response).toEqual({ curlError: 'connection refused' });
  });
});

describe('the payload info matches the measured php vectors', () => {
  it('get_query', async () => {
    const call = callWith(
      new Response(200, '{}'),
      Object.freeze({
        httpMethod: 'GET',
        section: 'orders',
        fields: {},
        query: { with: 'items' },
        headerRequired: false,
      }),
    );

    expect((await call.getInObject(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders?with=items',
      with: 'items',
    });
  });

  it('post_fields', async () => {
    const call = callWith(
      new Response(200, '{}'),
      Object.freeze({
        httpMethod: 'POST',
        section: 'orders',
        fields: { email: 'buyer@example.test' },
        query: {},
        headerRequired: false,
      }),
    );

    expect((await call.getInObject(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders',
      email: 'buyer@example.test',
    });
  });

  it('patch_edit', async () => {
    const call = callWith(
      new Response(200, '{}'),
      Object.freeze({
        httpMethod: 'PATCH',
        section: 'orders/ord_1',
        fields: { order_id: 'ord_1', status: 'paid' },
        query: {},
        headerRequired: false,
      }),
    );

    expect((await call.getInObject(true)).payload).toEqual({
      endPoint: 'https://api.vrio.app/orders/ord_1',
      order_id: 'ord_1',
      status: 'paid',
    });
  });
});
