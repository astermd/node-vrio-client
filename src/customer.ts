import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Customer endpoints.
 *
 * A customer is the storefront's own end user, referenced by the ID the
 * storefront assigned when the customer was created or first ordered. This
 * resource exposes only the read side; there is no create or update endpoint
 * on this surface.
 */
export class Customer extends Vrio {
  /**
   * Retrieve a customer by ID.
   *
   * `GET /customers/{customerId}`
   *
   * @param customerId Identifier of the customer to read.
   * @param params     Optional query parameters; see the API reference in
   *                   your AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the customer ID is empty.
   */
  public getCustomer(customerId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (customerId === '') {
      this.requiredFields();
    }

    return this.sendGet(`customers/${customerId}`, params);
  }
}
