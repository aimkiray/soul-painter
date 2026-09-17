import { REASONING_TAG_NAMES } from './chat-thinking';

interface NormalizeChatTitleOptions {
  fallback?: string;
  maxLength?: number;
  appendEllipsis?: boolean;
}

const DEFAULT_MAX_TITLE_LENGTH = 24;

const REASONING_TAG_GROUP = REASONING_TAG_NAMES.join('|');
const STRAY_REASONING_TAG_RE = new RegExp(`</?(?:${REASONING_TAG_GROUP})\\b[^>]*>`, 'gi');

function stripReasoningBlocks(value: string) {
  let out = value;
  for (const tag of REASONING_TAG_NAMES) {
    out = out
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), ' ')
      .replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i'), ' ');
  }
  return out.replace(STRAY_REASONING_TAG_RE, ' ');
}

function extractJsonTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return '';

  try {
    const parsed = JSON.parse(trimmed) as { title?: unknown; name?: unknown };
    if (typeof parsed.title === 'string') return parsed.title;
    if (typeof parsed.name === 'string') return parsed.name;
  } catch {
    // Plain text titles are expected; JSON is only a best-effort cleanup path.
  }

  return '';
}

function cleanTitleCandidate(value: string) {
  return value
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(?:^|\s)(?:原因|理由|说明|because|reason)\s*[:：][\s\S]*$/i, '')
    .replace(/^\s*(?:#{1,6}|[-*+•]|\d+[.)])\s*/, '')
    .replace(/^["'“”‘’《》「」『』【】[\](){}]+|["'“”‘’《》「」『』【】[\](){}]+$/g, '')
    .replace(/^(?:title|chat title|conversation title|summary title|标题|题目|名称|会话标题|聊天标题)\s*[:：\-—]\s*/i, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/[*_~`]+/g, '')
    .replace(/^["'“”‘’《》「」『』【】[\](){}]+|["'“”‘’《》「」『』【】[\](){}]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。.!！?？,，;；:：、]+$/g, '')
    .trim();
}

function looksLikeReasoning(value: string) {
  const lower = value.toLowerCase();
  return /^(creating|create|summariz|thinking|analysis|reasoning|need to|we need|i need|the user|assistant|user)\b/.test(lower)
    || lower.includes('return only')
    || lower.includes('no quotes')
    || lower.includes('under 12')
    || lower.includes('concise chinese chat title');
}

function splitTitleGraphemes(value: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function truncateTitle(value: string, maxLength: number, appendEllipsis: boolean) {
  const chars = splitTitleGraphemes(value);
  if (chars.length <= maxLength) return value;
  return `${chars.slice(0, maxLength).join('')}${appendEllipsis ? '...' : ''}`;
}

function normalizeFallback(value: string, maxLength: number, appendEllipsis: boolean) {
  const fallback = cleanTitleCandidate(stripReasoningBlocks(value));
  return fallback ? truncateTitle(fallback, maxLength, appendEllipsis) : '';
}

export function normalizeChatTitle(value: unknown, options: NormalizeChatTitleOptions = {}) {
  const maxLength = options.maxLength ?? DEFAULT_MAX_TITLE_LENGTH;
  const appendEllipsis = options.appendEllipsis ?? false;
  const fallback = normalizeFallback(options.fallback ?? '', maxLength, appendEllipsis);
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  if (!raw.trim()) return fallback;

  const jsonTitle = extractJsonTitle(raw);
  const stripped = stripReasoningBlocks(jsonTitle || raw)
    .replace(/\uFEFF/g, '')
    // Keep U+200D (ZWJ): removing it would break apart multi-person emoji
    // before grapheme-aware truncation can keep them whole.
    .replace(/[\u200B\u200C\u2060]/g, '')
    .trim();

  const candidates = stripped
    .split(/\r?\n/)
    .map(cleanTitleCandidate)
    .filter((candidate) => candidate && !looksLikeReasoning(candidate));

  const candidate = candidates[0] || cleanTitleCandidate(stripped);
  if (!candidate || looksLikeReasoning(candidate)) return fallback;
  return truncateTitle(candidate, maxLength, appendEllipsis);
}
