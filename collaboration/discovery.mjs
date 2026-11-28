import { randomBytes } from 'node:crypto';
import ciao from '@homebridge/ciao';
import { collaborationProtocol, isLoopbackOrigin } from '../lib/collaboration-address.ts';

// Advertise only the interface and port the administrator chose. Remote and
// loopback-only listeners have no LAN advertisement.
export function advertiseLan(mode, host, origin) {
  const url = new URL(origin);
  if (mode !== 'lan' || isLoopbackOrigin(origin) || url.hostname.replace(/^\[|\]$/g, '') !== host) return;
  const suffix = randomBytes(4).toString('hex');
  let responder;
  const unavailable = () => console.warn('LAN discovery unavailable. The configured service address still works.');
  try {
    responder = ciao.getResponder({ interface: host });
    const service = responder.createService({
      name: 'ProseMap ' + suffix, hostname: 'prosemap-' + suffix, type: 'prosemap',
      restrictedAddresses: [host], port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
      txt: { version: String(collaborationProtocol), scheme: url.protocol.slice(0, -1) },
    });
    void service.advertise().catch(unavailable);
  } catch { unavailable(); }
  return () => responder?.shutdown().catch(unavailable);
}
