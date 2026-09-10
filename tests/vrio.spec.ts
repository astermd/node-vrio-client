import { describe, expect, it } from 'vitest';
import type { RequestSpec } from '../src/call.js';
import { VrioError } from '../src/exception/vrio-error.js';
import { Vrio } from '../src/vrio.js';

/**
 * Minimal resource used to reach `Vrio`'s protected descriptor builders.
 * A real resource (Tasks 12 and 13) validates arguments and names the
 * section itself; this one just forwards.
 */
class Probe extends Vrio {
  public get(section: string, params?: Record<string, unknown>): RequestSpec {
    return params === undefined ? this.sendGet(section) : this.sendGet(section, params);
  }

  public post(section: string, fields?: Record<string, unknown>): RequestSpec {
    return fields === undefined ? this.sendPost(section) : this.sendPost(section, fields);
  }

  public patch(section: string, fields?: Record<string, unknown>): RequestSpec {
    return fields === undefined ? this.sendPatch(section) : this.sendPatch(section, fields);
  }

  public put(section: string, fields?: Record<string, unknown>): RequestSpec {
    return fields === undefined ? this.sendPut(section) : this.sendPut(section, fields);
  }

  public remove(section: string): RequestSpec {
    return this.sendDelete(section);
  }

  public missing(): never {
    return this.requiredFields();
  }
}

describe('Vrio descriptor builders', () => {
  it('describes a get with its query parameters', () => {
    expect(new Probe().get('orders', { with: 'items' })).toEqual({
      httpMethod: 'GET',
      section: 'orders',
      fields: {},
      query: { with: 'items' },
      headerRequired: false,
    });
  });

  it('describes a get with no parameters', () => {
    expect(new Probe().get('orders/ord_1')).toEqual({
      httpMethod: 'GET',
      section: 'orders/ord_1',
      fields: {},
      query: {},
      headerRequired: false,
    });
  });

  it.each([
    ['post', 'POST'],
    ['patch', 'PATCH'],
    ['put', 'PUT'],
  ] as const)('describes a %s with its body fields', (name, httpMethod) => {
    const probe = new Probe();
    expect(probe[name]('orders/ord_1', { status: 'paid' })).toEqual({
      httpMethod,
      section: 'orders/ord_1',
      fields: { status: 'paid' },
      query: {},
      headerRequired: false,
    });
  });

  it.each(['post', 'patch', 'put'] as const)('defaults %s fields to an empty bag', name => {
    expect(new Probe()[name]('orders').fields).toEqual({});
  });

  it('describes a delete', () => {
    expect(new Probe().remove('orders/ord_1')).toEqual({
      httpMethod: 'DELETE',
      section: 'orders/ord_1',
      fields: {},
      query: {},
      headerRequired: false,
    });
  });
});

describe('Vrio descriptor immutability', () => {
  it('freezes the descriptor and both of its bags', () => {
    const spec = new Probe().post('orders', { a: 1 });

    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.fields)).toBe(true);
    expect(Object.isFrozen(spec.query)).toBe(true);
  });

  it('copies the caller’s bag so a later mutation cannot change the request', () => {
    const fields: Record<string, unknown> = { a: 1 };
    const spec = new Probe().post('orders', fields);

    fields['a'] = 2;
    fields['b'] = 3;

    expect(spec.fields).toEqual({ a: 1 });
  });

  it('gives each call its own descriptor', () => {
    const probe = new Probe();
    const first = probe.get('orders');
    const second = probe.get('orders/ord_1');

    expect(first.section).toBe('orders');
    expect(second.section).toBe('orders/ord_1');
    expect(first).not.toBe(second);
  });
});

describe('Vrio headerRequired', () => {
  it('is off by default', () => {
    expect(new Probe().headerRequired).toBe(false);
  });

  it('is read into the descriptor at call time', () => {
    const probe = new Probe();
    const before = probe.get('orders');

    probe.headerRequired = true;
    const after = probe.get('orders');

    expect(before.headerRequired).toBe(false);
    expect(after.headerRequired).toBe(true);
  });
});

describe('Vrio requiredFields', () => {
  it('throws a VrioError naming the missing fields', () => {
    expect(() => new Probe().missing()).toThrow(VrioError);
    expect(() => new Probe().missing()).toThrow('Missing required fields');
  });
});
