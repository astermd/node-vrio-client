import { Config } from '../config.js';
import { VrioError } from '../exception/vrio-error.js';

/**
 * Recursion depth cap for {@link flatten}.
 *
 * Real query parameters nest one to three levels. A consumer that forwards
 * untrusted, arbitrarily-nested JSON as filter parameters could otherwise
 * hand `flatten()` an object deep enough to exhaust the call stack, which
 * surfaces as an uncatchable `RangeError` -- breaking the package's contract
 * that only `VrioError` ever escapes its own code. 64 is generous headroom
 * above any real use while staying far below the stack limit, so the cap is
 * reached and turned into a typed error long before a `RangeError` could.
 */
const MAX_QUERY_DEPTH = 64;

/**
 * Percent-encode one component the way PHP's default `PHP_QUERY_RFC1738`
 * encoding does: `encodeURIComponent` semantics, but a space becomes `+`
 * rather than `%20`, and the characters `encodeURIComponent` leaves alone but
 * RFC 1738 does not are escaped explicitly.
 */
function encodeComponent(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, '+')
    .replace(/[!'()*~]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Render one scalar the way PHP casts it into a query string.
 *
 * PHP writes `true` as `1` and `false` as `0`, and skips `null` entirely.
 * A non-finite number is spelled the way PHP spells it — `NaN` as `NAN`,
 * `Infinity` as `INF`, and `-Infinity` as `-INF` — rather than JavaScript's
 * `String()` spelling.
 */
function scalarToString(value: string | number | bigint | boolean): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    if (Number.isNaN(value)) {
      return 'NAN';
    }
    return value > 0 ? 'INF' : '-INF';
  }
  return String(value);
}

/**
 * Flatten one key/value pair into zero or more encoded `key=value` fragments.
 *
 * Containers recurse with bracket-suffixed keys — arrays by numeric index and
 * objects by property name — which is what produces PHP's `with[0]=items` and
 * `filter[status]=paid` shapes.
 *
 * @param depth Recursion depth reached so far. Starts at `0` for a top-level
 *   entry and increments once per container level descended into.
 * @throws {VrioError} When recursing past {@link MAX_QUERY_DEPTH}.
 */
function flatten(key: string, value: unknown, out: string[], depth = 0): void {
  if (value === null || value === undefined) {
    return;
  }

  if (depth > MAX_QUERY_DEPTH) {
    throw new VrioError(Config.get('Messages.queryTooDeep'));
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flatten(`${key}[${String(index)}]`, item, out, depth + 1);
    });
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      flatten(`${key}[${childKey}]`, childValue, out, depth + 1);
    }
    return;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    out.push(`${encodeComponent(key)}=${encodeComponent(scalarToString(value))}`);
  }
}

/**
 * Build a query string byte-compatible with PHP's `http_build_query()`.
 *
 * The PHP client this package mirrors builds `GET` URLs with
 * `http_build_query()` at its default encoding. Two of its behaviours differ
 * from `URLSearchParams`: a space encodes as `+`, and nested containers use
 * bracket notation instead of being flattened. Reproducing both keeps the two
 * clients' URLs identical, which matters because logged URLs and provider-side
 * request logs are compared across the two packages during support work.
 *
 * A value whose own enumerable properties are empty — a `Date`, a class
 * instance with no public fields, or a plain `{}` — encodes to nothing at
 * all, not even the key. This mirrors PHP's `http_build_query()`, which
 * enumerates only an object's public properties and so drops a `DateTime`
 * the same way. A caller who wants a timestamp in the query string must
 * format it into a string or number themselves before passing it in.
 *
 * @param params Parameters to encode. Insertion order is preserved. `null`
 *               and `undefined` values are skipped, as PHP skips `null`.
 * @returns The encoded query string with no leading `?`, or an empty string
 *          when nothing was encodable.
 */
export function buildQuery(params: Record<string, unknown>): string {
  const fragments: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    flatten(key, value, fragments);
  }
  return fragments.join('&');
}
