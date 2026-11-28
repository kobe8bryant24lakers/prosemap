import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { createReadStream, readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { RoomStore, MAX_STATE } from './store.mjs';
import { collaborationProtocol, collaborationService, isLocalAddress, serviceOrigin, socketUrl } from '../lib/collaboration-address.ts';

const colors = ['#365f9d', '#963e58', '#33765d', '#785698', '#925d24', '#2e7385'];
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const validId = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const invalid = () => { throw new Error('Invalid presence'); };
function cursorPoint(p) {
  if (!p || p.tname !== 'markdown' || p.type != null || ![-1, 0, 1].includes(p.assoc ?? 0)) invalid();
  if (p.item != null && (!validId(p.item.client) || !validId(p.item.clock))) invalid();
  return { tname: 'markdown', assoc: p.assoc ?? 0, item: p.item ? { client: p.item.client, clock: p.item.clock } : null };
}

export function startService({ mode, host, port, origin, tls, demo = false, dataDir, dist, inviteLifetime }) {
  if (!['lan', 'remote'].includes(mode) || !isLocalAddress(host)) throw new Error('Bind to loopback or a private IP address.');
  origin = serviceOrigin(origin, mode);
  const cleartext = origin.startsWith('http:');
  const tlsAtProxy = !tls && !cleartext;
  if (cleartext && tls) throw new Error('An HTTP public URL cannot use --cert and --key. Use an HTTPS public URL for TLS.');
  if (cleartext && mode === 'lan' && !demo) throw new Error('Plain HTTP in LAN mode requires --synthetic-demo.');
  if (tlsAtProxy && !['127.0.0.1', '::1'].includes(host)) throw new Error('The TLS reverse-proxy upstream must bind to loopback.');
  const publicHost = new URL(origin).host;
  const allowed = req => req.headers.host === publicHost && (!tlsAtProxy || req.headers['x-forwarded-proto'] === 'https');
  // Serve a closed list of regular frontend build files, never a requested disk path.
  const files = new Map([['/', join(dist, 'index.html')]]);
  const editorPage = readFileSync(files.get('/'), 'utf8')
    .replace('</head>', '<meta name="prosemap-service-mode" content="' + mode + '"></head>');
  for (const entry of readdirSync(join(dist, 'assets'), { withFileTypes: true })) {
    if (entry.isFile() && mime[extname(entry.name)]) files.set('/assets/' + entry.name, join(dist, 'assets', entry.name));
  }
  const store = new RoomStore(dataDir, inviteLifetime);
  const handler = (req, res) => {
    const file = files.get(req.url);
    if (!allowed(req) || !file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404).end(); return; }
    res.writeHead(200, {
      'Content-Type': mime[extname(file)], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Cache-Control': req.url === '/' ? 'no-store' : 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self' data:; connect-src 'self' wss: " + (cleartext ? "ws:" : socketUrl(origin)) + "; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    if (req.method === 'HEAD') res.end();
    else if (req.url === '/') res.end(editorPage);
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  };
  const server = tls ? httpsServer(tls, handler) : httpServer(handler);
  const connections = new Set();
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 12 * 1024 * 1024, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req) || req.url !== '/sync' || sockets.clients.size >= 256) { socket.destroy(); return; }
    sockets.handleUpgrade(req, socket, head, ws => sockets.emit('connection', ws));
  });
  const rooms = new Map();
  const send = (ws, message) => {
    if (ws.bufferedAmount > 16 * 1024 * 1024) { ws.terminate(); return; }
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  const deny = ws => { send(ws, { type: 'denied' }); ws.close(4403, 'Access denied'); };
  const authorized = peer => peer.role === 'owner' || store.role(peer.room, peer.token) === peer.role;
  // Recheck access on delivery as well as on receipt, including idle read-only peers.
  const broadcast = (room, message, except, ownersOnly = false) => {
    for (const [ws, peer] of rooms.get(room) ?? []) {
      if (ws === except || (ownersOnly && peer.role !== 'owner')) continue;
      if (authorized(peer)) send(ws, message);
      else deny(ws);
    }
  };

  sockets.on('connection', ws => {
    let peer;
    let expires;
    let alive = true;
    const authTimeout = setTimeout(() => ws.terminate(), 8000);
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return; }
      if (peer && !authorized(peer)) { deny(ws); return; }
      alive = false;
      ws.ping();
    }, 20000);
    ws.on('error', () => ws.terminate());
    ws.on('message', (raw, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        if (binary) { deny(ws); return; }
        const m = JSON.parse(raw.toString());
        if (!peer) {
          if (m.type === 'probe') {
            send(ws, { type: 'service', service: collaborationService, protocol: collaborationProtocol, mode });
            ws.close(1000);
            return;
          }
          if (m.mode !== mode || (cleartext && (mode === 'lan' ? m.synthetic : m.allowPlaintext) !== true)) { deny(ws); return; }
          if (m.type === 'create') {
            if (store.create(m)) { send(ws, { type: 'created' }); ws.close(1000); }
            else deny(ws);
            return;
          }
          const role = m.type === 'join' && store.role(m.room, m.token);
          if (!role || !validId(m.client)) { deny(ws); return; }
          const members = rooms.get(m.room) ?? new Map();
          if (members.size >= 64 || Array.from(members.values()).some(p => p.client === m.client)) { ws.close(1013, 'Retry later'); return; }
          const user = { name: 'P' + String(m.client).slice(-5), color: colors[m.client % colors.length] };
          peer = { room: m.room, token: m.token, role, client: m.client, user, clock: 0, cursor: null };
          clearTimeout(authTimeout);
          if (role !== 'owner') {
            const invitation = store.invitations(m.room)[role];
            if (!invitation) { peer = undefined; deny(ws); return; }
            expires = setTimeout(() => deny(ws), Math.max(0, invitation.expires - Date.now()));
          }
          members.set(ws, peer);
          rooms.set(m.room, members);
          const { title, state } = store.snapshot(m.room);
          send(ws, { type: 'ready', role, title, state: Buffer.from(state).toString('base64'),
            vector: Buffer.from(Y.encodeStateVectorFromUpdate(state)).toString('base64'), user,
            invites: role === 'owner' ? store.invitations(m.room) : undefined });
          for (const other of members.values()) {
            if (other !== peer) send(ws, presence(other));
          }
          broadcast(peer.room, presence(peer), ws);
          return;
        }
        if (!authorized(peer)) { deny(ws); return; }
        const room = peer.room;
        if (m.type === 'ping') { send(ws, { type: 'pong' }); }
        else if (m.type === 'update' && peer.role !== 'read') {
          if (typeof m.data !== 'string' || m.data.length > Math.ceil(MAX_STATE / 3) * 4 || !Number.isSafeInteger(m.seq)) { deny(ws); return; }
          const bytes = Buffer.from(m.data, 'base64');
          if (!bytes.length || bytes.toString('base64') !== m.data || !store.apply(room, bytes)) { send(ws, { type: 'rejected' }); ws.close(4400); return; }
          broadcast(room, { type: 'update', data: m.data }, ws);
          send(ws, { type: 'ack', seq: m.seq });
        } else if (m.type === 'presence' && validId(m.clock)) {
          if (m.clock <= peer.clock) return;
          peer.cursor = m.cursor == null ? null : { anchor: cursorPoint(m.cursor.anchor), head: cursorPoint(m.cursor.head) };
          peer.clock = m.clock;
          broadcast(room, presence(peer), ws);
        } else if (m.type === 'invite' && peer.role === 'owner' && ['issue', 'revoke'].includes(m.action) && ['read', 'edit'].includes(m.role)) {
          store.changeInvitation(room, m.role, m.action === 'issue');
          for (const [other, member] of rooms.get(room)) if (member.role === m.role) deny(other);
          broadcast(room, { type: 'invites', invites: store.invitations(room) }, null, true);
        } else { deny(ws); }
      } catch {
        // Keep user text, credentials and filesystem details out of diagnostics.
        send(ws, { type: 'rejected' });
        ws.close(4400, 'Request rejected');
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimeout);
      clearInterval(heartbeat);
      clearTimeout(expires);
      if (!peer) return;
      const members = rooms.get(peer.room);
      members.delete(ws);
      if (!members.size) rooms.delete(peer.room);
      else broadcast(peer.room, { type: 'gone', client: peer.client });
    });
  });
  function presence(p) {
    return { type: 'presence', client: p.client, clock: p.clock, user: p.user, cursor: p.cursor };
  }

  server.listen(port, host);
  let stopping;
  function close() {
    if (stopping) return stopping;
    stopping = Promise.all([
      new Promise(resolve => sockets.close(resolve)),
      new Promise(resolve => server.close(resolve)),
    ]).then(() => store.db.close());
    for (const ws of sockets.clients) ws.terminate();
    // Also close idle proxy transports and unfinished HTTP handshakes on stop.
    for (const socket of connections) socket.destroy();
    return stopping;
  }
  return { server, createKey: store.createKey, close };
}
