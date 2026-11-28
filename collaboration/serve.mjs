import { parseArgs } from 'node:util';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startService } from './service.mjs';
import { advertiseLan } from './discovery.mjs';

const { values: args } = parseArgs({ options: {
  mode: { type: 'string', default: 'lan' }, host: { type: 'string', default: '127.0.0.1' },
  port: { type: 'string', default: '8787' }, 'public-url': { type: 'string' },
  data: { type: 'string' }, cert: { type: 'string' }, key: { type: 'string' }, 'synthetic-demo': { type: 'boolean' },
  'no-discovery': { type: 'boolean' },
} });
try {
  if (Boolean(args.key) !== Boolean(args.cert)) throw new Error('Supply both --cert and --key.');
  const tls = args.cert ? { cert: readFileSync(args.cert), key: readFileSync(args.key), minVersion: 'TLSv1.2' } : undefined;
  const port = Number(args.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  if (args.mode === 'remote' && !args['public-url']) throw new Error('Supply an HTTP or HTTPS --public-url for remote mode.');
  const hostPart = args.host.includes(':') ? '[' + args.host + ']' : args.host;
  const origin = args['public-url'] ?? ((tls ? 'https://' : 'http://') + hostPart + ':' + port);
  const dataDir = resolve(args.data ?? join(homedir(), '.prosemap', 'collaboration', args.mode));
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  const service = startService({ mode: args.mode, port, host: args.host, origin, tls, demo: args['synthetic-demo'], dataDir, dist });
  let stopAdvertising;
  service.server.once('listening', () => {
    const tempKey = join(dataDir, 'create-' + process.pid + '.tmp');
    writeFileSync(tempKey, service.createKey + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(tempKey, join(dataDir, 'create.key'));
    if (!args['no-discovery']) stopAdvertising = advertiseLan(args.mode, args.host, origin);
    console.log('ProseMap ' + args.mode + ' service ready at ' + origin + '. Creation key: create.key in the private data directory.');
  });
  service.server.once('error', () => { console.error('Could not listen on the configured address.'); process.exitCode = 1; });
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void Promise.all([stopAdvertising?.(), service.close()]);
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Service startup failed.');
  process.exitCode = 1;
}
