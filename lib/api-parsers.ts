import type { ChatMessage } from '@/contexts/ChatContext';
import type { ChatApiFormat } from '@/lib/chat-config';
import { normalizeChatTitle } from '@/lib/title';
import { ChatContentParts, composeChatContentParts } from '@/lib/chat-thinking';

export function parseErrorDetail(probeText: string): string {
  try {
    const j = JSON.parse(probeText);
    return j?.error?.message || j?.message || JSON.stringify(j).slice(0, 300);
  } catch {
    return (probeText || '').slice(0, 300);
  }
}

export function parseResponseBody(probeText: string): unknown {
  try { return JSON.parse(probeText); } catch { return probeText; }
}

export function parseStreamResponseBody(probeText: string): unknown {
  const cleaned = probeText
    .split('\n')
    .filter((line) => !line.startsWith(':'))
    .join('\n')
    .trim();
  return parseResponseBody(cleaned || probeText);
}

export function extractModelGateMessage(errorText: string): string | null {
  const match = /^HTTP 418:?\s*(.+)$/i.exec((errorText || '').trim());
  return match?.[1]?.trim() || null;
}

export function buildRepeaterReply(prompt: string): string {
  return prompt || '...';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function stringifyTextContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return value == null ? '' : String(value);

  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (isRecord(part) && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

export function extractChatResponseParts(response: unknown, format: ChatApiFormat): ChatContentParts {
  if (!isRecord(response)) return composeChatContentParts('');

  if (format === 'claude') {
    if (typeof response.content === 'string') return composeChatContentParts(response.content);
    if (!Array.isArray(response.content)) return composeChatContentParts('');
    const text = response.content
      .map((block) => {
        if (typeof block === 'string') return block;
        if (isRecord(block) && (block.type === 'text' || (!block.type && typeof block.text === 'string'))) {
          return typeof block.text === 'string' ? block.text : '';
        }
        return '';
      })
      .join('');
    const thinking = response.content
      .map((block) => {
        if (!isRecord(block)) return '';
        if (typeof block.thinking === 'string') return block.thinking;
        if ((block.type === 'thinking' || block.type === 'reasoning') && typeof block.text === 'string') return block.text;
        return '';
      })
      .join('');
    return composeChatContentParts(text, thinking, true);
  }

  if (!Array.isArray(response.choices)) return composeChatContentParts('');
  const choice = response.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) return composeChatContentParts('');
  return composeChatContentParts(
    stringifyTextContent(choice.message.content),
    stringifyTextContent(
      choice.message.reasoning_content
      ?? choice.message.reasoning
      ?? choice.message.thinking
      ?? choice.message.thoughts,
    ),
    true,
  );
}

export function extractChatResponseText(response: unknown, format: ChatApiFormat): string {
  return extractChatResponseParts(response, format).text;
}

export const CHAT_HISTORY_BUDGET = 32 * 1024;

export function buildChatMessages(
  history: ChatMessage[],
  prompt: string,
  systemPrompt: string,
  contextLimit: number,
): Array<{ role: string; content: string }> {
  const sys: Array<{ role: string; content: string }> = [];
  if (systemPrompt && systemPrompt.trim()) {
    sys.push({ role: 'system', content: systemPrompt.trim() });
  }

  const rounds: Array<Array<{ role: string; content: string }>> = [];
  for (const msg of history) {
    if (msg.extra === 'error') continue;
    if (msg.role === 'user') {
      if (msg.prompt) rounds.push([{ role: 'user', content: msg.prompt }]);
    } else if (msg.text) {
      const currentRound = rounds[rounds.length - 1];
      if (currentRound) currentRound.push({ role: 'assistant', content: msg.text });
    }
  }
  const clampedContextLimit = Math.max(0, Math.min(5, contextLimit));
  const keptTurns = clampedContextLimit === 0
    ? []
    : rounds.slice(-clampedContextLimit).flat();
  const turns = keptTurns.slice();
  turns.push({ role: 'user', content: prompt });

  let combined = [...sys, ...turns];
  while (turns.length > 1 && JSON.stringify(combined).length > CHAT_HISTORY_BUDGET) {
    turns.shift();
    while (turns.length > 1 && turns[0].role === 'assistant') turns.shift();
    combined = [...sys, ...turns];
  }
  return combined;
}

export function normalizeGeneratedTitle(value: string): string {
  return normalizeChatTitle(value, { maxLength: 24 });
}
