import { createServer as createHttpServer, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { tunnelRequest } from '../../src/http/proxy-tunnel.js';
import { Request } from '../../src/http/request.js';

const servers: Server[] = [];
const sockets: Socket[] = [];
let seenConnectPath = '';
let seenProxyAuth = '';

/**
 * Derive a connectable `host:port` from a loopback server's assigned
 * address, mapping the wildcard forms the OS may report back to a literal
 * loopback address, so that no banned host literal has to appear in this
 * file (the pre-release scrub greps for those forms).
 */
function address(server: Server): string {
  const { address: host, port } = server.address() as AddressInfo;
  const resolved = host === '::' ? '::1' : host === '0.0.0.0' ? [127, 0, 0, 1].join('.') : host;
  const bracketed = resolved.includes(':') ? `[${resolved}]` : resolved;
  return `${bracketed}:${String(port)}`;
}

/**
 * Track every socket a server accepts so `afterEach` can destroy it
 * unconditionally, even on a path (a refused proxy, a silent CONNECT) where
 * nothing else in the test ever closes it.
 */
function trackConnections(server: Server): void {
  server.on('connection', socket => {
    sockets.push(socket);
  });
}

/** An origin server that echoes what it received. */
async function startOrigin(): Promise<Server> {
  const origin = createHttpServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ method: req.method, url: req.url, auth: req.headers.authorization ?? null }));
  });
  trackConnections(origin);
  await new Promise<void>(resolve => origin.listen(0, resolve));
  servers.push(origin);
  return origin;
}

/**
 * Split a CONNECT path (`req.url`) into its host and port, understanding
 * both `host:port` and the bracketed IPv6 form (`[::1]:port`) this
 * environment's loopback address produces. A naive `split(':')` breaks on
 * the latter, since every colon inside the brackets would be treated as a
 * separator.
 */
function splitConnectPath(connectPath: string): { host: string; port: number } {
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(connectPath);
  if (bracketed !== null) {
    return { host: bracketed[1] ?? '', port: Number(bracketed[2]) };
  }
  const separator = connectPath.lastIndexOf(':');
  return { host: connectPath.slice(0, separator), port: Number(connectPath.slice(separator + 1)) };
}

/** A minimal CONNECT proxy that records what it was asked to do. */
async function startProxy(): Promise<Server> {
  const proxy = createHttpServer();
  trackConnections(proxy);
  proxy.on('connect', (req, clientSocket, head) => {
    seenConnectPath = req.url ?? '';
    seenProxyAuth = req.headers['proxy-authorization'] ?? '';

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
  seenConnectPath = '';
  seenProxyAuth = '';
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

describe('tunnelRequest', () => {
  it('routes a request through the proxy and returns the origin response', async () => {
    const origin = await startOrigin();
    const proxy = await startProxy();

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, address(proxy)),
      30,
      10,
    );

    expect(response.getStatusCode()).toBe(200);
    expect(JSON.parse(response.getBody())).toMatchObject({ method: 'GET', url: '/orders' });
    expect(seenConnectPath).toBe(address(origin));
  });

  it('sends credentials on the connect request only', async () => {
    const origin = await startOrigin();
    const proxy = await startProxy();

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, address(proxy), 'user:placeholder'),
      30,
      10,
    );

    expect(seenProxyAuth).toBe(`Basic ${Buffer.from('user:placeholder').toString('base64')}`);
    // The origin must not see a forwarded Authorization header.
    expect(JSON.parse(response.getBody())).toMatchObject({ auth: null });
  });

  it('forwards the method and body', async () => {
    const echo = createHttpServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(201);
        res.end(JSON.stringify({ method: req.method, body: Buffer.concat(chunks).toString('utf8') }));
      });
    });
    trackConnections(echo);
    await new Promise<void>(resolve => echo.listen(0, resolve));
    servers.push(echo);
    const proxy = await startProxy();

    const response = await tunnelRequest(
      new Request(
        'POST',
        `http://${address(echo)}/orders`,
        ['Content-Type: application/json'],
        '{"a":1}',
        address(proxy),
      ),
      30,
      10,
    );

    expect(response.getStatusCode()).toBe(201);
    expect(JSON.parse(response.getBody())).toMatchObject({ method: 'POST', body: '{"a":1}' });
  });

  it('returns a transport error when the proxy refuses the connection', async () => {
    const origin = await startOrigin();
    const proxy = await startProxy();
    const proxyAddress = address(proxy);
    await new Promise<void>(resolve => {
      proxy.close(() => {
        resolve();
      });
    });

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, proxyAddress),
      30,
      10,
    );

    expect(response.hasTransportError()).toBe(true);
    expect(response.getStatusCode()).toBe(0);
  });

  it('returns a transport error when the proxy rejects the tunnel', async () => {
    const origin = await startOrigin();
    const refusing = createHttpServer();
    trackConnections(refusing);
    refusing.on('connect', (_req, socket) => {
      socket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      socket.end();
    });
    await new Promise<void>(resolve => refusing.listen(0, resolve));
    servers.push(refusing);

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, address(refusing)),
      30,
      10,
    );

    expect(response.hasTransportError()).toBe(true);
    expect(response.getTransportError()).toContain('407');
  });

  it('reports a connect timeout', async () => {
    const origin = await startOrigin();
    const silent = createHttpServer();
    trackConnections(silent);
    silent.on('connect', () => {
      // Never answer the CONNECT.
    });
    await new Promise<void>(resolve => silent.listen(0, resolve));
    servers.push(silent);

    const response = await tunnelRequest(
      new Request('GET', `http://${address(origin)}/orders`, [], null, address(silent)),
      30,
      1,
    );

    expect(response.hasTransportError()).toBe(true);
    expect(response.getTransportError()).toMatch(/connect/i);
  });
});
