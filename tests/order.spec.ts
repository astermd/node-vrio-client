import { describe, expect, it } from 'vitest';
import { Order } from '../src/order.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('Order reads', () => {
  it('describes a search', () => {
    const spec = new Order().searchOrder({ with: 'items' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('orders');
    expect(spec.query).toEqual({ with: 'items' });
    expect(spec.fields).toEqual({});
  });

  it('describes a search with no filter', () => {
    expect(new Order().searchOrder().query).toEqual({});
  });

  it('describes a single order read', () => {
    const spec = new Order().getOrder('ord_1', { with: 'items' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('orders/ord_1');
    expect(spec.query).toEqual({ with: 'items' });
  });

  it('requires an order id to read one', () => {
    expect(() => new Order().getOrder('')).toThrow(VrioError);
    expect(() => new Order().getOrder('')).toThrow('Missing required fields');
  });
});

describe('Order writes', () => {
  it('describes a create', () => {
    const spec = new Order().addOrder({ email: 'buyer@example.test' });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe('orders');
    expect(spec.fields).toEqual({ email: 'buyer@example.test' });
  });

  it('defaults to an empty body for create', () => {
    expect(new Order().addOrder().fields).toEqual({});
  });

  it('takes the order id for an edit out of the params', () => {
    const spec = new Order().editOrder({ order_id: 'ord_1', status: 'paid' });

    expect(spec.httpMethod).toBe('PATCH');
    expect(spec.section).toBe('orders/ord_1');
    // The identifier stays in the body, as the PHP sends it.
    expect(spec.fields).toEqual({ order_id: 'ord_1', status: 'paid' });
  });

  it('requires order_id in the params for an edit', () => {
    expect(() => new Order().editOrder({ status: 'paid' })).toThrow(VrioError);
    expect(() => new Order().editOrder({})).toThrow('Missing required fields');
  });

  it('rejects a non-scalar order_id for an edit', () => {
    expect(() => new Order().editOrder({ order_id: { a: 1 } })).toThrow(VrioError);
  });

  it('coerces a numeric order_id for an edit', () => {
    expect(new Order().editOrder({ order_id: 42 }).section).toBe('orders/42');
  });

  it('coerces a floating order_id for an edit', () => {
    expect(new Order().editOrder({ order_id: 12.5 }).section).toBe('orders/12.5');
  });

  it('coerces a true order_id to "1", matching PHP\'s (string) cast', () => {
    expect(new Order().editOrder({ order_id: true }).section).toBe('orders/1');
  });

  it('rejects a false order_id, since PHP casts it to an empty string', () => {
    expect(() => new Order().editOrder({ order_id: false })).toThrow(VrioError);
  });
});

describe('Order lifecycle actions', () => {
  it.each([
    ['processOrder', 'process'],
    ['completeOrder', 'complete'],
    ['authorizeOrder', 'authorize'],
    ['captureOrder', 'capture'],
    ['addOrderNote', 'notes'],
  ] as const)('describes %s as a post to the %s sub-resource', (method, segment) => {
    const spec = new Order()[method]('ord_1', { amount: 1000 });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe(`orders/ord_1/${segment}`);
    expect(spec.fields).toEqual({ amount: 1000 });
  });

  it.each(['processOrder', 'completeOrder', 'authorizeOrder', 'captureOrder', 'addOrderNote'] as const)(
    'requires an order id for %s',
    method => {
      expect(() => new Order()[method]('')).toThrow(VrioError);
      expect(() => new Order()[method]('')).toThrow('Missing required fields');
    },
  );

  it.each(['processOrder', 'completeOrder', 'authorizeOrder', 'captureOrder', 'addOrderNote'] as const)(
    'defaults to an empty body for %s',
    method => {
      expect(new Order()[method]('ord_1').fields).toEqual({});
    },
  );
});
