import { describe, expect, it } from 'vitest';
import { Cart } from '../src/cart.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('Cart', () => {
  it('describes a create cart request', () => {
    const spec = new Cart().createCart({ campaign_id: 'camp_1' });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe('carts');
    expect(spec.fields).toEqual({ campaign_id: 'camp_1' });
  });

  it('defaults to an empty body for create cart', () => {
    expect(new Cart().createCart().fields).toEqual({});
  });

  it('puts the cart token in the path for a paypal token', () => {
    const spec = new Cart().createPaypalToken({ cart_token: 'crt_1', amount: 100 });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe('carts/crt_1/payment_tokens');
    // The token stays in the body too, exactly as the PHP sends it.
    expect(spec.fields).toEqual({ cart_token: 'crt_1', amount: 100 });
  });

  it('coerces a numeric cart token for a paypal token', () => {
    expect(new Cart().createPaypalToken({ cart_token: 42 }).section).toBe('carts/42/payment_tokens');
  });

  it('coerces a true cart token to "1", matching PHP\'s (string) cast', () => {
    expect(new Cart().createPaypalToken({ cart_token: true }).section).toBe('carts/1/payment_tokens');
  });

  it('rejects a false cart token, since PHP casts it to an empty string', () => {
    expect(() => new Cart().createPaypalToken({ cart_token: false })).toThrow(VrioError);
  });

  it('requires a cart token for a paypal token', () => {
    expect(() => new Cart().createPaypalToken({})).toThrow(VrioError);
    expect(() => new Cart().createPaypalToken({})).toThrow('Missing required fields');
  });

  it('requires a non-scalar cart token to be rejected', () => {
    expect(() => new Cart().createPaypalToken({ cart_token: { a: 1 } })).toThrow(VrioError);
  });

  it('puts both identifiers in the path for paypal data and sends no query', () => {
    const spec = new Cart().getPaypalData({ cart_token: 'crt_1', payment_token_id: 'pt_1' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('carts/crt_1/payment_tokens/pt_1');
    expect(spec.query).toEqual({});
    expect(spec.fields).toEqual({});
  });

  it.each([[{ cart_token: 'crt_1' }], [{ payment_token_id: 'pt_1' }], [{}]])(
    'requires both identifiers for paypal data (%j)',
    params => {
      expect(() => new Cart().getPaypalData(params)).toThrow(VrioError);
    },
  );

  it('rejects a non-scalar identifier for paypal data', () => {
    expect(() => new Cart().getPaypalData({ cart_token: { a: 1 }, payment_token_id: 'pt_1' })).toThrow(VrioError);
  });
});
