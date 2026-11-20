export const MAX_AI_CONVERSATION_CHARACTERS = 20_000;
export const MAX_AI_CONVERSATION_TURNS = 6;
const MAX_STORED_CONVERSATION_CHARACTERS = 200_000;
const MAX_STORED_CONVERSATION_TURNS = 30;

export type AiConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AiConversationTurn = {
  id: string;
  instruction: string;
  output: string;
  status: 'proposed' | 'applied' | 'discarded' | 'answered';
  truncatedReferences?: { includedCharacters: number };
};

export type AiConversationHistory = {
  messages: AiConversationMessage[];
  includedTurns: number;
  omittedTurns: number;
  includedCharacters: number;
};

function boundedLimit(value: number, maximum: number): number {
  return Number.isNaN(value) ? 0 : Math.max(0, Math.min(maximum, Math.floor(value)));
}

function historyInstruction(turn: AiConversationTurn): string {
  const status = {
    proposed: 'This output was a proposal. Do not assume it was applied to the document.',
    applied: 'This output was applied at that time. The document may have changed since then.',
    discarded: 'This output was discarded. Do not treat it as the current document.',
    answered: 'This was an answer about the document at the time of the question. It did not edit the document.',
  }[turn.status];
  return `${turn.instruction}\n\n[Conversation state: ${status} The current document or diagram supplied in the latest request is authoritative.]`;
}

/**
 * Keep a recent, contiguous suffix of complete exchanges. Never send a partial
 * output or skip a large recent exchange to include an older, misleading one.
 * The character budget includes state annotations sent to the model.
 */
export function createAiConversationHistory(
  turns: AiConversationTurn[],
  maxCharacters = MAX_AI_CONVERSATION_CHARACTERS,
  maxTurns = MAX_AI_CONVERSATION_TURNS,
): AiConversationHistory {
  const characterLimit = boundedLimit(maxCharacters, MAX_AI_CONVERSATION_CHARACTERS);
  const turnLimit = boundedLimit(maxTurns, MAX_AI_CONVERSATION_TURNS);
  const pairs: AiConversationMessage[][] = [];
  let includedCharacters = 0;
  for (let index = turns.length - 1; index >= 0 && pairs.length < turnLimit; index -= 1) {
    const turn = turns[index];
    if (!turn.instruction.trim() || !turn.output.trim()) break;
    const instruction = historyInstruction(turn);
    const characters = instruction.length + turn.output.length;
    if (includedCharacters + characters > characterLimit) break;
    pairs.unshift([
      { role: 'user', content: instruction },
      { role: 'assistant', content: turn.output },
    ]);
    includedCharacters += characters;
  }
  return {
    messages: pairs.flat(),
    includedTurns: pairs.length,
    omittedTurns: turns.length - pairs.length,
    includedCharacters,
  };
}

/** Bound local session memory as well as the subset sent to the model. */
export function appendAiConversationTurn(
  turns: AiConversationTurn[],
  turn: AiConversationTurn,
): AiConversationTurn[] {
  if (!turn.instruction.trim() || !turn.output.trim()) return turns;
  const next = [...turns.filter((existing) => existing.id !== turn.id), turn];
  let characters = 0;
  let first = next.length;
  while (first > 0 && next.length - first < MAX_STORED_CONVERSATION_TURNS) {
    const previous = next[first - 1];
    const size = previous.instruction.length + previous.output.length;
    if (characters + size > MAX_STORED_CONVERSATION_CHARACTERS) break;
    characters += size;
    first -= 1;
  }
  return next.slice(first);
}
