import WebSocket from 'ws';

/** Windows Node cannot connect to the fork's AF_UNIX socket; use an authenticated loopback WS. */
export const localAppServerWebSocket = (endpoint: string, token?: string): WebSocket => {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'ws:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !token ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error(
      'App Server WebSocket requires an explicit loopback port and private capability token'
    );
  return new WebSocket(url, {
    headers: { authorization: `Bearer ${token}` },
    maxPayload: 32 * 1024 * 1024,
  });
};
