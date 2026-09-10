import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Discount endpoints.
 *
 * A discount is validated against a code or condition, and calculated
 * against a set of priced offers before a cart or order commits to it. Both
 * methods here take no identifier, since the provider derives the discount
 * from the body it is sent.
 */
export class Discount extends Vrio {
  /**
   * Check whether a discount applies to a given offer.
   *
   * `POST /discounts/validate`
   *
   * @param params Request body fields; see the API reference in your
   *               AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   */
  public validateDiscount(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendPost('discounts/validate', params);
  }

  /**
   * Calculate the discount for a set of offers.
   *
   * `POST /discounts/calculate`
   *
   * The supplied bag is sent as the body's `offers` member, not as the body
   * itself.
   *
   * @param params Offers to price.
   * @returns A description of the request, for `Call` to execute.
   */
  public calculateDiscount(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendPost('discounts/calculate', { offers: params });
  }
}
