import { describe, expect, it } from 'vitest';
import { ClientConfig } from '../src/client-config.js';
import { VrioError } from '../src/exception/vrio-error.js';

const KEY = 'test-api-key-not-a-real-credential';

describe('ClientConfig', () => {
  it('requires an API key', () => {
    expect(() => new ClientConfig('')).toThrow(VrioError);
    expect(() => new ClientConfig('')).toThrow('An API key is required');
  });

  it('rejects a whitespace-only API key', () => {
    expect(() => new ClientConfig('   ')).toThrow(VrioError);
  });

  it('defaults the host', () => {
    expect(new ClientConfig(KEY).getHost()).toBe('api.vrio.app');
  });

  it('builds a base url with no trailing slash', () => {
    expect(new ClientConfig(KEY).getBaseUrl()).toBe('https://api.vrio.app');
  });

  it('appends a base path', () => {
    expect(new ClientConfig(KEY, { basePath: 'v1' }).getBaseUrl()).toBe('https://api.vrio.app/v1');
  });

  it('trims surrounding slashes from the base path', () => {
    expect(new ClientConfig(KEY, { basePath: '/v1/' }).getBaseUrl()).toBe('https://api.vrio.app/v1');
  });

  it('honours an explicit host', () => {
    expect(new ClientConfig(KEY, { host: 'api.vrio.app' }).getHost()).toBe('api.vrio.app');
  });

  it('falls back to the default host for an empty host', () => {
    expect(new ClientConfig(KEY, { host: '  ' }).getHost()).toBe('api.vrio.app');
  });

  it.each([
    ['https://api.vrio.app', 'a scheme'],
    ['api.vrio.app/v1', 'a path'],
    ['api vrio app', 'a space'],
    ['api.vrio.app?x=1', 'a query'],
  ])('rejects a host containing %s', host => {
    expect(() => new ClientConfig(KEY, { host })).toThrow(VrioError);
    expect(() => new ClientConfig(KEY, { host })).toThrow(/bare hostname/);
  });

  it('defaults both timeouts', () => {
    const config = new ClientConfig(KEY);
    expect(config.getTimeout()).toBe(30);
    expect(config.getConnectTimeout()).toBe(10);
  });

  it('honours explicit timeouts', () => {
    const config = new ClientConfig(KEY, { timeout: 5, connectTimeout: 2 });
    expect(config.getTimeout()).toBe(5);
    expect(config.getConnectTimeout()).toBe(2);
  });

  it('ignores a non-numeric timeout and keeps the default', () => {
    const config = new ClientConfig(KEY, { timeout: Number.NaN });
    expect(config.getTimeout()).toBe(30);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new ClientConfig(KEY))).toBe(true);
  });

  it('exposes the api key only through its getter', () => {
    const config = new ClientConfig(KEY);
    expect(config.getApiKey()).toBe(KEY);
    expect(JSON.stringify(config)).not.toContain(KEY);
  });
});

// Fix round 1: stringOption/intOption must match the measured PHP 8.5
// ClientConfig exactly (PHP's is_scalar / is_numeric + cast semantics), not
// a stricter typeof-only check. These values are only reachable from
// runtime callers (plain JS, or a value carried over unchanged from a PHP
// config, e.g. `process.env.VRIO_TIMEOUT`), so each case below deliberately
// casts through the option bag to exercise the coercion — the narrow
// ClientOptions types (`host?: string`, `timeout?: number`) are unchanged.
describe('ClientConfig lenient option coercion (matches PHP scalar/numeric semantics)', () => {
  describe('stringOption, observed via host', () => {
    it.each([
      [123, '123'],
      [12.5, '12.5'],
      [true, '1'],
    ])('coerces a scalar host %p to the bare host %p', (value, expected) => {
      expect(new ClientConfig(KEY, { host: value as unknown as string }).getHost()).toBe(expected);
    });

    it('coerces a boolean false host to "" and the empty-host check falls back to the default', () => {
      expect(new ClientConfig(KEY, { host: false as unknown as string }).getHost()).toBe(ClientConfig.DEFAULT_HOST);
    });

    it('falls back to the default host for an empty string host', () => {
      expect(new ClientConfig(KEY, { host: '' }).getHost()).toBe(ClientConfig.DEFAULT_HOST);
    });

    it('falls back to the default host for a whitespace-only host', () => {
      expect(new ClientConfig(KEY, { host: '  ' }).getHost()).toBe(ClientConfig.DEFAULT_HOST);
    });

    it('falls back to the default host for a null host', () => {
      expect(new ClientConfig(KEY, { host: null as unknown as string }).getHost()).toBe(ClientConfig.DEFAULT_HOST);
    });

    it.each([
      ['an array', [] as unknown as string],
      ['an object', {} as unknown as string],
    ])('falls back to the default host for %s host', (_label, value) => {
      expect(new ClientConfig(KEY, { host: value }).getHost()).toBe(ClientConfig.DEFAULT_HOST);
    });
  });

  describe('intOption, observed via timeout and connectTimeout', () => {
    it.each([
      ['5', 5],
      ['5.7', 5],
      ['1e3', 1000],
    ])('coerces the numeric string %s to the truncated integer %d', (value, expected) => {
      expect(new ClientConfig(KEY, { timeout: value as unknown as number }).getTimeout()).toBe(expected);
    });

    it('truncates (not rounds) a fractional numeric timeout', () => {
      expect(new ClientConfig(KEY, { timeout: 5.9 }).getTimeout()).toBe(5);
    });

    it.each([
      ['a boolean true', true as unknown as number],
      ['a boolean false', false as unknown as number],
      ['a non-numeric string', 'abc' as unknown as number],
      ['an empty string', '' as unknown as number],
      ['a whitespace-only string', '  ' as unknown as number],
      ['null', null as unknown as number],
    ])('falls back to the default timeout for %s', (_label, value) => {
      expect(new ClientConfig(KEY, { timeout: value }).getTimeout()).toBe(ClientConfig.DEFAULT_TIMEOUT);
    });

    it.each([
      [0, 0],
      [-3, -3],
    ])('does not clamp a timeout of %d', (value, expected) => {
      expect(new ClientConfig(KEY, { timeout: value }).getTimeout()).toBe(expected);
    });

    it('applies the same numeric-string coercion to connectTimeout', () => {
      expect(new ClientConfig(KEY, { connectTimeout: '2' as unknown as number }).getConnectTimeout()).toBe(2);
    });
  });
});
