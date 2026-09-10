/**
 * Masks credentials and sensitive fields in copies of request headers and
 * bodies, for the opt-in debug log.
 *
 * Every method here returns a new value; nothing is mutated in place. The
 * redacted text this class produces exists only inside a log entry — it can
 * never be what is actually sent on the wire or returned to the caller,
 * because it is always computed from a copy, after the real request has
 * already been built and dispatched.
 *
 * Scope note: this redacts headers and bodies only. The request URL is
 * logged verbatim by design, so anything the API accepts as a query
 * parameter or path segment is recorded in the debug log as-is.
 */
export class Redactor {
  /**
   * Replacement written in place of a sensitive value.
   */
  public static readonly MASK = '[REDACTED]';

  /**
   * Placeholder used when a body cannot be parsed and therefore cannot be
   * field-masked. Masking it wholesale is the safe direction.
   */
  public static readonly UNPARSEABLE = '[REDACTED: body is not JSON]';

  /**
   * Header names whose value is replaced entirely.
   *
   * Compared after normalisation (lowercased, separators stripped).
   */
  private static readonly SENSITIVE_HEADERS: readonly string[] = Object.freeze([
    'apikey',
    'xapikey',
    'xauthtoken',
    'xaccesstoken',
    'xsessiontoken',
    'cookie',
    'setcookie',
  ] as const);

  /**
   * Header names whose value keeps its scheme, e.g. `"Bearer [REDACTED]"`.
   */
  private static readonly SCHEME_PRESERVING_HEADERS: readonly string[] = Object.freeze([
    'authorization',
    'proxyauthorization',
  ] as const);

  /**
   * Body keys whose value is replaced entirely.
   *
   * Compared after normalisation (lowercased, separators stripped).
   */
  private static readonly SENSITIVE_KEYS: readonly string[] = Object.freeze([
    // Credentials
    'apikey',
    'xapikey',
    'apisecret',
    'secret',
    'clientsecret',
    'password',
    'passwd',
    'pwd',
    'passphrase',
    'signature',
    'auth',
    'authorization',
    // Tokens
    'token',
    'accesstoken',
    'refreshtoken',
    'idtoken',
    'bearertoken',
    'sessiontoken',
    'paymenttoken',
    'paymenttokenid',
    'carttoken',
    // Cardholder data
    'cardnumber',
    'cardno',
    'ccnumber',
    'creditcard',
    'creditcardnumber',
    'pan',
    'cvv',
    'cvv2',
    'cvc',
    'cvc2',
    'csc',
    'cardcode',
    'securitycode',
    'expmonth',
    'expyear',
    'expirationmonth',
    'expirationyear',
    'expirationdate',
    'expirydate',
    'cardexpiry',
    // Bank data
    'accountnumber',
    'bankaccount',
    'bankaccountnumber',
    'routingnumber',
    'aba',
    'abanumber',
    'iban',
    'swift',
    'swiftcode',
    'sortcode',
    // Government / identity data
    'ssn',
    'socialsecuritynumber',
    'taxid',
    'ein',
    'nationalid',
    'passportnumber',
    'driverslicense',
    'driverslicensenumber',
    'dob',
    'dateofbirth',
    'birthdate',
  ] as const);

  /**
   * Parent keys under which otherwise-generic child keys become sensitive.
   *
   * Catches shapes like `{"card": {"number": "...", "cvv": "..."}}` where
   * the child key alone would be too generic to mask safely.
   */
  private static readonly SENSITIVE_PARENTS: readonly string[] = Object.freeze([
    'card',
    'creditcard',
    'debitcard',
    'paymentcard',
    'paymentmethod',
    'paymentsource',
    'bankaccount',
    'ach',
    'billingsource',
  ] as const);

  /**
   * Child keys masked when nested under one of {@link Redactor.SENSITIVE_PARENTS}.
   */
  private static readonly SENSITIVE_CHILDREN: readonly string[] = Object.freeze([
    'number',
    'code',
    'month',
    'year',
    'expiry',
    'expiration',
    'last4',
  ] as const);

  /**
   * Redact a set of raw `"Name: value"` header lines.
   *
   * @param headers Header lines to redact. Not modified.
   * @returns A new array of redacted header lines; the input is untouched.
   */
  public redactHeaders(headers: readonly string[]): string[] {
    return headers.map(line => this.redactHeaderLine(line));
  }

  /**
   * Redact a JSON body.
   *
   * A body that is not decodable JSON cannot be field-masked, so it is
   * replaced wholesale rather than logged on the chance it is harmless.
   *
   * @param body Raw request or response body. Not modified.
   * @returns A new string (or `null`); the input is untouched. `null` and
   *   whitespace-only or empty bodies pass through unchanged.
   */
  public redactBody(body: string | null): string | null {
    if (body === null || body.trim() === '') {
      return body;
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(body) as unknown;
    } catch {
      return Redactor.UNPARSEABLE;
    }

    const clean = this.redactValue(decoded, null);

    // Deliberate divergence from the PHP (documented, not a bug to fix):
    // PHP decodes with `json_decode($body, true)`, which has no separate
    // representation for an empty JSON object — `{}` decodes to the same
    // empty PHP array as `[]` — so the PHP redactor's `json_encode` rewrites
    // an empty object back out as `[]`. Combined with integer-like keys (see
    // the comment in `redactValue` below), this means the PHP redactor also
    // re-encodes `{"card":{"0":{...}}}` as `{"card":[{...}]}`. That is a bug
    // in the PHP client: its own `encodeFields()` sends a literal `{}` (or a
    // JSON object with numeric-looking keys) on the wire, so the PHP debug
    // log ends up printing a shape that does not match what was actually
    // sent. `JSON.stringify` has no such ambiguity: an object decoded by
    // `JSON.parse` stays an object. This port keeps the object shape so the
    // Node debug log reflects the real wire body instead of the PHP's
    // mislabelled one.
    //
    // JSON.stringify only fails to produce a string for `undefined`,
    // functions, or symbols. `clean` is built entirely from JSON.parse
    // output plus string literals, so it can never contain any of those.
    return JSON.stringify(clean);
  }

  /**
   * Redact one header line, preserving the scheme on Authorization-like
   * headers.
   */
  private redactHeaderLine(line: string): string {
    const separator = line.indexOf(':');
    if (separator === -1) {
      return line;
    }

    const name = line.slice(0, separator);
    const value = line.slice(separator + 1);
    const normalised = this.normalise(name);

    if (Redactor.SCHEME_PRESERVING_HEADERS.includes(normalised)) {
      const trimmed = value.trim();
      const space = trimmed.indexOf(' ');
      const masked = space === -1 ? Redactor.MASK : `${trimmed.slice(0, space)} ${Redactor.MASK}`;

      return `${name}: ${masked}`;
    }

    if (Redactor.SENSITIVE_HEADERS.includes(normalised)) {
      return `${name}: ${Redactor.MASK}`;
    }

    return line;
  }

  /**
   * Recursively mask sensitive entries in a decoded JSON value.
   *
   * The array branch passes `parentKey` through unchanged rather than
   * resetting it, matching the PHP: `{"card": [{"number": "..."}]}` still
   * masks `number`, because the object nested inside the array is still
   * conceptually a child of `card`.
   *
   * @param value Decoded JSON value (or a subtree of one).
   * @param parentKey Normalised key of the containing object, or `null` at
   *   the root or inside an array whose own parent had none.
   */
  private redactValue(value: unknown, parentKey: string | null): unknown {
    if (Array.isArray(value)) {
      const items: unknown[] = value;

      return items.map(item => this.redactValue(item, parentKey));
    }

    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const result: Record<string, unknown> = {};

      for (const [key, item] of entries) {
        // Deliberate divergence from the PHP (documented, not a bug to fix):
        // PHP decodes a JSON object with `json_decode($body, true)`, which
        // coerces any object key that is a canonical decimal integer (`"0"`,
        // `"2"`, `"-1"`, but not `"01"` or `"1.5"`) into a PHP integer array
        // key. PHP's `redactValue` then takes an `is_string($key)` branch:
        // such a key is never itself checked against `isSensitiveKey`, and
        // the recursive call passes `$parentKey` through UNCHANGED instead
        // of normalising the key. The practical effect is that a numeric
        // index does not break the parent/child chain — inside
        // `{"card":{"0":{"month":"01"}}}` the parent context is still
        // `card` one level down, so `month` is still masked as a
        // SENSITIVE_CHILDREN entry.
        //
        // `Object.entries` always hands back string keys, with no PHP-style
        // int coercion, so this port detects the same class of key
        // explicitly and mirrors both effects (skip the sensitive-key check
        // for it, inherit `parentKey` unchanged) without adopting the PHP's
        // *other* effect of that coercion — re-encoding the object as a
        // JSON array. That re-encoding is the same `{}`-to-`[]` quirk
        // documented in `redactBody` above, and this port does not
        // replicate it: the object shape is kept, only the values are
        // masked.
        const isIntegerLikeKey = /^(0|-?[1-9]\d*)$/.test(key);

        if (!isIntegerLikeKey && this.isSensitiveKey(key, parentKey)) {
          result[key] = Redactor.MASK;
          continue;
        }

        result[key] = this.redactValue(item, isIntegerLikeKey ? parentKey : this.normalise(key));
      }

      return result;
    }

    if (typeof value === 'string' && this.looksLikeCardNumber(value)) {
      return Redactor.MASK;
    }

    return value;
  }

  /**
   * @param key Raw, unnormalised key.
   * @param parentKey Already-normalised parent key, or `null`.
   */
  private isSensitiveKey(key: string, parentKey: string | null): boolean {
    const normalised = this.normalise(key);

    if (Redactor.SENSITIVE_KEYS.includes(normalised)) {
      return true;
    }

    return (
      parentKey !== null &&
      Redactor.SENSITIVE_PARENTS.includes(parentKey) &&
      Redactor.SENSITIVE_CHILDREN.includes(normalised)
    );
  }

  /**
   * Catch card numbers that arrive under an unexpected key name.
   *
   * Requires both a plausible PAN length and a valid Luhn check digit, which
   * keeps ordinary numeric identifiers out of the match.
   */
  private looksLikeCardNumber(value: string): boolean {
    const digits = value.replace(/[ -]/g, '');
    if (!/^\d{13,19}$/.test(digits)) {
      return false;
    }

    let sum = 0;
    let double = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = Number(digits.charAt(i));
      if (double) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      sum += digit;
      double = !double;
    }

    return sum % 10 === 0;
  }

  /**
   * Lowercase and strip separators so `"X-Api-Key"`, `"api_key"` and
   * `"apiKey"` all compare equal.
   */
  private normalise(name: string): string {
    return name
      .trim()
      .replace(/[-_ .]/g, '')
      .toLowerCase();
  }
}
