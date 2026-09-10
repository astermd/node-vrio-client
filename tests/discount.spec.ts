import { describe, expect, it } from 'vitest';
import { Discount } from '../src/discount.js';

describe('Discount', () => {
  it('describes a validate request with the params as the body', () => {
    const spec = new Discount().validateDiscount({ code: 'SAVE10' });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe('discounts/validate');
    expect(spec.fields).toEqual({ code: 'SAVE10' });
    expect(spec.query).toEqual({});
  });

  it('defaults to an empty body for validate', () => {
    expect(new Discount().validateDiscount().fields).toEqual({});
  });

  it('wraps calculate params in an offers member', () => {
    const spec = new Discount().calculateDiscount({ 0: { offer_id: 'off_1' } });

    expect(spec.httpMethod).toBe('POST');
    expect(spec.section).toBe('discounts/calculate');
    expect(spec.fields).toEqual({ offers: { 0: { offer_id: 'off_1' } } });
  });

  it('defaults calculate to an empty offers member', () => {
    expect(new Discount().calculateDiscount().fields).toEqual({ offers: {} });
  });
});
