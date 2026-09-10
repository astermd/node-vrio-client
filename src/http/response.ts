/**
 * Immutable result of an HTTP exchange.
 *
 * A transport failure is carried as `transportError` rather than thrown, so
 * the debug logger can record the attempt before the caller decides what to
 * do about it. A frozen `Response` means that record can never be altered
 * after the fact either.
 */
export class Response {
  private readonly statusCode: number;
  private readonly body: string;
  private readonly info: Record<string, unknown>;
  private readonly transportError: string;

  /**
   * @param statusCode HTTP status code, or `0` when the transfer never
   *   reached a server.
   * @param body Raw response body.
   * @param info Transport metadata (e.g. timing, effective URL).
   * @param transportError Empty string when the transfer succeeded.
   */
  public constructor(statusCode: number, body: string, info: Record<string, unknown> = {}, transportError = '') {
    this.statusCode = statusCode;
    this.body = body;
    // Copy and freeze: the caller must not be able to reach through a
    // supposedly frozen Response and mutate its transport metadata.
    this.info = Object.freeze({ ...info });
    this.transportError = transportError;
    Object.freeze(this);
  }

  /**
   * @returns The HTTP status code, or `0` when the transfer never reached a
   *   server.
   */
  public getStatusCode(): number {
    return this.statusCode;
  }

  /**
   * @returns The raw response body.
   */
  public getBody(): string {
    return this.body;
  }

  /**
   * @returns Transport metadata attached to this response.
   */
  public getInfo(): Record<string, unknown> {
    return this.info;
  }

  /**
   * @returns The transport error message, or an empty string if the
   *   transfer succeeded.
   */
  public getTransportError(): string {
    return this.transportError;
  }

  /**
   * @returns `true` if the transfer itself failed (as opposed to the server
   *   returning an error status).
   */
  public hasTransportError(): boolean {
    return this.transportError !== '';
  }
}
