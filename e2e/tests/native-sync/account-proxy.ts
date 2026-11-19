import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A same-origin front for the acceptance server, so a spec can make "the account server" go
 * away and come back while the app shell (served by the same origin) keeps loading:
 * - `down`: every account API request and socket is dropped, as when the network or the
 *   server is unreachable (the client sees a failed fetch, never an HTTP answer);
 * - `drop-refresh-response`: the NEXT refresh reaches the server and CONSUMES the single-use
 *   token, but its response never arrives (a lost response across sleep or a network switch);
 *   the mode then returns to `up`.
 *
 * `Host`, `Origin` and `Referer` are rewritten to the upstream's, so the server's origin
 * checks see the origin it was configured for.
 */
export type ProxyMode = 'up' | 'down' | 'drop-refresh-response';

export interface AccountProxy {
  origin: string;
  mode: ProxyMode;
  /** Requests that REACHED the server per account API path (without the query) since `reset()`. */
  count(path: string): number;
  /** Requests the client attempted, including the ones dropped before the server saw them. */
  attempts(path: string): number;
  /** Like `count`, for every path matching the pattern (paths with ids in them). */
  countMatching(pattern: RegExp): number;
  reset(): void;
  close(): Promise<void>;
}

const API = '/api/v2/accounts';

export const startAccountProxy = async (
  upstreamOrigin: string,
): Promise<AccountProxy> => {
  const upstream = new URL(upstreamOrigin);
  const reached = new Map<string, number>();
  const tried = new Map<string, number>();
  const proxy: AccountProxy = {
    origin: '',
    mode: 'up',
    count: (path) => reached.get(path) ?? 0,
    attempts: (path) => tried.get(path) ?? 0,
    countMatching: (pattern) =>
      [...reached]
        .filter(([path]) => pattern.test(path))
        .reduce((sum, [, n]) => sum + n, 0),
    reset: () => {
      reached.clear();
      tried.clear();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
  const headersFor = (request: IncomingMessage): http.OutgoingHttpHeaders => {
    const headers: http.OutgoingHttpHeaders = { ...request.headers, host: upstream.host };
    if (headers['origin']) headers['origin'] = upstream.origin;
    if (typeof headers['referer'] === 'string')
      headers['referer'] = headers['referer'].replace(
        /^https?:\/\/[^/]+/,
        upstream.origin,
      );
    return headers;
  };
  const note = (counter: Map<string, number>, url: string): void => {
    const path = url.split('?')[0];
    if (path.startsWith(API)) counter.set(path, (counter.get(path) ?? 0) + 1);
  };
  const server = http.createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      const url = request.url ?? '/';
      const isApi = url.startsWith(API);
      note(tried, url);
      if (isApi && proxy.mode === 'down') {
        request.socket.destroy();
        return;
      }
      note(reached, url);
      if (process.env.E2E_PROXY_TRACE)
        console.log(
          `[proxy ${Date.now() % 100000}] ${request.method} ${url.split('?')[0]}`,
        );
      const forwarded = http.request(
        {
          host: upstream.hostname,
          port: upstream.port,
          method: request.method,
          path: url,
          headers: headersFor(request),
        },
        (answer) => {
          if (
            isApi &&
            proxy.mode === 'drop-refresh-response' &&
            url.includes('/sessions/refresh')
          ) {
            // The server answered (and consumed the credential); this one answer is lost,
            // and the network is back for everything after it.
            proxy.mode = 'up';
            answer.resume();
            answer.on('end', () => request.socket.destroy());
            return;
          }
          response.writeHead(answer.statusCode ?? 502, answer.headers);
          answer.pipe(response);
        },
      );
      forwarded.on('error', () => request.socket.destroy());
      request.pipe(forwarded);
    },
  );
  server.on('upgrade', (request: IncomingMessage, socket: net.Socket, head: Buffer) => {
    const url = request.url ?? '/';
    note(tried, url);
    if (url.startsWith(API) && proxy.mode === 'down') {
      socket.destroy();
      return;
    }
    note(reached, url);
    const other = net.connect(Number(upstream.port), upstream.hostname, () => {
      const headers = headersFor(request);
      const lines = [`${request.method} ${url} HTTP/1.1`];
      for (const [name, value] of Object.entries(headers))
        for (const entry of Array.isArray(value) ? value : [value])
          if (entry !== undefined) lines.push(`${name}: ${entry}`);
      other.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) other.write(head);
      socket.pipe(other);
      other.pipe(socket);
    });
    other.on('error', () => socket.destroy());
    socket.on('error', () => other.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  proxy.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return proxy;
};
