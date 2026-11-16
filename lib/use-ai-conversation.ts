import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelConfig } from './editor';
import type { AiConversationTurn } from './ai-conversation';
import { appendPendingAiConversationTurn, prepareAiConversation, type AiConversationMemory } from './ai-compaction';

type ConversationState = { turns: AiConversationTurn[]; memory: AiConversationMemory | null };
const emptyConversation = (): ConversationState => ({ turns: [], memory: null });

/** Keep compression and its source turns atomic across resets and async requests. */
export function useAiConversation() {
  const [state, setState] = useState<ConversationState>(emptyConversation);
  const current = useRef(state);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; current.current = emptyConversation(); };
  }, []);
  const replace = useCallback((next: ConversationState) => {
    current.current = next;
    setState(next);
  }, []);
  const reset = useCallback(() => replace(emptyConversation()), [replace]);
  const append = useCallback((turn: AiConversationTurn) => {
    replace({ ...current.current, turns: appendPendingAiConversationTurn(current.current.turns, turn) });
  }, [replace]);
  const updateStatus = useCallback((id: string, status: AiConversationTurn['status']) => {
    if (!current.current.turns.some(turn => turn.id === id && turn.status !== status)) return;
    replace({ ...current.current, turns: current.current.turns.map(turn => turn.id === id ? { ...turn, status } : turn) });
  }, [replace]);
  const prepare = useCallback(async (
    config: ModelConfig,
    budget: number,
    signal: AbortSignal,
    onProgress: (progress: { completed: number; total: number }) => void,
    isCurrent: () => boolean,
  ) => {
    const snapshot = current.current;
    const valid = () => mounted.current && !signal.aborted && current.current === snapshot && isCurrent();
    const prepared = await prepareAiConversation({
      ...snapshot,
      budget,
      config,
      signal,
      isCurrent: valid,
      onProgress: progress => {
        if (valid()) onProgress({ completed: progress.completedBatches, total: progress.totalBatches });
      },
    });
    if (!valid()) throw new DOMException('请求已取消', 'AbortError');
    if (prepared.didCompact) replace({ turns: prepared.turns, memory: prepared.memory });
    return prepared.history;
  }, [replace]);

  return { ...state, reset, append, updateStatus, prepare };
}
