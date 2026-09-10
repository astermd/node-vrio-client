/**
 * Public surface of the VRIO API client.
 *
 * `API` is the only class most consumers touch. The rest are exported so a
 * consumer can implement the transport seam, drive a logger directly, or
 * narrow a response type.
 */
export { API } from './api.js';
export { Call, isEnvelope, isTransportFailure } from './call.js';
export { Vrio } from './vrio.js';
export { ClientConfig } from './client-config.js';

export { Campaign } from './campaign.js';
export { Cart } from './cart.js';
export { Customer } from './customer.js';
export { Discount } from './discount.js';
export { Offer } from './offer.js';
export { Order } from './order.js';
export { Route } from './route.js';

export { VrioError } from './exception/vrio-error.js';

export { FetchClient } from './http/fetch-client.js';
export { Request } from './http/request.js';
export { Response } from './http/response.js';
export { HTTP_METHODS } from './http/http-client.js';

export { DebugLogger } from './logging/debug-logger.js';
export { FileSink } from './logging/file-sink.js';
export { Redactor } from './logging/redactor.js';

export { MESSAGES } from '../config/messages.js';

export type { ClientOptions } from './client-config.js';
export type { HttpClientInterface, HttpMethod } from './http/http-client.js';
export type { DebugSink } from './logging/debug-logger.js';
export type {
  Envelope,
  ObjectResult,
  PayloadInfo,
  RequestSpec,
  StringResult,
  TransportFailure,
  WithHeader,
} from './call.js';
export type { MessageKey } from '../config/messages.js';
