import { describe, expect, it, vi } from 'vitest';
import { DebugLogger } from '../../src/logging/debug-logger.js';
import { Request } from '../../src/http/request.js';
import { Response } from '../../src/http/response.js';
import { VrioError } from '../../src/exception/vrio-error.js';

const KEY = 'test-api-key-not-a-real-credential';

function postRequest(body: string): Request {
  return new Request(
    'POST',
    'https://api.vrio.app/orders',
    ['Content-Type: application/json', 'hostname: api.vrio.app', `X-Api-Key: ${KEY}`],
    body,
  );
}

/**
 * Strip the leading `[timestamp]` line from a formatted entry, so a test can
 * compare the rest of the entry byte-for-byte against a measured PHP vector
 * without needing to freeze the clock.
 */
function withoutTimestamp(entry: string): string {
  return entry.slice(entry.indexOf('\n') + 1);
}

describe('DebugLogger.fromOptions', () => {
  it('is disabled by default', () => {
    expect(DebugLogger.fromOptions({}).isEnabled()).toBe(false);
  });

  it('redacts by default when enabled', () => {
    const logger = DebugLogger.fromOptions({ debug: true, debugSink: () => undefined });
    expect(logger.isEnabled()).toBe(true);
    expect(logger.isRedacting()).toBe(true);
  });

  it('honours debugRedact false', () => {
    const logger = DebugLogger.fromOptions({
      debug: true,
      debugRedact: false,
      debugSink: () => undefined,
    });
    expect(logger.isRedacting()).toBe(false);
  });

  it('requires a destination when debug is on', () => {
    expect(() => DebugLogger.fromOptions({ debug: true })).toThrow(VrioError);
    expect(() => DebugLogger.fromOptions({ debug: true })).toThrow(/debugFile/);
  });

  it('rejects a non-callable sink', () => {
    // Deliberately bypassing the type to reproduce a JS consumer's mistake.
    const options = { debug: true, debugSink: 'nope' } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
    expect(() => DebugLogger.fromOptions(options)).toThrow(/callable/);
  });

  it('rejects an unrecognised timezone', () => {
    expect(() =>
      DebugLogger.fromOptions({ debug: true, debugSink: () => undefined, debugTimezone: 'Not/AZone' }),
    ).toThrow(/IANA/);
  });

  it('does not require a destination when debug is off', () => {
    expect(() => DebugLogger.fromOptions({ debug: false, debugRedact: false })).not.toThrow();
  });

  describe('the debug option: PHP empty() falsy set, not JS truthiness', () => {
    // Measured against the running PHP package: `!empty($options['debug'])`
    // treats the string "0" as false. `Boolean("0")` is `true` in
    // JavaScript, so a naive `!!options.debug` would turn an operator's
    // `debug: process.env.DEBUG` with `DEBUG=0` (meant as "off") into debug
    // logging that writes headers and bodies to disk — the worst option bug
    // available in this package.
    it.each([
      ['0', false],
      ['', false],
      ['false', true], // non-empty string: truthy in PHP, logging ON
      [0, false],
      [1, true],
      [true, true],
      [false, false],
      [undefined, false],
    ] as const)('debug: %p -> enabled %p', (value, expected) => {
      const options = { debug: value, debugSink: () => undefined } as unknown as Parameters<
        typeof DebugLogger.fromOptions
      >[0];
      expect(DebugLogger.fromOptions(options).isEnabled()).toBe(expected);
    });
  });

  describe('other option semantics measured against the PHP package', () => {
    it('accepts a numeric debugFile, cast to a string', () => {
      const options = { debug: true, debugFile: 12345 } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(() => DebugLogger.fromOptions(options)).not.toThrow();
    });

    it('accepts a boolean debugFile, cast to "1"', () => {
      const options = { debug: true, debugFile: true } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(() => DebugLogger.fromOptions(options)).not.toThrow();
    });

    it('rejects a whitespace-only debugFile', () => {
      expect(() => DebugLogger.fromOptions({ debug: true, debugFile: '   ' })).toThrow(/debugFile/);
    });

    it('accepts a numeric string debugRetentionDays', () => {
      const options = {
        debug: true,
        debugSink: () => undefined,
        debugRetentionDays: '3',
      } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(() => DebugLogger.fromOptions(options)).not.toThrow();
    });

    it('falls back to the default retention when debugRetentionDays is a boolean', () => {
      // is_numeric(bool) is false in PHP, so this falls back to 7 rather
      // than becoming 1.
      const options = {
        debug: true,
        debugSink: () => undefined,
        debugRetentionDays: true,
      } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(() => DebugLogger.fromOptions(options)).not.toThrow();
    });

    it('rejects a numeric debugTimezone as an unrecognised IANA identifier', () => {
      const options = {
        debug: true,
        debugSink: () => undefined,
        debugTimezone: 123,
      } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(() => DebugLogger.fromOptions(options)).toThrow(/IANA/);
    });

    it('treats debugRedact: 0 as false', () => {
      const options = {
        debug: true,
        debugSink: () => undefined,
        debugRedact: 0,
      } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(DebugLogger.fromOptions(options).isRedacting()).toBe(false);
    });

    it('treats debugRedact: "false" as true (a non-empty string is truthy in PHP)', () => {
      const options = {
        debug: true,
        debugSink: () => undefined,
        debugRedact: 'false',
      } as unknown as Parameters<typeof DebugLogger.fromOptions>[0];
      expect(DebugLogger.fromOptions(options).isRedacting()).toBe(true);
    });
  });
});

describe('DebugLogger.format', () => {
  it('renders a copy-pasteable curl command with the response beneath', () => {
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');
    const entry = logger.format(
      postRequest('{"email":"buyer@example.test"}'),
      new Response(201, '{"id":"ord_1"}', { http_code: 201 }),
    );

    expect(entry).toContain("curl --location --request POST 'https://api.vrio.app/orders' \\");
    expect(entry).toContain("  --header 'Content-Type: application/json' \\");
    expect(entry).toContain("  --header 'X-Api-Key: [REDACTED]' \\");
    expect(entry).toContain('  --data \'{"email":"buyer@example.test"}\'');
    expect(entry).toContain('# Response: HTTP 201');
    expect(entry).toContain('{"id":"ord_1"}');
  });

  it('masks the api key and the card fields but not the url', () => {
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');
    const entry = logger.format(
      postRequest('{"card":{"number":"4111111111111111","cvv":"123"}}'),
      new Response(200, '{"access_token":"secret-value"}'),
    );

    expect(entry).not.toContain(KEY);
    expect(entry).not.toContain('4111111111111111');
    expect(entry).not.toContain('secret-value');
    expect(entry).toContain('https://api.vrio.app/orders');
  });

  it('logs verbatim when redaction is off', () => {
    const logger = new DebugLogger(true, false, () => undefined, 'UTC');
    const entry = logger.format(postRequest('{"password":"hunter2"}'), new Response(200, '{}'));

    expect(entry).toContain(KEY);
    expect(entry).toContain('hunter2');
  });

  it('escapes a single quote in the body', () => {
    const logger = new DebugLogger(true, false, () => undefined, 'UTC');
    const entry = logger.format(postRequest('{"note":"it\'s here"}'), new Response(200, '{}'));
    expect(entry).toContain("'\\''");
  });

  it('omits the data line for a request with no body', () => {
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');
    const request = new Request('GET', 'https://api.vrio.app/orders', ['hostname: api.vrio.app']);
    const entry = logger.format(request, new Response(200, '{}'));

    expect(entry).not.toContain('--data');
    expect(entry).toContain("  --header 'hostname: api.vrio.app'");
    expect(entry).not.toContain("  --header 'hostname: api.vrio.app' \\");
  });

  it('reports a transport error instead of a status line', () => {
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');
    const entry = logger.format(postRequest('{}'), new Response(0, '', {}, 'connection refused'));

    expect(entry).toContain('# Transport error: connection refused');
    expect(entry).not.toContain('# Response: HTTP');
  });

  it('stamps the entry in the configured timezone', () => {
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');
    const entry = logger.format(postRequest('{}'), new Response(200, '{}'));
    expect(entry).toMatch(/^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6} UTC\]/);
  });

  // The four vectors below are measured verbatim from the running PHP
  // package (.superpowers/sdd/2026-09-08-vrio-client-node-port/php-logger-vectors.txt),
  // with only the timestamp line stripped before comparison.
  describe('matches the PHP package byte-for-byte, timestamp aside', () => {
    it('a redacted POST with a body', () => {
      const logger = new DebugLogger(true, true, () => undefined, 'UTC');
      const entry = logger.format(
        postRequest('{"email":"buyer@example.test"}'),
        new Response(201, '{"id":"ord_1"}', { http_code: 201 }),
      );

      expect(withoutTimestamp(entry)).toBe(
        [
          "curl --location --request POST 'https://api.vrio.app/orders' \\",
          "  --header 'Content-Type: application/json' \\",
          "  --header 'hostname: api.vrio.app' \\",
          "  --header 'X-Api-Key: [REDACTED]' \\",
          '  --data \'{"email":"buyer@example.test"}\'',
          '',
          '# Response: HTTP 201',
          '{"id":"ord_1"}',
          '',
          '',
        ].join('\n'),
      );
    });

    it('a GET with no body', () => {
      const logger = new DebugLogger(true, true, () => undefined, 'UTC');
      const entry = logger.format(
        new Request('GET', 'https://api.vrio.app/orders?with=items', ['hostname: api.vrio.app']),
        new Response(200, '[]', { http_code: 200 }),
      );

      expect(withoutTimestamp(entry)).toBe(
        [
          "curl --location --request GET 'https://api.vrio.app/orders?with=items' \\",
          "  --header 'hostname: api.vrio.app'",
          '',
          '# Response: HTTP 200',
          '[]',
          '',
          '',
        ].join('\n'),
      );
    });

    it('a transport error', () => {
      const logger = new DebugLogger(true, true, () => undefined, 'UTC');
      const entry = logger.format(postRequest('[]'), new Response(0, '', {}, 'connection refused'));

      expect(withoutTimestamp(entry)).toBe(
        [
          "curl --location --request POST 'https://api.vrio.app/orders' \\",
          "  --header 'Content-Type: application/json' \\",
          "  --header 'hostname: api.vrio.app' \\",
          "  --header 'X-Api-Key: [REDACTED]' \\",
          "  --data '[]'",
          '',
          '# Transport error: connection refused',
          '',
          '',
        ].join('\n'),
      );
    });

    it('quote-escaping with redaction off', () => {
      const logger = new DebugLogger(true, false, () => undefined, 'UTC');
      const entry = logger.format(postRequest('{"note":"it\'s here"}'), new Response(200, '{}'));

      expect(withoutTimestamp(entry)).toBe(
        [
          "curl --location --request POST 'https://api.vrio.app/orders' \\",
          "  --header 'Content-Type: application/json' \\",
          "  --header 'hostname: api.vrio.app' \\",
          `  --header 'X-Api-Key: ${KEY}' \\`,
          "  --data '{\"note\":\"it'\\''s here\"}'",
          '',
          '# Response: HTTP 200',
          '{}',
          '',
          '',
        ].join('\n'),
      );
    });
  });
});

describe('DebugLogger.log', () => {
  it('writes nothing when disabled', async () => {
    const sink = vi.fn();
    const logger = new DebugLogger(false, true, sink, 'UTC');
    await logger.log(postRequest('{}'), new Response(200, '{}'));
    expect(sink).not.toHaveBeenCalled();
  });

  it('passes the formatted entry to the sink', async () => {
    const sink = vi.fn();
    const logger = new DebugLogger(true, true, sink, 'UTC');
    await logger.log(postRequest('{}'), new Response(200, '{}'));
    expect(sink).toHaveBeenCalledOnce();
    expect(sink.mock.calls[0]![0]).toContain('curl --location --request POST');
  });

  it('swallows a synchronous failure inside the sink', async () => {
    const logger = new DebugLogger(
      true,
      true,
      () => {
        throw new Error('sink exploded');
      },
      'UTC',
    );
    await expect(logger.log(postRequest('{}'), new Response(200, '{}'))).resolves.toBeUndefined();
  });

  it('swallows a rejected promise from the sink', async () => {
    const logger = new DebugLogger(true, true, () => Promise.reject(new Error('async boom')), 'UTC');
    await expect(logger.log(postRequest('{}'), new Response(200, '{}'))).resolves.toBeUndefined();
  });

  it('serializes concurrent writes in call order', async () => {
    const seen: string[] = [];
    const logger = new DebugLogger(
      true,
      true,
      async entry => {
        // A slow first write must still land first.
        await new Promise(resolve => setTimeout(resolve, seen.length === 0 ? 20 : 0));
        seen.push(entry.includes('/orders/first') ? 'first' : 'second');
      },
      'UTC',
    );

    await Promise.all([
      logger.log(new Request('GET', 'https://api.vrio.app/orders/first'), new Response(200, '{}')),
      logger.log(new Request('GET', 'https://api.vrio.app/orders/second'), new Response(200, '{}')),
    ]);
    await logger.flush();

    expect(seen).toEqual(['first', 'second']);
  });

  it('swallows a synchronous failure inside format() itself, before the sink is ever reached', async () => {
    const sink = vi.fn();
    const logger = new DebugLogger(true, true, sink, 'UTC');
    // Stub the instance's own `format` at runtime to throw, proving `log()`
    // guards formatting and not just the sink call — a type-level argument
    // cannot demonstrate this, since `format()` cannot throw today given
    // its current implementation.
    vi.spyOn(logger, 'format').mockImplementation(() => {
      throw new Error('format exploded');
    });

    await expect(logger.log(postRequest('{}'), new Response(200, '{}'))).resolves.toBeUndefined();
    expect(sink).not.toHaveBeenCalled();
  });

  it('does not mutate the request or response it observes', async () => {
    const request = postRequest('{"password":"hunter2"}');
    const response = new Response(200, '{"access_token":"secret-value"}');
    const logger = new DebugLogger(true, true, () => undefined, 'UTC');

    await logger.log(request, response);

    expect(request.getBody()).toBe('{"password":"hunter2"}');
    expect(request.getHeaders()).toContain(`X-Api-Key: ${KEY}`);
    expect(response.getBody()).toBe('{"access_token":"secret-value"}');
  });
});
