import { describe, expect, it } from 'vitest';
import { Customer } from '../src/customer.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('Customer', () => {
  it('describes a customer request', () => {
    const spec = new Customer().getCustomer('cus_1', { with: 'orders' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('customers/cus_1');
    expect(spec.query).toEqual({ with: 'orders' });
    expect(spec.fields).toEqual({});
  });

  it('defaults to no query parameters', () => {
    expect(new Customer().getCustomer('cus_1').query).toEqual({});
  });

  it('requires a customer id', () => {
    expect(() => new Customer().getCustomer('')).toThrow(VrioError);
    expect(() => new Customer().getCustomer('')).toThrow('Missing required fields');
  });
});
