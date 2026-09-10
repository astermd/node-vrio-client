import type { RequestSpec } from './call.js';
import { Vrio } from './vrio.js';

/**
 * Order endpoints.
 *
 * An order is what a cart becomes once a customer commits to buying it, and
 * this resource covers its full lifecycle: search, single-record read,
 * creation, editing, and the payment actions — process, complete, authorize,
 * capture — plus attaching an internal note.
 *
 * Several of these endpoints carry personal and payment-related data (buyer
 * contact details, payment amounts, note text). See the README for how debug
 * logging treats them.
 */
export class Order extends Vrio {
  /**
   * Search orders, or list them all when no filter is given.
   *
   * `GET /orders`
   *
   * Pass `with` among the query parameters to expand related records.
   *
   * @param params Optional query parameters; see the API reference in your
   *               AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   */
  public searchOrder(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendGet('orders', params);
  }

  /**
   * Retrieve a single order by ID.
   *
   * `GET /orders/{orderId}`
   *
   * @param orderId Identifier of the order to read.
   * @param params  Optional query parameters; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public getOrder(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendGet(`orders/${orderId}`, params);
  }

  /**
   * Create an order. One order may carry one or many offers or line items.
   *
   * `POST /orders`
   *
   * @param params Request body fields; see the API reference in your
   *               AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   */
  public addOrder(params: Record<string, unknown> = {}): RequestSpec {
    return this.sendPost('orders', params);
  }

  /**
   * Update an existing order.
   *
   * `PATCH /orders/{order_id}`
   *
   * The identifier is read out of `params` rather than taken positionally,
   * because that is the shape the API accepts and the PHP client established.
   * It is left in the body as well, so the provider sees the same payload
   * from both clients.
   *
   * The identifier is stringified the way PHP's `(string)` cast stringifies
   * a scalar: a number is written out (`12.5` -> `"12.5"`), and a boolean
   * becomes `"1"` or `""` — not `"true"`/`"false"`, which is what
   * JavaScript's `String()` would produce.
   *
   * @param params Body fields; must include `order_id`.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When `order_id` is absent or not a scalar.
   */
  public editOrder(params: Record<string, unknown> = {}): RequestSpec {
    const raw = params['order_id'];
    let orderId = '';
    if (typeof raw === 'string') {
      orderId = raw;
    } else if (typeof raw === 'number') {
      orderId = String(raw);
    } else if (typeof raw === 'boolean') {
      orderId = raw ? '1' : '';
    }

    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPatch(`orders/${orderId}`, params);
  }

  /**
   * Start processing an order.
   *
   * `POST /orders/{orderId}/process`
   *
   * @param orderId Identifier of the order to process.
   * @param params  Request body fields; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public processOrder(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPost(`orders/${orderId}/process`, params);
  }

  /**
   * Mark an order complete.
   *
   * `POST /orders/{orderId}/complete`
   *
   * @param orderId Identifier of the order to complete.
   * @param params  Request body fields; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public completeOrder(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPost(`orders/${orderId}/complete`, params);
  }

  /**
   * Authorize payment for an existing order.
   *
   * `POST /orders/{orderId}/authorize`
   *
   * @param orderId Identifier of the order to authorize.
   * @param params  Request body fields; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public authorizeOrder(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPost(`orders/${orderId}/authorize`, params);
  }

  /**
   * Capture payment for an existing order.
   *
   * `POST /orders/{orderId}/capture`
   *
   * @param orderId Identifier of the order to capture payment for.
   * @param params  Request body fields; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public captureOrder(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPost(`orders/${orderId}/capture`, params);
  }

  /**
   * Attach a note to an order.
   *
   * `POST /orders/{orderId}/notes`
   *
   * @param orderId Identifier of the order the note is attached to.
   * @param params  Request body fields; see the API reference in your
   *                AsterMD dashboard for the fields it accepts.
   * @returns A description of the request, for `Call` to execute.
   * @throws VrioError When the order ID is empty.
   */
  public addOrderNote(orderId: string, params: Record<string, unknown> = {}): RequestSpec {
    if (orderId === '') {
      this.requiredFields();
    }

    return this.sendPost(`orders/${orderId}/notes`, params);
  }
}
