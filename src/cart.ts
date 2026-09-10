import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Cart and payment-token endpoints.
 *
 * A cart holds the offers a customer intends to buy before they become an
 * order. This resource also covers the PayPal payment tokens issued against
 * a cart, which the storefront's checkout flow exchanges for authorization.
 *
 * Cart and payment tokens appear in the request path, not only the body.
 * Because debug logging records the URL verbatim, those identifiers are
 * written to the log even when redaction is on — see the README for how
 * debug logging treats them.
 */
export class Cart extends Vrio {
  /**
   * Create a cart.
   *
   * `POST /carts`
   *
   * @param params Request body fields; see the API reference in your
   *               AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   */
  public createCart(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendPost('carts', params);
  }

  /**
   * Create a PayPal payment token for a cart.
   *
   * `POST /carts/{cart_token}/payment_tokens`
   *
   * The identifier is read out of `params` rather than taken positionally,
   * because that is the shape the API accepts and the PHP client established.
   * It is left in the body as well, so the provider sees the same payload
   * from both clients.
   *
   * @param params Request body fields; must include `cart_token`.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When `cart_token` is absent or not a scalar.
   */
  public createPaypalToken(params: Record<string, unknown> = {}): RequestSpec {
    const cartToken = Cart.identifier(params, 'cart_token');
    if (cartToken === '') {
      this.requiredFields();
    }

    return this.sendPost(`carts/${cartToken}/payment_tokens`, params);
  }

  /**
   * Retrieve a PayPal payment token for a cart.
   *
   * `GET /carts/{cart_token}/payment_tokens/{payment_token_id}`
   *
   * Both identifiers are read out of `params` and placed in the path only;
   * this request is sent with no query string at all.
   *
   * @param params Must include `cart_token` and `payment_token_id`.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When either identifier is absent or not a scalar.
   */
  public getPaypalData(params: Record<string, unknown> = {}): RequestSpec {
    const cartToken = Cart.identifier(params, 'cart_token');
    const paymentTokenId = Cart.identifier(params, 'payment_token_id');

    if (cartToken === '' || paymentTokenId === '') {
      this.requiredFields();
    }

    return this.sendGet(`carts/${cartToken}/payment_tokens/${paymentTokenId}`);
  }

  /**
   * Read a path identifier out of the parameter bag.
   *
   * Mirrors PHP's `is_scalar` gate followed by a `(string)` cast: a string
   * is passed through, a number is stringified, a boolean becomes `"1"` or
   * `""` (not `"true"`/`"false"`, which is what JavaScript's `String()`
   * would produce), and anything else (absent, `null`, an array, an object)
   * yields an empty string so the caller's `requiredFields()` check catches
   * it.
   *
   * @param params The parameter bag supplied by the caller.
   * @param key    The key to read.
   * @returns The identifier as a string, or `''` when absent or not scalar.
   */
  private static identifier(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '';
    }
    return '';
  }
}
