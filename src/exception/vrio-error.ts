/**
 * The single error type raised by this package.
 *
 * Every failure the client itself detects — an empty API key, a host that is
 * not a bare hostname, a missing required argument, an unknown method, an
 * undecodable response, a misconfigured debug sink — arrives as a `VrioError`.
 * There is deliberately no hierarchy: a consumer needs one `catch` clause,
 * and a single type keeps that promise as the package grows.
 *
 * Provider-side errors and transport failures are **not** errors. They are
 * reported as data inside the response envelope, so a caller can inspect them
 * without unwinding the stack. See the README's error section.
 */
export class VrioError extends Error {
  /**
   * @param message Human-readable description, drawn from the package's
   *                message table so wording stays consistent.
   */
  public constructor(message: string) {
    super(message);
    this.name = 'VrioError';
    // Restore the prototype chain: without this, `instanceof` breaks in
    // downlevelled and bundled output.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
