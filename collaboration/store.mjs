import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';

export const MAX_TEXT = 2 * 1024 * 1024;
export const MAX_STATE = 8 * 1024 * 1024;
const hash = value => createHash('sha256').update(value).digest();
const secret = () => randomBytes(32).toString('base64url');
const roles = ['edit', 'read'];

export class RoomStore {
  constructor(directory, lifetime = 24 * 60 * 60 * 1000) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'rooms.sqlite');
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec([
      'PRAGMA locking_mode=EXCLUSIVE', 'PRAGMA journal_mode=WAL', 'PRAGMA synchronous=FULL', 'PRAGMA foreign_keys=ON',
      'CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, secret TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, owner BLOB NOT NULL, title TEXT NOT NULL, state BLOB NOT NULL)',
      'CREATE TABLE IF NOT EXISTS invites (room TEXT REFERENCES rooms(id), role TEXT, nonce TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(room,role))',
    ].join(';'));
    this.db.prepare('INSERT OR IGNORE INTO settings VALUES (1, ?)').run(secret());
    this.master = this.db.prepare('SELECT secret FROM settings WHERE id=1').get().secret;
    this.createKey = this.derive('create');
    this.lifetime = lifetime;
  }

  derive(...parts) {
    return createHmac('sha256', this.master).update(JSON.stringify(parts)).digest('base64url');
  }

  create({ key, room, token, title, markdown }) {
    if (typeof key !== 'string' || !timingSafeEqual(hash(key), hash(this.createKey))) return false;
    if (!/^[0-9a-f]{32}$/.test(room) || !/^[A-Za-z0-9_-]{43}$/.test(token)
      || typeof title !== 'string' || title.length > 100 || typeof markdown !== 'string' || Buffer.byteLength(markdown) > MAX_TEXT) return false;
    const existing = this.db.prepare('SELECT owner FROM rooms WHERE id=?').get(room);
    if (existing) return timingSafeEqual(existing.owner, hash(token));
    const doc = new Y.Doc();
    try {
      doc.getText('markdown').insert(0, markdown.replace(/\r\n?/g, '\n'));
      this.db.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?)').run(room, hash(token), title, Y.encodeStateAsUpdate(doc));
    } finally { doc.destroy(); }
    return true;
  }

  invitations(room) {
    const invites = { edit: null, read: null };
    for (const row of this.db.prepare('SELECT role, nonce, expires FROM invites WHERE room=? AND expires>?').all(room, Date.now())) {
      invites[row.role] = { token: this.derive(room, row.role, row.nonce), expires: row.expires };
    }
    return invites;
  }

  role(room, token) {
    if (!/^[0-9a-f]{32}$/.test(room) || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare('SELECT owner FROM rooms WHERE id=?').get(room);
    if (!row) return null;
    const digest = hash(token);
    if (timingSafeEqual(digest, row.owner)) return 'owner';
    for (const [role, invite] of Object.entries(this.invitations(room))) {
      if (invite && timingSafeEqual(digest, hash(invite.token))) return role;
    }
    return null;
  }

  changeInvitation(room, role, issue) {
    if (!roles.includes(role)) throw new Error('Invalid role');
    if (issue) this.db.prepare('INSERT OR REPLACE INTO invites VALUES (?, ?, ?, ?)').run(room, role, secret(), Date.now() + this.lifetime);
    else this.db.prepare('DELETE FROM invites WHERE room=? AND role=?').run(room, role);
  }

  snapshot(room) {
    return this.db.prepare('SELECT title,state FROM rooms WHERE id=?').get(room);
  }

  // Validate in a disposable document. Only publish/ack after the durable write.
  apply(room, bytes) {
    if (bytes.length > MAX_STATE) return false;
    const doc = new Y.Doc();
    try {
      const body = doc.getText('markdown');
      Y.applyUpdate(doc, this.snapshot(room).state);
      Y.applyUpdate(doc, bytes);
      if (doc.store.pendingStructs || doc.store.pendingDs || doc.share.size !== 1 || Object.keys(body.getAttributes()).length || body.length > MAX_TEXT
        || body.toDelta().some(op => typeof op.insert !== 'string' || op.attributes || op.insert.includes('\r'))
        || Buffer.byteLength(body.toString()) > MAX_TEXT) return false;
      const state = Y.encodeStateAsUpdate(doc);
      if (state.length > MAX_STATE) return false;
      this.db.prepare('UPDATE rooms SET state=? WHERE id=?').run(state, room);
      return true;
    } finally { doc.destroy(); }
  }
}
