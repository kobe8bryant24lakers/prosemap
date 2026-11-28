import * as Y from 'yjs';
import { fromBase64, toBase64, toBase64UrlEncoded, toHexString } from 'lib0/buffer';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { collaborationProtocol, collaborationService, socketUrl, type SessionLink, type ServiceMode } from './collaboration-address.ts';

export type Role = 'owner' | 'edit' | 'read';
type Invite = { token: string; expires: number };
export type Invites = Record<'edit' | 'read', Invite | null>;
type User = { name: string; color: string };
type ServerMessage =
  | { type: 'service'; service: string; protocol: number; mode: ServiceMode }
  | { type: 'ready'; role: Role; title: string; state: string; vector: string; user: User; invites?: Invites }
  | { type: 'presence'; client: number; clock: number; user: User; cursor: unknown }
  | { type: 'gone'; client: number } | { type: 'invites'; invites: Invites }
  | { type: 'update'; data: string } | { type: 'ack'; seq: number }
  | { type: 'created' | 'denied' | 'rejected' | 'pong' };
type Wire = { send: (message: object) => Promise<void>; close: () => void };

async function connectWire(origin: string, receive: (m: ServerMessage) => void, closed: (code?: number) => void): Promise<Wire> {
  const url = socketUrl(origin);
  const parse = (raw: string) => {
    try { receive(JSON.parse(raw)); } catch { closed(4400); }
  };
  if ('__TAURI_INTERNALS__' in window) {
    const { default: NativeSocket } = await import('@tauri-apps/plugin-websocket');
    const socket = await NativeSocket.connect(url);
    const stop = socket.addListener(m => {
      if (m.type === 'Text') parse(m.data);
      else if (m.type === 'Close') closed(m.data?.code);
    });
    return { send: m => socket.send(JSON.stringify(m)), close: () => { stop(); void socket.disconnect().catch(() => {}); } };
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onmessage = event => parse(event.data);
    ws.onerror = () => reject(new Error('无法连接协作服务，请检查地址和网络。'));
    ws.onclose = event => { reject(new Error('无法连接协作服务，请检查地址和网络。')); closed(event.code); };
    ws.onopen = () => resolve({
      send: async m => { ws.send(JSON.stringify(m)); },
      close: () => { ws.onclose = null; ws.onmessage = null; ws.close(); },
    });
  });
}

export function newRoomLink(mode: ServiceMode, origin: string): SessionLink {
  return { mode, origin, room: toHexString(crypto.getRandomValues(new Uint8Array(16))), token: toBase64UrlEncoded(crypto.getRandomValues(new Uint8Array(32))) };
}

function transportConsent({ origin, mode }: SessionLink) {
  if (!origin.startsWith('http:')) return {};
  return mode === 'lan' ? { synthetic: true } : { allowPlaintext: true };
}

function requestOnce(origin: string, message: object, signal: AbortSignal, timeout: number) {
  return new Promise<ServerMessage>((resolve, reject) => {
    let wire: Wire | undefined;
    let done = false;
    const finish = (reply?: ServerMessage) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      wire?.close();
      if (reply) resolve(reply); else reject(new Error('无法连接协作服务，请检查地址和网络。'));
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, timeout);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    void connectWire(origin, finish, cancel).then(async socket => {
      if (done) { socket.close(); return; }
      wire = socket;
      await wire.send(message);
    }).catch(cancel);
  });
}

export async function probeService(origin: string, mode: ServiceMode, signal: AbortSignal) {
  try {
    const reply = await requestOnce(origin, { type: 'probe' }, signal, 3500);
    // First-stage servers reply "denied" to unknown pre-authentication messages.
    if (reply.type === 'denied') return 'legacy' as const;
    if (reply.type !== 'service' || reply.service !== collaborationService || reply.protocol !== collaborationProtocol) return 'incompatible' as const;
    return reply.mode === mode ? 'online' as const : 'wrong-mode' as const;
  } catch { return 'offline' as const; }
}

export async function createSharedCopy(link: SessionLink, key: string, title: string, markdown: string, signal: AbortSignal) {
  const reply = await requestOnce(link.origin, { type: 'create', mode: link.mode, room: link.room, token: link.token,
    key, title, markdown, ...transportConsent(link) }, signal, 12000);
  if (reply.type !== 'created') throw new Error('创建失败，请检查服务模式、创建密钥及正文大小（最多 2 MB）。');
}

export type SessionStatus = 'connecting' | 'online' | 'offline' | 'denied' | 'rejected';
export type SessionState = { status: SessionStatus; role?: Role; title: string; dirty: boolean; people: number; invites: Invites };
const network = Symbol('network');

export class SharedSession {
  readonly doc = new Y.Doc();
  readonly body = this.doc.getText('markdown');
  readonly awareness = new Awareness(this.doc);
  readonly link: SessionLink;
  state: SessionState = { status: 'connecting', title: '', dirty: false, people: 0, invites: { edit: null, read: null } };
  private changed: (s: SessionState) => void;
  private wire?: Wire;
  private epoch = 0;
  private retry = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private queue: Uint8Array[] = [];
  private seq = 0;
  private inFlight = 0;

  constructor(link: SessionLink, changed: (s: SessionState) => void) {
    this.link = link;
    this.changed = changed;
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === network) return;
      this.set({ dirty: true });
      if (this.state.status === 'online') { this.queue.push(update); this.flush(); }
    });
    this.awareness.on('update', (_changes: unknown, origin: unknown) => {
      if (origin !== 'local' || this.state.status !== 'online') return;
      this.send({ type: 'presence', clock: this.awareness.meta.get(this.doc.clientID)?.clock, cursor: this.awareness.getLocalState()?.cursor ?? null });
    });
    this.awareness.on('change', () => this.set({ people: this.awareness.getStates().size }));
  }

  private set(patch: Partial<SessionState>) {
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }

  private send(m: object) {
    const epoch = this.epoch;
    void this.wire?.send(m).catch(() => { if (epoch === this.epoch) this.disconnected(); });
  }

  private flush() {
    if (this.inFlight || !this.queue.length || this.state.status !== 'online') return;
    const data = this.queue.length === 1 ? this.queue[0] : Y.mergeUpdates(this.queue);
    this.queue = [];
    this.inFlight = ++this.seq;
    this.send({ type: 'update', seq: this.inFlight, data: toBase64(data) });
  }

  private receive(m: ServerMessage) {
    switch (m.type) {
      case 'denied': this.disconnected(4403); break;
      case 'rejected': this.disconnected(4400); break;
      case 'ready': {
        Y.applyUpdate(this.doc, fromBase64(m.state), network);
        this.retry = 0;
        this.set({ status: 'online', role: m.role, title: m.title, invites: m.invites ?? { edit: null, read: null } });
        this.awareness.setLocalStateField('user', m.user);
        if (this.state.dirty && m.role !== 'read') {
          this.queue.push(Y.encodeStateAsUpdate(this.doc, fromBase64(m.vector)));
          this.flush();
        }
        break;
      }
      case 'update': Y.applyUpdate(this.doc, fromBase64(m.data), network); break;
      case 'ack':
        if (m.seq === this.inFlight) {
          this.inFlight = 0;
          if (this.queue.length) this.flush(); else this.set({ dirty: false });
        }
        break;
      case 'presence': {
        // The service assigns each socket its own identity and sanitizes its cursor.
        if (m.client === this.doc.clientID || !/^#[0-9a-f]{6}$/i.test(m.user.color)) break;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 1);
        encoding.writeVarUint(encoder, m.client);
        encoding.writeVarUint(encoder, m.clock);
        encoding.writeVarString(encoder, JSON.stringify({ user: m.user, cursor: m.cursor }));
        applyAwarenessUpdate(this.awareness, encoding.toUint8Array(encoder), network);
        break;
      }
      case 'gone': removeAwarenessStates(this.awareness, [m.client], network); break;
      case 'invites': this.set({ invites: m.invites }); break;
    }
  }

  connect() {
    this.resetWire();
    const epoch = this.epoch;
    this.set({ status: this.state.role ? 'offline' : 'connecting' });
    let lastSeen = Date.now();
    this.heartbeat = setInterval(() => {
      if (Date.now() - lastSeen > (this.state.status === 'online' ? 35000 : 12000)) this.disconnected();
      else if (this.state.status === 'online') this.send({ type: 'ping' });
    }, 5000);
    void connectWire(this.link.origin, m => {
      if (this.epoch !== epoch) return;
      lastSeen = Date.now();
      this.receive(m);
    }, code => { if (this.epoch === epoch) this.disconnected(code); }).then(wire => {
      if (this.epoch !== epoch) { wire.close(); return; }
      this.wire = wire;
      const { mode, room, token } = this.link;
      this.send({ type: 'join', mode, room, token, client: this.doc.clientID, ...transportConsent(this.link) });
    }).catch(() => { if (this.epoch === epoch) this.disconnected(); });
  }

  invite(role: 'edit' | 'read', action: 'issue' | 'revoke') {
    if (this.state.role === 'owner' && this.state.status === 'online') this.send({ type: 'invite', role, action });
  }

  private resetWire() {
    this.epoch++;
    clearTimeout(this.timer);
    clearInterval(this.heartbeat);
    this.wire?.close();
    this.wire = undefined;
    this.queue = [];
    this.inFlight = 0;
  }

  private disconnected(code?: number) {
    this.resetWire();
    const status = code === 4403 ? 'denied' : (code === 4400 || code === 1009) ? 'rejected' : 'offline';
    this.set({ status });
    removeAwarenessStates(this.awareness, [...this.awareness.getStates().keys()].filter(id => id !== this.doc.clientID), network);
    if (status === 'offline') this.timer = setTimeout(() => this.connect(), Math.min(10000, 500 * 2 ** this.retry++));
  }

  destroy() {
    this.resetWire();
    this.changed = () => {};
    this.doc.destroy();
  }
}
