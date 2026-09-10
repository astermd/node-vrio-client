import { Call, type RequestSpec } from './call.js';
import { Campaign } from './campaign.js';
import { Cart } from './cart.js';
import { ClientConfig, type ClientOptions } from './client-config.js';
import { Config } from './config.js';
import { Customer } from './customer.js';
import { Discount } from './discount.js';
import { VrioError } from './exception/vrio-error.js';
import type { HttpClientInterface } from './http/http-client.js';
import { FetchClient } from './http/fetch-client.js';
import { DebugLogger } from './logging/debug-logger.js';
import { Offer } from './offer.js';
import { Order } from './order.js';
import { Route } from './route.js';
import type { Vrio } from './vrio.js';

/** A callable member reached through the client's guard, whatever its shape. */
type GuardedFunction = (...args: never[]) => unknown;

/**
 * Names the language, the test runners and the logging tools probe for.
 *
 * These are read speculatively on arbitrary objects, so the guard must let
 * them resolve to whatever they really are — usually `undefined`. Returning a
 * thrower for `then` would make `await api` throw; trapping `toJSON`,
 * `inspect`, `toString` or `valueOf` would break `JSON.stringify` and
 * `util.inspect`; trapping `constructor` would break `instanceof`-adjacent
 * reflection and the class name shown by an inspector.
 */
const PASSTHROUGH: ReadonlySet<string> = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'inspect',
  'toString',
  'valueOf',
  'constructor',
]);

/**
 * Reject a method this client does not implement.
 *
 * Kept as one module-level function so every unknown name resolves to the
 * same value, which keeps repeated lookups stable and allocates nothing.
 *
 * @returns Never; the signature exists so the guard can hand it back where a
 *   method was expected.
 * @throws {VrioError} Always, carrying the package's `methodNotFound` message.
 */
function unknownMethod(): never {
  throw new VrioError(Config.get('Messages.methodNotFound'));
}

/**
 * Entry point for the VRIO API.
 *
 * Construct it with your API key, call any resource method, then read the
 * result with `get()`, `getInObject()` or `getInArray()`:
 *
 * ```ts
 * const api = new API(apiKey, { host: 'api.vrio.app' });
 * const data = await api.searchOrder({ with: 'items' }).getInObject();
 * ```
 *
 * A resource method returns a {@link Call} and sends nothing until that call
 * is read or awaited. That laziness is what lets the accessor carry the
 * promise, so the chain reads the way the PHP client's does while every call
 * stays independent: the client itself holds no per-call state, so two
 * overlapping calls cannot overwrite each other's request.
 *
 * The API key is a required argument. This package ships no default
 * credentials, reads none from the environment, and never places the
 * credential anywhere but a request header — not in a body, a query string,
 * or the payload info an accessor can return.
 *
 * One instance of each resource class is created on first use and reused for
 * the client's lifetime. Resources are stateless by design, so sharing them
 * is safe and is the whole point of that design.
 *
 * The constructor returns a guarded view of the instance, so a
 * plain-JavaScript consumer who mistypes a method name gets this package's
 * own `No such method found` error rather than the runtime's generic
 * "is not a function". `instanceof API`, `await`, `JSON.stringify` and
 * `util.inspect` all behave normally through it.
 */
export class API {
  /**
   * Resource method to the class that implements it.
   *
   * Copied verbatim from the PHP client, order included, and load-bearing
   * twice over: {@link API.supportedMethods} reports its keys, and each of
   * the eighteen methods below dispatches through its own entry, so a method
   * and its resource cannot drift apart.
   */
  private static readonly METHOD_MAP = Object.freeze({
    getCampaignItems: Campaign,
    getCustomer: Customer,
    validateDiscount: Discount,
    calculateDiscount: Discount,
    searchOffer: Offer,
    searchOrder: Order,
    getOrder: Order,
    addOrder: Order,
    editOrder: Order,
    processOrder: Order,
    completeOrder: Order,
    authorizeOrder: Order,
    captureOrder: Order,
    addOrderNote: Order,
    getRoute: Route,
    createCart: Cart,
    createPaypalToken: Cart,
    getPaypalData: Cart,
  });

  /**
   * The three collaborators are held in true private fields, not
   * TypeScript `private` ones. The `private` modifier erases at compile time
   * and leaves an ordinary enumerable property behind, so
   * `JSON.stringify(api)` would walk into all three — and every one can reach
   * a credential. {@link ClientConfig} holds the API key; a transport may
   * retain the requests it sent, whose headers carry the key; and the logger
   * holds the sink those entries are written through. A `#`-declared field is
   * invisible to `JSON.stringify`, `Object.keys` and `for...in`, so none of
   * that is reachable by accident.
   */
  readonly #config: ClientConfig;

  readonly #http: HttpClientInterface;

  readonly #logger: DebugLogger;

  /** One instance per resource class, created on first use. */
  readonly #resources = new Map<new () => Vrio, Vrio>();

  /**
   * The guarded view of this instance, so {@link API.withProxy} can hand back
   * the object the caller actually has a reference to.
   *
   * The guard binds each method to the underlying instance, because a `#`
   * private field is keyed to that instance and is unreachable through the
   * wrapper. A bound method therefore sees the instance as `this`, and
   * returning a bare `this` from a chainable method would hand the caller an
   * unguarded object that is not identical to the one they called.
   */
  readonly #self: API;

  /**
   * Proxy queued by {@link API.withProxy} for the next call only.
   *
   * Private at runtime as well as in the type system: proxy credentials are
   * as sensitive as the API key, and a TS-`private` field would put them on
   * the serialisation path.
   */
  #proxyUrl: string | null = null;

  #proxyCredentials: string | null = null;

  /**
   * Build a client.
   *
   * The API key is required and validated immediately, so a misconfigured
   * client fails at construction rather than on its first request. Options
   * are lenient: an absent or wrongly-typed member falls back to its default
   * instead of throwing, except for the host, which is rejected outright if
   * it is not a bare hostname.
   *
   * @param apiKey VRIO API key. Required; the package ships no default and
   *   reads none from the environment.
   * @param options Connection and debug-logging options. See
   *   {@link ClientOptions} for every member and its default.
   * @param http Custom transport. Defaults to {@link FetchClient}, configured
   *   with the resolved timeouts.
   * @throws {VrioError} When the API key is empty or whitespace-only, the
   *   host is not a bare hostname, or debug logging is enabled without a
   *   usable destination.
   */
  public constructor(apiKey: string, options: ClientOptions = {}, http: HttpClientInterface | null = null) {
    this.#config = new ClientConfig(apiKey, options);
    this.#logger = DebugLogger.fromOptions(options);
    this.#http = http ?? new FetchClient(this.#config.getTimeout(), this.#config.getConnectTimeout());

    const guarded = API.guard(this);
    this.#self = guarded;

    return guarded;
  }

  /**
   * Route the next call through an HTTP proxy.
   *
   * The setting applies to the next resource call only and clears itself as
   * that call is dispatched, so a proxy cannot leak into unrelated calls on
   * the same client. An empty address is ignored, which makes
   * `withProxy(process.env.PROXY ?? '')` safe to write unconditionally.
   *
   * @param proxyUrl Proxy address, for example `proxy.example.test:8080`.
   * @param proxyCredentials Optional `user:password` credentials; an empty
   *   string means none.
   * @returns This client, for chaining.
   */
  public withProxy(proxyUrl: string, proxyCredentials = ''): this {
    if (proxyUrl !== '') {
      this.#proxyUrl = proxyUrl;
      this.#proxyCredentials = proxyCredentials !== '' ? proxyCredentials : null;
    }

    return this.#self as this;
  }

  /**
   * List the items of a campaign.
   *
   * `GET /campaigns/{campaignId}/items`. The returned call sends nothing
   * until it is read or awaited.
   *
   * @param campaignId Campaign identifier, placed in the path.
   * @param params Query string parameters.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `campaignId` is empty.
   */
  public getCampaignItems(campaignId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.getCampaignItems, resource => resource.getCampaignItems(campaignId, params));
  }

  /**
   * Retrieve one customer.
   *
   * `GET /customers/{customerId}`. The returned call sends nothing until it
   * is read or awaited.
   *
   * @param customerId Customer identifier, placed in the path.
   * @param params Query string parameters.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `customerId` is empty.
   */
  public getCustomer(customerId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.getCustomer, resource => resource.getCustomer(customerId, params));
  }

  /**
   * Check whether a discount applies.
   *
   * `POST /discounts/validate`. The supplied bag is sent as the request body.
   *
   * @param params Request body fields; see the API reference in your AsterMD
   *   dashboard for the fields it accepts.
   * @returns A lazy call for the request.
   */
  public validateDiscount(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.validateDiscount, resource => resource.validateDiscount(params));
  }

  /**
   * Calculate the discount for a set of offers.
   *
   * `POST /discounts/calculate`. The supplied bag is sent as the body's
   * `offers` member, not as the body itself.
   *
   * @param params Offers to price.
   * @returns A lazy call for the request.
   */
  public calculateDiscount(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.calculateDiscount, resource => resource.calculateDiscount(params));
  }

  /**
   * Search offers.
   *
   * `GET /offers`. The supplied bag becomes the query string.
   *
   * @param params Query string parameters, such as `campaign_id`.
   * @returns A lazy call for the request.
   */
  public searchOffer(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.searchOffer, resource => resource.searchOffer(params));
  }

  /**
   * Search orders.
   *
   * `GET /orders`. The supplied bag becomes the query string.
   *
   * @param params Query string parameters, such as `with`.
   * @returns A lazy call for the request.
   */
  public searchOrder(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.searchOrder, resource => resource.searchOrder(params));
  }

  /**
   * Retrieve one order.
   *
   * `GET /orders/{orderId}`. The returned call sends nothing until it is read
   * or awaited.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Query string parameters.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public getOrder(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.getOrder, resource => resource.getOrder(orderId, params));
  }

  /**
   * Create an order.
   *
   * `POST /orders`. An empty bag is sent as `{}`, never as `[]`.
   *
   * @param params Request body fields; see the API reference in your AsterMD
   *   dashboard for the fields it accepts.
   * @returns A lazy call for the request.
   */
  public addOrder(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.addOrder, resource => resource.addOrder(params));
  }

  /**
   * Update an order.
   *
   * `PATCH /orders/{order_id}`. The identifier is read out of `params` rather
   * than taken positionally, matching the shape the API accepts, and stays in
   * the body as well.
   *
   * @param params Request body fields; must include `order_id`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `order_id` is absent or not a scalar.
   */
  public editOrder(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.editOrder, resource => resource.editOrder(params));
  }

  /**
   * Process an order.
   *
   * `POST /orders/{orderId}/process`. The returned call sends nothing until
   * it is read or awaited.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Request body fields.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public processOrder(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.processOrder, resource => resource.processOrder(orderId, params));
  }

  /**
   * Complete an order.
   *
   * `POST /orders/{orderId}/complete`. The returned call sends nothing until
   * it is read or awaited.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Request body fields.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public completeOrder(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.completeOrder, resource => resource.completeOrder(orderId, params));
  }

  /**
   * Authorize payment for an order.
   *
   * `POST /orders/{orderId}/authorize`. Authorization reserves funds; use
   * {@link API.captureOrder} to take them.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Request body fields, such as `amount`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public authorizeOrder(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.authorizeOrder, resource => resource.authorizeOrder(orderId, params));
  }

  /**
   * Capture an authorized payment for an order.
   *
   * `POST /orders/{orderId}/capture`. The returned call sends nothing until
   * it is read or awaited.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Request body fields, such as `amount`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public captureOrder(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.captureOrder, resource => resource.captureOrder(orderId, params));
  }

  /**
   * Attach a note to an order.
   *
   * `POST /orders/{orderId}/notes`. The returned call sends nothing until it
   * is read or awaited.
   *
   * @param orderId Order identifier, placed in the path.
   * @param params Request body fields, such as `note`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `orderId` is empty.
   */
  public addOrderNote(orderId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.addOrderNote, resource => resource.addOrderNote(orderId, params));
  }

  /**
   * Retrieve one route.
   *
   * `GET /routes/{routeId}`. The returned call sends nothing until it is read
   * or awaited.
   *
   * @param routeId Route identifier, placed in the path.
   * @param params Query string parameters.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `routeId` is empty.
   */
  public getRoute(routeId: string, params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.getRoute, resource => resource.getRoute(routeId, params));
  }

  /**
   * Create a cart.
   *
   * `POST /carts`. A cart holds the offers a customer intends to buy before
   * they become an order.
   *
   * @param params Request body fields; see the API reference in your AsterMD
   *   dashboard for the fields it accepts.
   * @returns A lazy call for the request.
   */
  public createCart(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.createCart, resource => resource.createCart(params));
  }

  /**
   * Create a PayPal payment token for a cart.
   *
   * `POST /carts/{cart_token}/payment_tokens`. The identifier is read out of
   * `params` and left in the body as well, so the provider sees the same
   * payload this package's PHP sibling sends.
   *
   * @param params Request body fields; must include `cart_token`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When `cart_token` is absent or not a scalar.
   */
  public createPaypalToken(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.createPaypalToken, resource => resource.createPaypalToken(params));
  }

  /**
   * Retrieve a PayPal payment token for a cart.
   *
   * `GET /carts/{cart_token}/payment_tokens/{payment_token_id}`. Both
   * identifiers go in the path only; this request carries no query string.
   *
   * @param params Must include `cart_token` and `payment_token_id`.
   * @returns A lazy call for the request.
   * @throws {VrioError} When either identifier is absent or not a scalar.
   */
  public getPaypalData(params: Record<string, unknown> = {}): Call {
    return this.#dispatch(API.METHOD_MAP.getPaypalData, resource => resource.getPaypalData(params));
  }

  /**
   * Not available on the client. Read the result from the call instead.
   *
   * The PHP client tracks the most recent call on the client itself and
   * serves its three accessors from that. This port deliberately does not:
   * that field is exactly the per-client mutable state whose removal makes
   * concurrent calls safe, and reinstating it would mean two overlapping
   * calls could return each other's response.
   *
   * The method is kept rather than omitted because omitting it would make the
   * guard report `No such method found`, which sends someone migrating PHP
   * code looking for a typo that is not there. This message names the fix:
   * read the result from the {@link Call} the resource method returned —
   * `await api.searchOrder().get()`.
   *
   * @returns Never.
   * @throws {VrioError} Always, carrying the `apiMethodInvoked` message.
   */
  public get(): never {
    throw new VrioError(Config.get('Messages.apiMethodInvoked'));
  }

  /**
   * Not available on the client. Read the result from the call instead.
   *
   * Present for the same reason as {@link API.get}, and throwing for the same
   * reason: use `await api.searchOrder().getInArray()`.
   *
   * @returns Never.
   * @throws {VrioError} Always, carrying the `apiMethodInvoked` message.
   */
  public getInArray(): never {
    throw new VrioError(Config.get('Messages.apiMethodInvoked'));
  }

  /**
   * Not available on the client. Read the result from the call instead.
   *
   * Present for the same reason as {@link API.get}, and throwing for the same
   * reason: use `await api.searchOrder().getInObject()`.
   *
   * @returns Never.
   * @throws {VrioError} Always, carrying the `apiMethodInvoked` message.
   */
  public getInObject(): never {
    throw new VrioError(Config.get('Messages.apiMethodInvoked'));
  }

  /**
   * Resource methods this client can dispatch.
   *
   * The order is the PHP client's, so the two packages' documentation and
   * support answers line up.
   *
   * @returns The eighteen resource method names.
   */
  public static supportedMethods(): string[] {
    return Object.keys(API.METHOD_MAP);
  }

  /**
   * Wrap the instance so an unknown method call raises this package's own
   * error.
   *
   * TypeScript rejects a bogus method name at compile time, but a plain
   * JavaScript consumer would otherwise see the runtime's generic
   * "is not a function". The PHP client raises `No such method found` here,
   * and matching it keeps the two packages' behaviour identical.
   *
   * Every real member is forwarded, and every callable one is bound to the
   * underlying instance: a `#` private field is keyed to that instance, so a
   * method invoked with the wrapper as `this` could not read the client's own
   * configuration. Bound methods are cached, so a repeated lookup yields the
   * same function.
   *
   * @param instance The freshly-constructed client.
   * @returns A guarded view of `instance`.
   */
  private static guard(instance: API): API {
    const bound = new Map<string, GuardedFunction>();

    return new Proxy(instance, {
      get(target: API, property: string | symbol): unknown {
        // Symbols are how the language and its tooling ask questions
        // (`Symbol.toPrimitive`, the inspect hook); never answer with a
        // thrower.
        if (typeof property !== 'string') {
          return Reflect.get(target, property, target) as unknown;
        }

        if (!(property in target) && !PASSTHROUGH.has(property)) {
          return unknownMethod;
        }

        // The receiver is the target, not the wrapper: there are no accessor
        // properties to re-enter, and this keeps lookups shallow.
        const value = Reflect.get(target, property, target) as unknown;

        // `constructor` is left unbound so an inspector still reports the
        // class name rather than a bound function's.
        if (typeof value !== 'function' || property === 'constructor') {
          return value;
        }

        let member = bound.get(property);
        if (member === undefined) {
          member = (value as GuardedFunction).bind(target);
          bound.set(property, member);
        }

        return member;
      },
    });
  }

  /**
   * Build a {@link Call} from a resource's descriptor.
   *
   * The queued proxy is consumed and cleared **before** the resource
   * validates its arguments, matching the PHP client's `__call`: a call that
   * throws for a missing argument still clears the proxy rather than leaving
   * it armed for the next, unrelated call.
   *
   * @param ctor The resource class implementing the method.
   * @param describe Invokes the resource method and yields its descriptor.
   * @returns A lazy call carrying the descriptor and this client's collaborators.
   * @throws {VrioError} Whatever the resource method raises for invalid input.
   */
  #dispatch<T extends Vrio>(ctor: new () => T, describe: (resource: T) => RequestSpec): Call {
    const resource = this.#resourceFor(ctor);

    const proxyUrl = this.#proxyUrl;
    const proxyCredentials = this.#proxyCredentials;
    this.#proxyUrl = null;
    this.#proxyCredentials = null;

    return new Call(describe(resource), this.#config, this.#http, this.#logger, proxyUrl, proxyCredentials);
  }

  /**
   * Instantiate a resource once and cache it for this client's lifetime.
   *
   * Sharing is safe precisely because resources are stateless: a resource
   * method returns a frozen descriptor and stores nothing, so concurrent
   * calls through the same instance cannot interfere.
   *
   * @param ctor The resource class to resolve.
   * @returns The cached instance, created on first use.
   */
  #resourceFor<T extends Vrio>(ctor: new () => T): T {
    const existing = this.#resources.get(ctor);
    if (existing !== undefined) {
      return existing as T;
    }

    const created = new ctor();
    this.#resources.set(ctor, created);

    return created;
  }
}
