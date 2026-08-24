import type { ProviderKind } from './editor';

export type AiStreamInput = {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
};

type DesktopStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

async function streamFromDesktop(
  input: AiStreamInput,
  onDelta: (text: string) => void,
  signal: AbortSignal,
) {
  const { Channel, invoke } = await import('@tauri-apps/api/core');
  const requestId = crypto.randomUUID();
  const channel = new Channel<DesktopStreamEvent>();
  let streamError = '';

  channel.onmessage = (event) => {
    if (event.type === 'delta') onDelta(event.text);
    if (event.type === 'error') streamError = event.message;
  };

  const cancel = () => { void invoke('cancel_ai', { requestId }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await invoke('stream_ai', { request: { ...input, requestId }, onEvent: channel });
    if (streamError) throw new Error(streamError);
  } catch (reason) {
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    throw new Error(typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '本地模型请求失败');
  } finally {
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
  onDelta: (text: string) => void,
  signal: AbortSignal,
) {
  if (!(await isDesktopRuntime())) throw new Error('模型调用只能在 ProseMap 桌面应用中使用');
  return streamFromDesktop(input, onDelta, signal);
}
