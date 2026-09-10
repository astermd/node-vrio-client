import { describe, expect, it } from 'vitest';
import { Route } from '../src/route.js';
import { VrioError } from '../src/exception/vrio-error.js';

describe('Route', () => {
  it('describes a route request', () => {
    const spec = new Route().getRoute('rt_1', { with: 'stops' });

    expect(spec.httpMethod).toBe('GET');
    expect(spec.section).toBe('routes/rt_1');
    expect(spec.query).toEqual({ with: 'stops' });
    expect(spec.fields).toEqual({});
  });

  it('defaults to no query parameters', () => {
    expect(new Route().getRoute('rt_1').query).toEqual({});
  });

  it('requires a route id', () => {
    expect(() => new Route().getRoute('')).toThrow(VrioError);
    expect(() => new Route().getRoute('')).toThrow('Missing required fields');
  });
});
