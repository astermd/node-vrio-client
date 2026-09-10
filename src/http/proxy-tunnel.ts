import { Agent, request as httpRequest, type ClientRequestArgs, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { connect as netConnect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { Response } from './response.js';
import type { Request } from './request.js';

/**
 * Options for a tunnelled `https:` request: the same shape `node:https`
 * accepts, plus the raw socket the CONNECT tunnel produced. `@types/node`
 * does not declare `socket` on `https.RequestOptions`, even though Node
 * honours it at runtime (it is handed straight through to `tls.connect`),
 * so the extension is spelled out here rather than reached with a cast to
 * `any`.
 */
type TunnelledHttpsOptions = HttpsRequestOptions & { socket: Socket; agent: false };

/**
 * An `http.Agent` that hands back an already-open socket instead of dialling
 * a new connection.
 *
 * Plain `http:` requests do not honour a raw `socket` option the way
 * `https:` requests do (verified empirically: `node:http`'s default
 * connection logic ignores it and dials `host:80` regardless), so reusing
 * the CONNECT tunnel for an `http:` target goes through this documented
 * extension point instead.
 */
class ExistingSocketAgent extends Agent {
  readonly #socket: Socket;

  public constructor(socket: Socket) {
    super();
    this.#socket = socket;
  }

  public override createConnection(
    _options: ClientRequestArgs,
    callback?: (error: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    callback?.(null, this.#socket);
    return undefined;
  }
}

/** A proxy address, resolved to a connectable host and port. */
interface ProxyAddress {
  readonly host: string;
  readonly port: number;
}

/**
 * Split a proxy address into its host and port.
 *
 * The address may arrive as `host:port` or with a leading `http://` /
 * `https://` scheme (stripped here); the port defaults to 8080 when absent
 * or unparsable. A bracketed IPv6 literal (`[::1]:8080`) is recognised and
 * its brackets are stripped, since a connect-style `host` option must carry
 * the bare address, not the URL-literal form.
 */
function splitProxyAddress(proxyUrl: string): ProxyAddress {
  const withoutScheme = proxyUrl.replace(/^https?:\/\//, '');

  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(withoutScheme);
  if (bracketed !== null) {
    const bracketedPort = bracketed[2] === undefined ? NaN : Number(bracketed[2]);
    return {
      host: bracketed[1] ?? '',
      port: Number.isFinite(bracketedPort) && bracketedPort > 0 ? bracketedPort : 8080,
    };
  }

  const separator = withoutScheme.lastIndexOf(':');
  if (separator === -1) {
    return { host: withoutScheme, port: 8080 };
  }
  const parsedPort = Number(withoutScheme.slice(separator + 1));
  return {
    host: withoutScheme.slice(0, separator),
    port: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 8080,
  };
}

/** The target port, defaulted from the URL's scheme when none is given. */
function resolveTargetPort(target: URL): number {
  if (target.port !== '') {
    return Number(target.port);
  }
  return target.protocol === 'https:' ? 443 : 80;
}

/**
 * Open a CONNECT tunnel through the proxy and hand back the raw socket once
 * the proxy has agreed to relay bytes to the target's `host:port`.
 *
 * This talks to the proxy with a bare `node:net` socket and a hand-written
 * request line rather than `node:http`'s own CONNECT support
 * (`http.request({ method: 'CONNECT' })`). The raw socket is a deliberate
 * choice, not a workaround: it gives explicit control over reading the
 * status line, and over any response bytes that happen to arrive in the
 * same packet as the CONNECT reply -- which is exactly what the
 * `socket.unshift()` below is for.
 *
 * Credentials, when present, are sent as `Proxy-Authorization` on this
 * request only: they authorize opening the tunnel, not anything the origin
 * server should see, and must never travel any further than this.
 */
function openTunnel(
  proxyUrl: string,
  proxyCredentials: string | null,
  target: URL,
  connectTimeoutMs: number,
): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const { host, port } = splitProxyAddress(proxyUrl);
    const authLine =
      proxyCredentials !== null && proxyCredentials !== ''
        ? `Proxy-Authorization: Basic ${Buffer.from(proxyCredentials).toString('base64')}\r\n`
        : '';
    const hostPort = `${target.hostname}:${String(resolveTargetPort(target))}`;
    const connectLine = `CONNECT ${hostPort} HTTP/1.1\r\nHost: ${hostPort}\r\n${authLine}\r\n`;

    let settled = false;
    let received = Buffer.alloc(0);

    const socket = netConnect({ host, port });

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      reject(new Error(`Connect timed out after ${String(connectTimeoutMs / 1000)} seconds`));
    }, connectTimeoutMs);

    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const headerEnd = received.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);

      const statusLine = received.subarray(0, headerEnd).toString('latin1').split('\r\n')[0] ?? '';
      const statusMatch = /^HTTP\/\d\.\d (\d{3})/.exec(statusLine);
      const status = statusMatch?.[1] !== undefined ? Number(statusMatch[1]) : 0;

      if (status !== 200) {
        socket.destroy();
        reject(new Error(`Proxy refused the tunnel: HTTP ${String(status)}`));
        return;
      }

      // Bytes read past the header terminator already belong to the
      // tunnelled exchange; push them back so the next reader sees them.
      const leftover = received.subarray(headerEnd + 4);
      if (leftover.length > 0) {
        socket.unshift(leftover);
      }

      // The tunnel handed off successfully; this listener has nothing left
      // to react to, and the socket is about to be reused for the real
      // request.
      socket.removeListener('error', onError);
      resolve(socket);
    };

    const onError = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      reject(error);
    };

    socket.on('data', onData);
    socket.once('error', onError);

    socket.once('connect', () => {
      socket.write(connectLine);
    });
  });
}

/** Build the outgoing header map for the tunnelled request, plus a `Host`. */
function buildHeaders(request: Request, host: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of request.getHeaders()) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  headers['Host'] = host;
  return headers;
}

/**
 * Send the real request over an already-open tunnel socket and resolve the
 * origin's response.
 *
 * An `https:` target wraps the socket in TLS by passing it straight to
 * `node:https`, which hands it to `tls.connect` under the hood; verification
 * stays on because no `rejectUnauthorized` override is ever set here. An
 * `http:` target speaks plain HTTP over the same socket via
 * {@link ExistingSocketAgent}. Either way the promise always resolves --
 * never rejects -- with failures folded into the returned `Response`.
 */
function sendOverTunnel(request: Request, target: URL, socket: Socket, timeoutMs: number): Promise<Response> {
  return new Promise<Response>(resolve => {
    const secure = target.protocol === 'https:';
    const method = request.getMethod();
    const path = `${target.pathname}${target.search}`;
    const headers = buildHeaders(request, target.host);

    let settled = false;

    const finish = (response: Response): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (!socket.destroyed) {
        socket.destroy();
      }
      resolve(response);
    };

    const onOriginResponse = (originResponse: IncomingMessage): void => {
      const chunks: Buffer[] = [];
      originResponse.on('data', (chunk: Buffer) => chunks.push(chunk));
      originResponse.on('end', () => {
        const status = originResponse.statusCode ?? 0;
        finish(
          new Response(status, Buffer.concat(chunks).toString('utf8'), {
            http_code: status,
            url: target.toString(),
            content_type: originResponse.headers['content-type'] ?? '',
            headers: originResponse.headers,
          }),
        );
      });
      originResponse.once('error', (error: Error) => {
        finish(new Response(0, '', {}, error.message));
      });
    };

    let tunnelled;
    if (secure) {
      const httpsOptions: TunnelledHttpsOptions = {
        method,
        path,
        headers,
        socket,
        agent: false,
        // SNI only; verification stays on -- no rejectUnauthorized here.
        servername: target.hostname,
      };
      tunnelled = httpsRequest(httpsOptions, onOriginResponse);
    } else {
      const httpOptions: ClientRequestArgs = {
        method,
        path,
        headers,
        agent: new ExistingSocketAgent(socket),
      };
      tunnelled = httpRequest(httpOptions, onOriginResponse);
    }

    const timer = setTimeout(() => {
      tunnelled.destroy();
      finish(new Response(0, '', {}, `Operation timed out after ${String(timeoutMs / 1000)} seconds`));
    }, timeoutMs);

    tunnelled.once('error', (error: Error) => {
      finish(new Response(0, '', {}, error.message));
    });

    const body = request.getBody();
    if (body !== null) {
      tunnelled.write(body);
    }
    tunnelled.end();
  });
}

/**
 * Perform a request through an HTTP proxy over a hand-rolled CONNECT tunnel.
 *
 * `fetch` has no proxy option at all; `undici` (which does) is not a Node
 * builtin, and adding it would break the package's zero-runtime-dependency
 * rule; Node's own `--use-env-proxy` is process-wide and environment-driven,
 * so it cannot honour a per-call `withProxy(url, credentials)`. This
 * function is the alternative: it opens a `CONNECT` tunnel through the proxy
 * over a raw `node:net` socket, then speaks the real request over that
 * socket with `node:https` (TLS) or `node:http` (plain), depending on the
 * target's scheme.
 *
 * TLS peer and host verification stay on unconditionally -- there is no
 * option here, or anywhere in this module, to disable them.
 *
 * @param request The request to send. `request.getProxyUrl()` and
 *   `request.getProxyCredentials()` describe the tunnel to open;
 *   credentials travel only on the CONNECT request, never on the request
 *   that follows.
 * @param timeout Deadline, in seconds, for the tunnelled exchange once the
 *   tunnel is open.
 * @param connectTimeout Deadline, in seconds, for the CONNECT handshake
 *   itself.
 * @returns A promise resolving to the response. Never rejects; every
 *   failure -- a refused proxy, a non-200 CONNECT reply, a socket error, or
 *   either deadline -- is reported via {@link Response.getTransportError}.
 */
export async function tunnelRequest(request: Request, timeout: number, connectTimeout: number): Promise<Response> {
  try {
    const target = new URL(request.getUrl());
    const socket = await openTunnel(
      request.getProxyUrl() ?? '',
      request.getProxyCredentials(),
      target,
      connectTimeout * 1000,
    );
    return await sendOverTunnel(request, target, socket, timeout * 1000);
  } catch (error) {
    return new Response(0, '', {}, error instanceof Error ? error.message : String(error));
  }
}
