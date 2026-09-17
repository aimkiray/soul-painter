export interface ChatContentParts {
  text: string;
  thinking: string;
  thinkingDone: boolean;
}

// Reasoning tag names shared with lib/title.ts so both strip the same set.
export const REASONING_TAG_NAMES = ['think', 'thinking', 'analysis'] as const;

const EMPTY_CHAT_CONTENT: ChatContentParts = {
  text: '',
  thinking: '',
  thinkingDone: true,
};

function normalizeThinkingText(value: string) {
  return value
    .replace(/^\s+|\s+$/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

export function splitThinkTaggedContent(value: string): ChatContentParts {
  if (!value) return EMPTY_CHAT_CONTENT;

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const tagRe = new RegExp(`</?(?:${REASONING_TAG_NAMES.join('|')})\\b[^>]*>`, 'gi');
  let cursor = 0;
  let inThinking = false;
  let sawThinking = false;
  let match: RegExpExecArray | null;

  while ((match = tagRe.exec(value)) !== null) {
    const segment = value.slice(cursor, match.index);
    if (inThinking) thinkingParts.push(segment);
    else textParts.push(segment);

    const tag = match[0].toLowerCase();
    if (tag.startsWith('</')) {
      inThinking = false;
    } else {
      sawThinking = true;
      inThinking = true;
    }
    cursor = match.index + match[0].length;
  }

  const tail = value.slice(cursor);
  if (inThinking) thinkingParts.push(tail);
  else textParts.push(tail);

  if (!sawThinking) {
    return {
      text: textParts.join(''),
      thinking: '',
      thinkingDone: true,
    };
  }

  return {
    text: textParts.join('').replace(/^\s+/, ''),
    thinking: normalizeThinkingText(thinkingParts.join('')),
    thinkingDone: !inThinking,
  };
}

export function composeChatContentParts(
  text: string,
  thinking = '',
  thinkingDone = true,
): ChatContentParts {
  const tagged = splitThinkTaggedContent(text);
  const combinedThinking = [thinking, tagged.thinking]
    .map(normalizeThinkingText)
    .filter(Boolean)
    .join('\n\n');

  return {
    text: tagged.text,
    thinking: combinedThinking,
    thinkingDone: combinedThinking ? thinkingDone && tagged.thinkingDone : true,
  };
}
