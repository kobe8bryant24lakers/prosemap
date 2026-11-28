export type ServiceMode = 'lan' | 'remote';
export type SessionLink = { mode: ServiceMode; origin: string; room: string; token: string };
export const collaborationService = 'prosemap-collaboration';
export const collaborationProtocol = 1;

export function isLocalAddress(host: string) {
  if (host === 'localhost' || host === '[::1]' || host === '::1') return true;
  const ipv6 = host.replace(/^\[([^\]]+)\]$/, '$1');
  if (/^f[cd][0-9a-f]{2}:[0-9a-f:]+$/i.test(ipv6)) {
    try { new URL('http://[' + ipv6 + ']/'); return true; }
    catch { return false; }
  }
  const parts = host.split('.');
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function isLoopbackOrigin(input: string) {
  try {
    const host = new URL(input).hostname;
    return host === 'localhost' || host === '[::1]' || /^127\./.test(host);
  } catch { return false; }
}

export function serviceOrigin(input: string, mode: ServiceMode) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('请输入完整的协作服务地址。'); }
  if (url.username || url.password || url.href.includes('#') || url.href.includes('?') || url.port === '0'
    || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) {
    throw new Error('请输入完整的协作服务地址。');
  }
  if (mode === 'lan' && !isLocalAddress(url.hostname)) throw new Error('局域网模式需要本机或内网 IP 地址。');
  return url.origin;
}

export function parseSessionLink(input: string): SessionLink {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error('邀请链接无效，请粘贴完整链接。'); }
  const match = /^#session\/(lan|remote)\/([0-9a-f]{32})\/([A-Za-z0-9_-]{43})$/.exec(url.hash);
  if (!match) throw new Error('邀请链接无效，请粘贴完整链接。');
  url.hash = '';
  const mode = match[1] as ServiceMode;
  return { mode, origin: serviceOrigin(url.href, mode), room: match[2], token: match[3] };
}

export function sessionUrl({ origin, mode, room, token }: SessionLink) {
  return origin + '/#session/' + mode + '/' + room + '/' + token;
}

export function socketUrl(origin: string) {
  const url = new URL('/sync', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}
