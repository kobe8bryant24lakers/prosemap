type ProviderKind = 'openai' | 'anthropic';

type AiRequestBody = {
  provider?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  system?: unknown;
  prompt?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: JSON_HEADERS });
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/\.(local|internal|lan|home|test|invalid|example)$/.test(host)) return true;
  if (host.includes(':')) return true;
  const ipv4 = host.split('.');
  if (ipv4.length === 4 && ipv4.every((part) => /^\d{1,3}$/.test(part))) return true;
  return false;
}

function resolveEndpoint(provider: ProviderKind, baseUrl: string, ownHostname: string): URL {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:') throw new Error('API 地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含凭据、查询参数或锚点');
  if (url.port && url.port !== '443') throw new Error('API 地址仅允许标准 HTTPS 端口');
  if (isBlockedHostname(url.hostname)) throw new Error('API 地址必须是公开域名');
  if (url.hostname.toLowerCase() === ownHostname.toLowerCase()) throw new Error('API 地址不能指向当前应用');

  const suffix = provider === 'openai' ? '/chat/completions' : '/messages';
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.toLowerCase().endsWith(suffix) ? path : `${path}${suffix}`;
  return url;
}

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function extractMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return '上游服务返回了错误';
  const record = value as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  if (record.error && typeof record.error === 'object') {
    const error = record.error as Record<string, unknown>;
    if (typeof error.message === 'string') return error.message;
  }
  return '上游服务拒绝了本次请求';
}

function safeProviderError(raw: string, apiKey: string): string {
  try {
    return extractMessage(JSON.parse(raw)).replaceAll(apiKey, '[已隐藏]').slice(0, 500);
  } catch {
    return '上游服务返回了无法识别的错误';
  }
}

function openAiDelta(payload: Record<string, unknown>): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const delta = first?.delta as Record<string, unknown> | undefined;
  const content = delta?.content ?? first?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string' ? record.text : '';
    }).join('');
  }
  return '';
}

function anthropicDelta(payload: Record<string, unknown>): string {
  if (payload.type !== 'content_block_delta') return '';
  const delta = payload.delta as Record<string, unknown> | undefined;
  return delta?.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : '';
}

function providerStream(upstream: Response, provider: ProviderKind): ReadableStream<Uint8Array> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = '';
      let receivedBytes = 0;
      try {
        while (!cancelled) {
          const { value, done } = await reader.read();
          if (done) break;
          receivedBytes += value.byteLength;
          if (receivedBytes > 8 * 1024 * 1024) throw new Error('模型输出超过 8 MB 限制');
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data || data === '[DONE]') continue;
            let payload: Record<string, unknown>;
            try {
              payload = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (payload.error) throw new Error(extractMessage(payload));
            const text = provider === 'openai' ? openAiDelta(payload) : anthropicDelta(payload);
            if (text) controller.enqueue(encoder.encode(text));
          }
        }
        if (!cancelled) controller.close();
      } catch (reason) {
        if (!cancelled) controller.error(reason instanceof Error ? reason : new Error('流式响应意外中断'));
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      cancelled = true;
      return reader.cancel(reason);
    },
  });
}

function extractNonStreamingText(provider: ProviderKind, payload: Record<string, unknown>): string {
  if (provider === 'openai') {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
    return typeof message?.content === 'string' ? message.content : '';
  }
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    const record = part as Record<string, unknown>;
    return record.type === 'text' && typeof record.text === 'string' ? record.text : '';
  }).join('');
}

export async function POST(request: Request) {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return jsonError('仅接受 JSON 请求', 415);
  }
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 512 * 1024) return jsonError('请求内容过大', 413);

  let body: AiRequestBody;
  try {
    body = await request.json() as AiRequestBody;
  } catch {
    return jsonError('请求格式无效');
  }

  const provider = body.provider === 'openai' || body.provider === 'anthropic' ? body.provider : null;
  const apiKey = normalizeText(request.headers.get('x-ai-api-key'), 512);
  const baseUrl = normalizeText(body.baseUrl, 2048);
  const model = normalizeText(body.model, 160);
  const system = normalizeText(body.system, 12_000);
  const prompt = normalizeText(body.prompt, 120_000);

  if (!apiKey) return jsonError('缺少 API 密钥', 401);
  if (!provider || !baseUrl || !model || !system || !prompt) return jsonError('模型配置或请求内容不完整');
  if (!/^[\w.:/@+-]+$/.test(model)) return jsonError('模型名称包含不支持的字符');

  let endpoint: URL;
  try {
    endpoint = resolveEndpoint(provider, baseUrl, new URL(request.url).hostname);
  } catch (reason) {
    return jsonError(reason instanceof Error ? reason.message : 'API 地址无效');
  }

  const temperature = typeof body.temperature === 'number' && Number.isFinite(body.temperature)
    ? Math.min(1, Math.max(0, body.temperature))
    : 0.35;
  const maxTokens = typeof body.maxTokens === 'number' && Number.isInteger(body.maxTokens)
    ? Math.min(8192, Math.max(256, body.maxTokens))
    : 4096;

  const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' });
  let upstreamBody: Record<string, unknown>;

  if (provider === 'openai') {
    headers.set('Authorization', `Bearer ${apiKey}`);
    upstreamBody = {
      model,
      stream: true,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    };
  } else {
    headers.set('x-api-key', apiKey);
    headers.set('anthropic-version', '2023-06-01');
    upstreamBody = {
      model,
      stream: true,
      temperature,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    };
  }

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(upstreamBody),
      signal: request.signal,
      redirect: 'manual',
    });
  } catch (reason) {
    if (request.signal.aborted) return jsonError('请求已取消', 499);
    return jsonError(reason instanceof Error && reason.message.includes('redirect') ? 'API 地址发生了不安全的跳转' : '无法连接模型服务', 502);
  }

  if (upstream.status >= 300 && upstream.status < 400) return jsonError('API 地址发生了不安全的跳转', 502);

  if (!upstream.ok) {
    const raw = (await upstream.text()).slice(0, 4000);
    const message = safeProviderError(raw, apiKey);
    const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
    return jsonError(message, status);
  }

  if (!upstream.body) return jsonError('模型服务没有返回内容', 502);

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    try {
      const payload = await upstream.json() as Record<string, unknown>;
      const text = extractNonStreamingText(provider, payload);
      if (!text) return jsonError('模型服务返回了空内容', 502);
      return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch {
      return jsonError('模型服务返回了无法识别的内容', 502);
    }
  }

  return new Response(providerStream(upstream, provider), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
