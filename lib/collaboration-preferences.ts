import { serviceOrigin, type ServiceMode } from './collaboration-address.ts';

const serversKey = 'prosemap.collab.servers';
const modeKey = 'prosemap.collab.mode';

export function remoteServices(): string[] {
  try {
    const saved = localStorage.getItem(serversKey);
    const values: unknown = saved === null ? [localStorage.getItem('prosemap.collab.remote')] : JSON.parse(saved);
    const origins = new Set<string>();
    if (Array.isArray(values)) for (const value of values) {
      if (typeof value !== 'string') continue;
      try { origins.add(serviceOrigin(value, 'remote')); } catch { /* Ignore invalid saved addresses. */ }
    }
    return Array.from(origins);
  } catch { return []; }
}

export function configureRemoteService(address: string, action: 'prefer' | 'remove') {
  const origin = serviceOrigin(address, 'remote');
  const servers = remoteServices().filter(s => s !== origin);
  if (action === 'prefer') servers.unshift(origin);
  try {
    localStorage.setItem(serversKey, JSON.stringify(servers));
    if (action === 'prefer') localStorage.setItem(modeKey, 'remote');
    else if (!servers.length && localStorage.getItem(modeKey) === 'remote') localStorage.removeItem(modeKey);
  } catch { throw new Error('无法在此设备保存服务器地址。'); }
  return servers;
}

export function preferredMode(): ServiceMode {
  try {
    const saved = localStorage.getItem(modeKey);
    if (saved === 'lan' || saved === 'remote') return saved;
  } catch { /* Use the current app origin. */ }
  if (remoteServices().length) return 'remote';
  if (!('__TAURI_INTERNALS__' in window)) {
    const hostedMode = document.querySelector<HTMLMetaElement>('meta[name="prosemap-service-mode"]')?.content;
    if (hostedMode === 'remote' || hostedMode === 'lan') return hostedMode;
    if (location.protocol === 'https:') return 'remote';
  }
  return 'lan';
}

export function savedAddress(mode: ServiceMode) {
  try {
    const saved = mode === 'remote' ? remoteServices()[0] : localStorage.getItem('prosemap.collab.lan');
    if (saved) return serviceOrigin(saved, mode);
  } catch { /* Allow a one-session address. */ }
  if (!('__TAURI_INTERNALS__' in window)) {
    try { return serviceOrigin(location.origin, mode); } catch { /* Use the default below. */ }
  }
  return mode === 'lan' ? 'http://127.0.0.1:8787' : '';
}

export function rememberSharedService(mode: ServiceMode, origin: string) {
  try {
    if (mode === 'remote') configureRemoteService(origin, 'prefer');
    else {
      localStorage.setItem('prosemap.collab.lan', serviceOrigin(origin, mode));
      localStorage.setItem(modeKey, mode);
    }
  } catch { /* Sharing can continue when local preferences are unavailable. */ }
}
