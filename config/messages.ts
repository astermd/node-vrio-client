/**
 * Externalized message strings.
 *
 * Kept in one table so wording stays consistent between this package and its
 * PHP counterpart, and so a message can be corrected in one place.
 */
export const MESSAGES = Object.freeze({
  methodNotFound: 'No such method found',
  invalidAuth: 'An API key is required',
  invalidHost: 'The host must be a bare hostname such as "api.vrio.app", without a scheme or path',
  notAssigned: 'Section and method must be assigned',
  apiMethodInvoked: 'No API method has been invoked yet',
  jsonFormatError: 'API response is not valid JSON',
  requiredFields: 'Missing required fields',
  debugFileRequired: 'Debug logging needs either a "debugFile" base path or a "debugSink" callable',
  invalidDebugSink: 'The "debugSink" option must be callable',
  invalidTimezone: 'The configured timezone is not a recognised IANA identifier',
  queryTooDeep: 'Query parameters are nested more than 64 levels deep',
});

export type MessageKey = keyof typeof MESSAGES;
