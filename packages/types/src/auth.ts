/**
 * Callback type for resolving subscriber identity from a Web Standard Request.
 *
 * Required on `EmitoServerConfig`. The server is auth-agnostic — this callback
 * is the sole mechanism for authenticating subscribers on both REST and WebSocket
 * endpoints.
 *
 * Return the subscriber ID string on success, or `null` if the request cannot
 * be authenticated. A thrown error results in a 401 response.
 *
 * @example
 * ```ts
 * import { createJwtAuth } from '@emito/auth-jwt';
 * const resolveSubscriberId = createJwtAuth({ hmacSecret: process.env.JWT_SECRET });
 * ```
 */
export type ResolveSubscriberId = (req: Request) => Promise<string | null>;
