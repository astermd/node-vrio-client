import { describe, expect, it } from 'vitest';
import { Redactor } from '../../src/logging/redactor.js';

const redactor = new Redactor();

describe('Redactor headers', () => {
  it('masks the api key header', () => {
    expect(redactor.redactHeaders(['X-Api-Key: real-key-value'])).toEqual(['X-Api-Key: [REDACTED]']);
  });

  it('keeps the scheme on an authorization header', () => {
    expect(redactor.redactHeaders(['Authorization: Bearer abc.def'])).toEqual(['Authorization: Bearer [REDACTED]']);
  });

  it('masks an authorization header with no scheme entirely', () => {
    expect(redactor.redactHeaders(['Authorization: abcdef'])).toEqual(['Authorization: [REDACTED]']);
  });

  it('masks a proxy authorization header', () => {
    expect(redactor.redactHeaders(['Proxy-Authorization: Basic abc'])).toEqual([
      'Proxy-Authorization: Basic [REDACTED]',
    ]);
  });

  it('masks a cookie header', () => {
    expect(redactor.redactHeaders(['Cookie: session=abc'])).toEqual(['Cookie: [REDACTED]']);
  });

  it('leaves an unremarkable header alone', () => {
    expect(redactor.redactHeaders(['Content-Type: application/json'])).toEqual(['Content-Type: application/json']);
  });

  it('leaves a line with no separator alone', () => {
    expect(redactor.redactHeaders(['no-separator-here'])).toEqual(['no-separator-here']);
  });

  it('leaves a benign hostname header alone', () => {
    expect(redactor.redactHeaders(['hostname: api.vrio.app'])).toEqual(['hostname: api.vrio.app']);
  });

  it('normalises the header name so separators and case do not matter', () => {
    expect(redactor.redactHeaders(['x_api_key: real-key-value'])).toEqual(['x_api_key: [REDACTED]']);
  });

  it('does not mutate the input array or its strings', () => {
    const headers = ['X-Api-Key: real-key-value'];
    const original = headers[0];
    const redacted = redactor.redactHeaders(headers);

    expect(headers).toEqual(['X-Api-Key: real-key-value']);
    expect(headers[0]).toBe(original);
    expect(redacted).not.toBe(headers);
  });
});

describe('Redactor bodies', () => {
  it('returns null unchanged', () => {
    expect(redactor.redactBody(null)).toBeNull();
  });

  it('returns a whitespace-only body unchanged', () => {
    expect(redactor.redactBody('   ')).toBe('   ');
  });

  it('returns an empty body unchanged', () => {
    expect(redactor.redactBody('')).toBe('');
  });

  it('replaces a body that is not json', () => {
    expect(redactor.redactBody('<html>nope</html>')).toBe('[REDACTED: body is not JSON]');
  });

  it('masks a password field', () => {
    expect(redactor.redactBody('{"password":"hunter2"}')).toBe('{"password":"[REDACTED]"}');
  });

  it.each(['api_key', 'apiKey', 'API-KEY'])('masks the %s key however it is spelled', key => {
    expect(redactor.redactBody(JSON.stringify({ [key]: 'v' }))).toContain('[REDACTED]');
  });

  it('masks a snake_case api key field, matching the measured vector', () => {
    expect(redactor.redactBody('{"api_key":"secret-value"}')).toBe('{"api_key":"[REDACTED]"}');
  });

  it('masks a camelCase api key field, matching the measured vector', () => {
    expect(redactor.redactBody('{"apiKey":"secret-value"}')).toBe('{"apiKey":"[REDACTED]"}');
  });

  it('masks an upper-cased, hyphenated api key field, matching the measured vector', () => {
    expect(redactor.redactBody('{"API-KEY":"secret-value"}')).toBe('{"API-KEY":"[REDACTED]"}');
  });

  it('masks every token-shaped key', () => {
    const body = JSON.stringify({ access_token: 'a', refresh_token: 'b', cart_token: 'c' });
    const result = redactor.redactBody(body);
    expect(result).not.toContain('"a"');
    expect(result).not.toContain('"b"');
    expect(result).not.toContain('"c"');
  });

  it('masks the exact token vector', () => {
    const body = '{"access_token":"a","refresh_token":"b","cart_token":"c"}';
    expect(redactor.redactBody(body)).toBe(
      '{"access_token":"[REDACTED]","refresh_token":"[REDACTED]","cart_token":"[REDACTED]"}',
    );
  });

  it('masks a generic child key under a card parent', () => {
    const body = JSON.stringify({ card: { number: '4111111111111111', cvv: '123', month: '01' } });
    expect(redactor.redactBody(body)).toBe('{"card":{"number":"[REDACTED]","cvv":"[REDACTED]","month":"[REDACTED]"}}');
  });

  it('leaves a brand field under a card parent alone (not a sensitive child)', () => {
    const body = '{"card":{"number":"4111111111111111","cvv":"123","month":"12","brand":"visa"}}';
    expect(redactor.redactBody(body)).toBe(
      '{"card":{"number":"[REDACTED]","cvv":"[REDACTED]","month":"[REDACTED]","brand":"visa"}}',
    );
  });

  it('leaves the same generic key alone outside a card parent', () => {
    expect(redactor.redactBody('{"order":{"number":"ord_1"}}')).toBe('{"order":{"number":"ord_1"}}');
  });

  it('masks a luhn-valid card number under an unexpected key', () => {
    expect(redactor.redactBody('{"note":"4111111111111111"}')).toBe('{"note":"[REDACTED]"}');
  });

  it('masks a luhn-valid card number written with spaces', () => {
    expect(redactor.redactBody('{"note":"4111 1111 1111 1111"}')).toBe('{"note":"[REDACTED]"}');
  });

  it('leaves an ordinary long identifier alone when luhn fails', () => {
    expect(redactor.redactBody('{"note":"1234567890123"}')).toBe('{"note":"1234567890123"}');
  });

  it('leaves a long number that fails luhn alone, matching the measured vector', () => {
    expect(redactor.redactBody('{"reference":"1234567890123456"}')).toBe('{"reference":"1234567890123456"}');
  });

  it('recurses into arrays', () => {
    const body = JSON.stringify({ items: [{ cvv: '123' }, { sku: 'ok' }] });
    expect(redactor.redactBody(body)).toBe('{"items":[{"cvv":"[REDACTED]"},{"sku":"ok"}]}');
  });

  it('inspects values inside a plain list', () => {
    expect(redactor.redactBody('{"cards":["4111111111111111","plain"]}')).toBe('{"cards":["[REDACTED]","plain"]}');
  });

  it('passes the parent key through the array branch (card object nested in an array)', () => {
    // This is the key proof that the array branch does not reset parentKey:
    // "number" is only masked here because it is still considered a child
    // of "card", even though it sits inside an array element.
    expect(redactor.redactBody('{"card":[{"number":"4111111111111111"}]}')).toBe('{"card":[{"number":"[REDACTED]"}]}');
  });

  it('does not escape slashes, matching the php encoder flags', () => {
    expect(redactor.redactBody('{"return_url":"https://example.test/done"}')).toBe(
      '{"return_url":"https://example.test/done"}',
    );
  });

  it('does not escape slashes in a vrio.app url', () => {
    expect(redactor.redactBody('{"url":"https://api.vrio.app/orders"}')).toBe('{"url":"https://api.vrio.app/orders"}');
  });

  it('keeps a non-ascii value unescaped', () => {
    expect(redactor.redactBody('{"name":"Zoë"}')).toBe('{"name":"Zoë"}');
  });

  it('masks a nested sensitive key several levels deep, leaving siblings alone', () => {
    expect(redactor.redactBody('{"a":{"b":{"password":"hunter2","keep":"y"}}}')).toBe(
      '{"a":{"b":{"password":"[REDACTED]","keep":"y"}}}',
    );
  });

  it('masks nested sensitive keys alongside an untouched sibling', () => {
    expect(redactor.redactBody('{"customer":{"ssn":"000-00-0000","first_name":"Ada"}}')).toBe(
      '{"customer":{"ssn":"[REDACTED]","first_name":"Ada"}}',
    );
  });

  it('masks government identifiers', () => {
    const body = JSON.stringify({ ssn: '1', tax_id: '2', date_of_birth: '3' });
    const result = redactor.redactBody(body);
    expect(result).not.toContain('"1"');
    expect(result).not.toContain('"2"');
    expect(result).not.toContain('"3"');
  });

  it('masks the exact government id vector', () => {
    expect(redactor.redactBody('{"ssn":"1","tax_id":"2","date_of_birth":"3"}')).toBe(
      '{"ssn":"[REDACTED]","tax_id":"[REDACTED]","date_of_birth":"[REDACTED]"}',
    );
  });

  it('masks bank identifiers', () => {
    const body = JSON.stringify({ routing_number: '1', iban: '2', account_number: '3' });
    const result = redactor.redactBody(body);
    expect(result).not.toContain('"1"');
    expect(result).not.toContain('"2"');
    expect(result).not.toContain('"3"');
  });

  it('masks the exact bank id vector', () => {
    expect(redactor.redactBody('{"routing_number":"1","iban":"2","account_number":"3"}')).toBe(
      '{"routing_number":"[REDACTED]","iban":"[REDACTED]","account_number":"[REDACTED]"}',
    );
  });

  it('masks bank and token fields together', () => {
    const body = '{"routing_number":"110000000","account_number":"1234","refresh_token":"rt-placeholder"}';
    expect(redactor.redactBody(body)).toBe(
      '{"routing_number":"[REDACTED]","account_number":"[REDACTED]","refresh_token":"[REDACTED]"}',
    );
  });

  it('masks credentials in a body while leaving an email address alone', () => {
    const body = '{"apiKey":"live-key-placeholder","email":"buyer@example.test"}';
    expect(redactor.redactBody(body)).toBe('{"apiKey":"[REDACTED]","email":"buyer@example.test"}');
  });

  describe('non-object JSON scalars pass through', () => {
    it('leaves a JSON null scalar as-is', () => {
      expect(redactor.redactBody('null')).toBe('null');
    });

    it('leaves a JSON boolean scalar as-is', () => {
      expect(redactor.redactBody('true')).toBe('true');
    });

    it('leaves a JSON string scalar as-is', () => {
      expect(redactor.redactBody('"str"')).toBe('"str"');
    });

    it('leaves a JSON number scalar as-is', () => {
      expect(redactor.redactBody('42')).toBe('42');
    });
  });

  describe('deliberate divergence from the PHP: empty objects stay objects', () => {
    // PHP decodes JSON with `json_decode($body, true)`, which has no separate
    // representation for an empty object: `{}` decodes to the same empty PHP
    // array as `[]`, so the PHP redactor re-encodes an empty object as `[]`.
    // That is a bug in the PHP client: `encodeFields()` sends a literal `{}`
    // body for an empty payload, so the PHP client's own debug log ends up
    // printing `--data '[]'` for a request that actually carried `{}` on the
    // wire — the log misrepresents what was sent.
    //
    // `JSON.parse`/`JSON.stringify` do not share this ambiguity: an object
    // decodes to a JS object and stays one. This port deliberately does NOT
    // replicate the PHP's behaviour here, so the Node debug log matches the
    // real wire body instead of matching PHP's mislabelled one.
    it('keeps an empty object as an object at the top level', () => {
      expect(redactor.redactBody('{}')).toBe('{}');
    });

    it('keeps a nested empty object as an object', () => {
      expect(redactor.redactBody('{"a":{}}')).toBe('{"a":{}}');
    });

    it('keeps a real empty array as an array', () => {
      expect(redactor.redactBody('[]')).toBe('[]');
    });
  });

  describe('PHP-integer-coerced object keys still inherit the parent context', () => {
    // PHP's json_decode(..., true) coerces a canonical-decimal-integer JSON
    // object key ("0", "2", ...) into a PHP integer array key. PHP's
    // redactValue then skips the sensitive-key check for that key and
    // passes $parentKey through UNCHANGED rather than normalising it, so a
    // numeric index does not break the parent/child chain. Object.entries
    // never hands back anything but string keys, so this behaviour has to
    // be reproduced explicitly - see the comment on the integer-like-key
    // check in redactValue.
    it('masks card expiry fields nested under a numeric index', () => {
      expect(redactor.redactBody('{"card":{"0":{"month":"01","year":"2030"}}}')).toBe(
        '{"card":{"0":{"month":"[REDACTED]","year":"[REDACTED]"}}}',
      );
    });

    it('keeps inheriting the parent through two nested numeric indices', () => {
      expect(redactor.redactBody('{"card":{"0":{"1":{"month":"01"}}}}')).toBe(
        '{"card":{"0":{"1":{"month":"[REDACTED]"}}}}',
      );
    });

    it('masks a payment-method code nested under a numeric index', () => {
      expect(redactor.redactBody('{"paymentmethod":{"0":{"code":"123"}}}')).toBe(
        '{"paymentmethod":{"0":{"code":"[REDACTED]"}}}',
      );
    });

    it('still masks a directly sensitive key (cvv) sitting under a numeric root index', () => {
      expect(redactor.redactBody('{"0":{"cvv":"123"}}')).toBe('{"0":{"cvv":"[REDACTED]"}}');
    });

    it('keeps the object shape rather than re-encoding a numeric-keyed object as an array', () => {
      // The PHP would re-encode this as {"card":[{"month":"[REDACTED]"}]} -
      // the same {}-to-[] quirk this port does not replicate.
      expect(redactor.redactBody('{"card":{"0":{"month":"01"}}}')).toBe('{"card":{"0":{"month":"[REDACTED]"}}}');
    });

    it('still masks through the array branch (already-correct case, guarding against regression)', () => {
      expect(redactor.redactBody('{"card":[{"month":"01"}]}')).toBe('{"card":[{"month":"[REDACTED]"}]}');
    });
  });

  it('masks the whole subtree when a sensitive key maps to an object rather than a scalar', () => {
    // Verified against the PHP: it masks the value wholesale rather than
    // walking into it, because isSensitiveKey short-circuits before
    // recursion happens.
    expect(redactor.redactBody('{"card":{"number":{"nested":"x"}}}')).toBe('{"card":{"number":"[REDACTED]"}}');
  });

  it('masks a bare JSON string body that is itself a luhn-valid PAN', () => {
    expect(redactor.redactBody('"4111111111111111"')).toBe('"[REDACTED]"');
  });

  it('does not mutate the input body string', () => {
    const body = '{"apiKey":"live-key-placeholder"}';
    redactor.redactBody(body);
    expect(body).toBe('{"apiKey":"live-key-placeholder"}');
  });
});
