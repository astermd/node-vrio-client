import { EventEmitter } from 'node:events';
import { createServer as createHttpServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tunnelRequest } from '../../src/http/proxy-tunnel.js';
import { Request } from '../../src/http/request.js';

/**
 * `ClientConfig.getBaseUrl()` always returns an `https://` URL, so in
 * production the tunnel's TLS branch is the one that always runs -- the
 * mechanics tests in `proxy-tunnel.spec.ts` only exercise plain-`http:`
 * targets, which would otherwise leave that branch, in the file carrying
 * credentials, completely untested.
 *
 * This file closes that gap by intercepting `node:https`'s `request` export
 * and asserting the *options* the tunnel builds for it, rather than
 * performing a real TLS handshake (which would need a certificate). It
 * proves:
 *   - an `https:` target is sent through `node:https`, not `node:http`;
 *   - the tunnel socket, `agent: false` and `servername` are set correctly;
 *   - no `rejectUnauthorized` key is present at all, i.e. verification is
 *     never disabled, not even implicitly.
 *
 * `node:http` is deliberately left un-mocked here: the plain-`http:` case is
 * proven by letting a real request round-trip to a real origin server while
 * the https spy stays silent, which is only possible if the request truly
 * went out over `node:http`.
 */
const { httpsRequestSpy } = vi.hoisted(() => ({ httpsRequestSpy: vi.fn() }));

vi.mock('node:https', () => ({
  request: (
    options: Record<string, unknown>,
    callback: (res: EventEmitter & { statusCode: number; headers: Record<string, string> }) => void,
  ) => {
    httpsRequestSpy(options);

    const fakeRequest = new EventEmitter() as EventEmitter & {
      write: (chunk: unknown) => void;
      end: () => void;
      destroy: () => void;
    };
    fakeRequest.write = () => {
      // The options assertion is all this test needs; the body is unread.
    };
    fakeRequest.destroy = () => {
      // Nothing real to tear down for the canned response below.
    };
    fakeRequest.end = () => {
      queueMicrotask(() => {
        const fakeResponse = new EventEmitter() as EventEmitter & {
          statusCode: number;
          headers: Record<string, string>;
        };
        fakeResponse.statusCode = 200;
        fakeResponse.headers = { 'content-type': 'application/json' };
        callback(fakeResponse);
        queueMicrotask(() => {
          fakeResponse.emit('data', Buffer.from('{"ok":true}'));
          fakeResponse.emit('end');
        });
      });
    };
    return fakeRequest;
  },
}));

const servers: Server[] = [];
const sockets: Socket[] = [];

/** Derive a connectable `host:port` from a loopback server's assigned address. */
function address(server: Server): string {
  const { address: host, port } = server.address() as AddressInfo;
  const resolved = host === '::' ? '::1' : host === '0.0.0.0' ? [127, 0, 0, 1].join('.') : host;
  const bracketed = resolved.includes(':') ? `[${resolved}]` : resolved;
  return `${bracketed}:${String(port)}`;
}

/** Track every socket a server accepts so `afterEach` can destroy it unconditionally. */
function trackConnections(server: Server): void {
  server.on('connection', socket => {
    sockets.push(socket);
  });
}

/**
 * A CONNECT proxy that agrees to every tunnel immediately, without dialling
 * further upstream. Fine for the `https:` test below, since the mocked
 * `node:https` request never actually reads or writes the socket -- but not
 * a stand-in for a proxy that must really relay bytes.
 */
async function startAcceptingProxy(): Promise<Server> {
  const proxy = createHttpServer();
  trackConnections(proxy);
  proxy.on('connect', (_req, clientSocket) => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  });
  await new Promise<void>(resolve => proxy.listen(0, resolve));
  servers.push(proxy);
  return proxy;
}

/**
 * Split a CONNECT path (`req.url`) into its host and port, understanding
 * both `host:port` and the bracketed IPv6 form (`[::1]:port`) this
 * environment's loopback address produces.
 */
function splitConnectPath(connectPath: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(connectPath);
  if (bracketed !== null) {
    return { host: bracketed[1] ?? '', port: Number(bracketed[2]) };
  }
  const separator = connectPath.lastIndexOf(':');
  return { host: connectPath.slice(0, separator), port: Number(connectPath.slice(separator + 1)) };
}

/** A CONNECT proxy that really relays bytes to the requested target, for the plain-`http:` round trip. */
async function startPipingProxy(): Promise<Server> {
  const proxy = createHttpServer();
  trackConnections(proxy);
  proxy.on('connect', (req, clientSocket, head) => {
    const { host, port } = splitConnectPath(req.url ?? '');
    const upstream = connect({ host, port }, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.push(upstream);
    upstream.on('error', () => clientSocket.destroy());
  });
  await new Promise<void>(resolve => proxy.listen(0, resolve));
  servers.push(proxy);
  return proxy;
}

afterEach(async () => {
  httpsRequestSpy.mockClear();
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
});

describe('tunnelRequest -- https branch', () => {
  it('routes an https: target through node:https with the tunnel socket, agent: false, servername, and no rejectUnauthorized', async () => {
    const proxy = await startAcceptingProxy();

    const response = await tunnelRequest(
      new Request('GET', 'https://backend.example:8443/orders', [], null, address(proxy)),
      5,
      5,
    );

    expect(response.hasTransportError()).toBe(false);
    expect(response.getStatusCode()).toBe(200);

    expect(httpsRequestSpy).toHaveBeenCalledTimes(1);
    const options = httpsRequestSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options['agent']).toBe(false);
    expect(options['servername']).toBe('backend.example');
    expect(options['socket']).toBeDefined();
    expect('rejectUnauthorized' in options).toBe(false);
  });

  it('still routes a plain http: target through node:http, not node:https', async () => {
    let seenMethod = '';
    const origin = createHttpServer((req, res) => {
      seenMethod = req.method ?? '';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"real":true}');
    });
    trackConnections(origin);
    await new Promise<void>(resolve => origin.listen(0, resolve));
    servers.push(origin);
    const proxy = await startPipingProxy();

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, address(proxy)),
      5,
      5,
    );

    expect(seenMethod).toBe('GET');
    expect(response.getStatusCode()).toBe(200);
    expect(response.getBody()).toBe('{"real":true}');
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });
});
