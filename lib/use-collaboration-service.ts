import { useEffect, useState } from 'react';
import { serviceOrigin, type ServiceMode } from './collaboration-address';
import { probeService } from './collaboration-session';

type Probe = Awaited<ReturnType<typeof probeService>>;

export function useCollaborationService(input: string, mode: ServiceMode) {
  let origin = '', error = '';
  if (input.trim()) {
    try { origin = serviceOrigin(input, mode); }
    catch (reason) { error = reason instanceof Error ? reason.message : '请输入完整的协作服务地址。'; }
  }
  const [attempt, setAttempt] = useState(0);
  const mixedContent = origin.startsWith('http:') && location.protocol === 'https:' && !('__TAURI_INTERNALS__' in window);
  const target = JSON.stringify([origin, mode, attempt]);
  const [last, setLast] = useState<{ target: string; status: Probe }>();
  useEffect(() => {
    if (!origin || mixedContent) return;
    const controller = new AbortController();
    let timer = setTimeout(check, 350);
    async function check() {
      const status = await probeService(origin, mode, controller.signal);
      if (controller.signal.aborted) return;
      setLast({ target, status });
      timer = setTimeout(check, status === 'online' ? 15000 : 5000);
    }
    return () => { controller.abort(); clearTimeout(timer); };
  }, [target, origin, mode, mixedContent]);
  const status = !origin ? 'idle' : mixedContent ? 'mixed-content' : last?.target === target ? last.status : 'checking';
  return { status, origin, error, retry: () => setAttempt(n => n + 1) } as const;
}
