import type { RequestSpec } from './call.js';
import { Config } from './config.js';
import { VrioError } from './exception/vrio-error.js';
import type { HttpMethod } from './http/http-client.js';

/**
 * Base class for every VRIO API resource.
 *
 * A resource's only job is to turn a method call into a description of one
 * HTTP request: the path below the base URL, the body fields, and the query
 * parameters. It performs no I/O, holds no per-call state, and knows nothing
 * about URLs, headers, or the response envelope — those belong to `Call`.
 *
 * Statelessness is deliberate. `API` caches one instance of each resource for
 * the client's lifetime, and Node runs calls concurrently; an instance that
 * stored the current section and fields would let two overlapping calls
 * overwrite each other's request. Returning an immutable descriptor makes
 * that impossible rather than merely unlikely, which is why the PHP client's
 * mutate-then-`reset()` pattern has no counterpart here — there is nothing
 * to reset.
 *
 * Credentials are absent from everything a resource produces. The API key
 * travels in a request header, read in exactly one place in this package, and
 * is never merged into a body, a query string, or the payload info a caller
 * can read back.
 */
export abstract class Vrio {
  /**
   * Include transport metadata alongside the response body.
   *
   * Read when a descriptor is built, so setting it affects the calls made
   * after it is set. Kept as a public field for structural parity with the
   * PHP client.
   */
  public headerRequired = false;

  /**
   * Abort the current call because a mandatory argument was missing.
   *
   * @returns Never; the return type lets a caller write
   *   `return this.requiredFields()` in a branch that must not continue.
   * @throws {VrioError} Always, carrying the package's `requiredFields`
   *   message.
   */
  protected requiredFields(): never {
    throw new VrioError(Config.get('Messages.requiredFields'));
  }

  /**
   * Describe a `GET`, sending `params` as the query string.
   *
   * @param section Path below the base URL, e.g. `"orders/ord_1"`.
   * @param params Query string parameters.
   * @returns A frozen descriptor for `Call` to execute.
   */
  protected sendGet(section: string, params: Record<string, unknown> = {}): RequestSpec {
    return this.describe('GET', section, {}, params);
  }

  /**
   * Describe a `POST`, sending `fields` as the JSON body.
   *
   * @param section Path below the base URL, e.g. `"orders"`.
   * @param fields Body fields; an empty payload is encoded as `{}`.
   * @returns A frozen descriptor for `Call` to execute.
   */
  protected sendPost(section: string, fields: Record<string, unknown> = {}): RequestSpec {
    return this.describe('POST', section, fields, {});
  }

  /**
   * Describe a `PATCH`, sending `fields` as the JSON body.
   *
   * @param section Path below the base URL, e.g. `"orders/ord_1"`.
   * @param fields Body fields; an empty payload is encoded as `{}`.
   * @returns A frozen descriptor for `Call` to execute.
   */
  protected sendPatch(section: string, fields: Record<string, unknown> = {}): RequestSpec {
    return this.describe('PATCH', section, fields, {});
  }

  /**
   * Describe a `PUT`, sending `fields` as the JSON body.
   *
   * No resource in this package's surface issues a `PUT` today. It is ported
   * anyway: the PHP client carries it, as does the sibling client this
   * package is kept structurally aligned with, and dropping it would make the
   * two bases diverge for no gain.
   *
   * @param section Path below the base URL.
   * @param fields Body fields; an empty payload is encoded as `{}`.
   * @returns A frozen descriptor for `Call` to execute.
   */
  protected sendPut(section: string, fields: Record<string, unknown> = {}): RequestSpec {
    return this.describe('PUT', section, fields, {});
  }

  /**
   * Describe a `DELETE`, which is sent bodyless.
   *
   * Ported for the same reason as {@link Vrio.sendPut}: structural parity
   * with the PHP client and its sibling.
   *
   * @param section Path below the base URL.
   * @returns A frozen descriptor for `Call` to execute.
   */
  protected sendDelete(section: string): RequestSpec {
    return this.describe('DELETE', section, {}, {});
  }

  /**
   * Freeze one descriptor.
   *
   * The fields and query bags are copied before being frozen, so a resource
   * method that keeps a reference to the object it passed in cannot reach
   * through the descriptor and change a request that has already been
   * described.
   */
  private describe(
    httpMethod: HttpMethod,
    section: string,
    fields: Record<string, unknown>,
    query: Record<string, unknown>,
  ): RequestSpec {
    return Object.freeze({
      httpMethod,
      section,
      fields: Object.freeze({ ...fields }),
      query: Object.freeze({ ...query }),
      headerRequired: this.headerRequired,
    });
  }
}
