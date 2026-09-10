import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Route endpoints.
 *
 * A route describes the path an order's fulfillment follows — the stops or
 * legs a campaign's offers are sold against. This resource exposes only the
 * single-record read.
 */
export class Route extends Vrio {
  /**
   * Retrieve a route by ID.
   *
   * `GET /routes/{routeId}`
   *
   * @param routeId Identifier of the route to read.
   * @param params  Optional query parameters; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the route ID is empty.
   */
  public getRoute(routeId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (routeId === '') {
      this.requiredFields();
    }

    return this.sendGet(`routes/${routeId}`, params);
  }
}
