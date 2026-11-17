import type { ProviderKind } from './editor';
import type { AiConversationMessage } from './ai-conversation';

export type AiStreamInput = {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  history?: AiConversationMessage[];
  temperature: number;
  maxTokens: number;
};

type DesktopStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type AiStreamHandlers = {
  onContentDelta: (text: string) => void;
  onReasoningDelta?: (text: string) => void;
};

function modelErrorMessage(reason: unknown, fallback = '本地模型请求失败'): string {
  const message = typeof reason === 'string'
    ? reason
    : reason instanceof Error
      ? reason.message
      : reason && typeof reason === 'object' && 'message' in reason
        ? String(reason.message)
        : '';
  return message.trim().replace(/^Error:\s*/i, '') || fallback;
}

async function streamFromDesktop(
  input: AiStreamInput,
  handlers: AiStreamHandlers,
  signal: AbortSignal,
) {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  // A document/session can close while the runtime module is loading. An
  // already-aborted signal will not fire a newly attached abort listener.
  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
  const requestId = crypto.randomUUID();
  const channel = new Channel<DesktopStreamEvent>();
  let streamError = '';
  let completed = false;
  let closed = false;
  let finishDelivery!: () => void;
  const delivered = new Promise<void>(resolve => { finishDelivery = resolve; });
  let deliveryTimeout: ReturnType<typeof setTimeout> | undefined;

  channel.onmessage = (event) => {
    if (closed || signal.aborted || completed || streamError) return;
    if (event.type === 'delta') handlers.onContentDelta(event.text);
    if (event.type === 'reasoning_delta') handlers.onReasoningDelta?.(event.text);
    if (event.type === 'error') { streamError = modelErrorMessage(event.message); finishDelivery(); }
    if (event.type === 'done') { completed = true; finishDelivery(); }
  };

  const cancel = () => {
    finishDelivery();
    void invoke('cancel_ai', { requestId }).catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('stream_ai', { request: { ...input, requestId }, onEvent: channel });
    // Tauri fetches larger channel messages asynchronously. The command may
    // resolve before the ordered final deltas and done event reach JavaScript.
    // Wait for delivery, but fail closed if the channel never completes.
    deliveryTimeout = setTimeout(finishDelivery, 5_000);
    await delivered;
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (streamError) throw new Error(streamError);
    if (!completed) throw new Error('模型响应提前结束，请重试');
  } catch (reason) {
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    throw new Error(streamError || modelErrorMessage(reason));
  } finally {
    closed = true;
    clearTimeout(deliveryTimeout);
    signal.removeEventListener('abort', cancel);
  }
}

export async function isDesktopRuntime(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return false;
  }
}

export async function streamAi(
  input: AiStreamInput,
  onDeltaOrHandlers: ((text: string) => void) | AiStreamHandlers,
  signal: AbortSignal,
) {
  if (!(await isDesktopRuntime())) throw new Error('模型调用只能在 ProseMap 桌面应用中使用');
  const handlers = typeof onDeltaOrHandlers === 'function'
    ? { onContentDelta: onDeltaOrHandlers }
    : onDeltaOrHandlers;
  return streamFromDesktop(input, handlers, signal);
}
