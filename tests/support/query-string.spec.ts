import { describe, expect, it } from 'vitest';
import { buildQuery } from '../../src/support/query-string.js';
import { VrioError } from '../../src/exception/vrio-error.js';

describe('buildQuery', () => {
  it('returns an empty string for no parameters', () => {
    expect(buildQuery({})).toBe('');
  });

  it('encodes a flat pair', () => {
    expect(buildQuery({ with: 'items' })).toBe('with=items');
  });

  it('preserves insertion order', () => {
    expect(buildQuery({ b: '2', a: '1' })).toBe('b=2&a=1');
  });

  it('encodes a space as a plus, not %20', () => {
    expect(buildQuery({ q: 'two words' })).toBe('q=two+words');
  });

  it('percent-encodes reserved characters in keys and values', () => {
    expect(buildQuery({ 'a&b': 'c=d' })).toBe('a%26b=c%3Dd');
  });

  it('uses numeric bracket notation for an array', () => {
    expect(buildQuery({ with: ['items', 'offers'] })).toBe('with%5B0%5D=items&with%5B1%5D=offers');
  });

  it('uses named bracket notation for a nested object', () => {
    expect(buildQuery({ filter: { status: 'paid' } })).toBe('filter%5Bstatus%5D=paid');
  });

  it('nests to arbitrary depth', () => {
    expect(buildQuery({ a: { b: { c: 'd' } } })).toBe('a%5Bb%5D%5Bc%5D=d');
  });

  it('renders booleans as 1 and 0, as PHP does', () => {
    expect(buildQuery({ t: true, f: false })).toBe('t=1&f=0');
  });

  it('renders a number without quoting', () => {
    expect(buildQuery({ page: 2 })).toBe('page=2');
  });

  it('skips null and undefined, as PHP skips null', () => {
    expect(buildQuery({ a: null, b: undefined, c: 'kept' })).toBe('c=kept');
  });

  it('keeps an empty string value', () => {
    expect(buildQuery({ a: '' })).toBe('a=');
  });

  it('omits an empty nested container entirely', () => {
    expect(buildQuery({ a: [], b: {}, c: 'kept' })).toBe('c=kept');
  });

  it('percent-encodes all six RFC 1738 reserved marks left alone by encodeURIComponent', () => {
    expect(buildQuery({ k: "a~b!c(d)e*f'g" })).toBe('k=a%7Eb%21c%28d%29e%2Af%27g');
  });

  it('percent-encodes slashes and colons in a URL value', () => {
    expect(buildQuery({ url: 'https://api.vrio.app/orders' })).toBe('url=https%3A%2F%2Fapi.vrio.app%2Forders');
  });

  it('percent-encodes multi-byte UTF-8 characters', () => {
    expect(buildQuery({ name: 'Zoë' })).toBe('name=Zo%C3%AB');
  });

  it('percent-encodes a literal plus sign so it is distinguishable from an encoded space', () => {
    expect(buildQuery({ k: 'a+b' })).toBe('k=a%2Bb');
  });

  it('mixes arrays and nested objects at multiple depths', () => {
    expect(buildQuery({ with: ['items'], filter: { status: 'paid', tags: ['a', 'b'] } })).toBe(
      'with%5B0%5D=items&filter%5Bstatus%5D=paid&filter%5Btags%5D%5B0%5D=a&filter%5Btags%5D%5B1%5D=b',
    );
  });

  // Expectations below are measured against real PHP 8.5 http_build_query() output.
  it('drops a Date entirely, as PHP drops a DateTime with no public properties', () => {
    expect(buildQuery({ a: new Date('2026-08-16T09:14:02Z') })).toBe('');
  });

  it('enumerates a class instance by its public fields, as PHP enumerates public properties', () => {
    expect(
      buildQuery({
        a: new (class {
          x = 1;
        })(),
      }),
    ).toBe('a%5Bx%5D=1');
  });

  it('drops a class instance with no public fields entirely', () => {
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- deliberately empty, to prove no public fields means no output
    class Empty {}
    expect(buildQuery({ a: new Empty() })).toBe('');
  });

  it('encodes a plain object by its own enumerable properties', () => {
    expect(buildQuery({ a: { x: 1 } })).toBe('a%5Bx%5D=1');
  });

  it("renders NaN, Infinity, and -Infinity with PHP's spelling", () => {
    expect(buildQuery({ a: NaN })).toBe('a=NAN');
    expect(buildQuery({ a: Infinity })).toBe('a=INF');
    expect(buildQuery({ a: -Infinity })).toBe('a=-INF');
  });

  it('rejects params nested past the 64-level depth cap with a VrioError, not a RangeError', () => {
    // A consumer forwarding untrusted nested JSON as filter parameters could
    // otherwise hand flatten() an object deep enough to blow the call stack,
    // which would surface as a RangeError -- the one non-VrioError the
    // package's own code could throw. Real query parameters nest 1-3 levels,
    // so 64 is generous while staying far below the stack limit.
    let deeplyNested: unknown = 'leaf';
    for (let i = 0; i < 100; i += 1) {
      deeplyNested = { n: deeplyNested };
    }

    expect(() => buildQuery({ a: deeplyNested })).toThrow(VrioError);
  });

  it('still encodes a normally-nested (three level) object, unaffected by the depth cap', () => {
    expect(buildQuery({ a: { b: { c: 'd' } } })).toBe('a%5Bb%5D%5Bc%5D=d');
  });
});
