import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Offer endpoints.
 *
 * An offer is a sellable unit within a campaign — a fare, a fee, or a bundle
 * a storefront can add to a cart. This resource is search-only; offers are
 * managed elsewhere and read here by whatever filters the API accepts.
 */
export class Offer extends Vrio {
  /**
   * Search offers.
   *
   * `GET /offers`
   *
   * @param params Optional query parameters; see the API reference in your
   *               AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   */
  public searchOffer(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendGet('offers', params);
  }
}
