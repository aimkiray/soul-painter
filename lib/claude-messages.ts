import { isRecord, stringifyTextContent } from '@/lib/api-parsers';

// Shared OpenAI→Claude body conversion for the server runner and the
// /api/chat/completions proxy. Anthropic requires strictly alternating
// user/assistant roles: consecutive same-role turns (e.g. a failed or
// canceled run leaves an unanswered user turn, then the next prompt adds
// another, or an empty message gets dropped) are merged into one message —
// otherwise the upstream rejects the whole request.
export function toClaudeMessagesBody(body: Record<string, unknown>) {
  const sourceMessages = Array.isArray(body.messages) ? body.messages : [];
  const systemParts: string[] = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const item of sourceMessages) {
    if (!isRecord(item)) continue;
    const role = typeof item.role === 'string' ? item.role : '';
    const content = stringifyTextContent(item.content).trim();
    if (!content) continue;

    if (role === 'system' || role === 'developer') {
      systemParts.push(content);
    } else if (role === 'user' || role === 'assistant') {
      const last = messages[messages.length - 1];
      if (last && last.role === role) last.content += `\n\n${content}`;
      else messages.push({ role, content });
    }
  }

  const maxTokens = Number(body.max_tokens ?? body.maxTokens ?? 4096);
  const claudeBody: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 4096,
  };
  if (body.stream !== undefined) claudeBody.stream = Boolean(body.stream);
  // A client may already send a top-level system string (Claude-shaped
  // body) — merge it with anything extracted from the messages list.
  const topLevelSystem = typeof body.system === 'string' ? body.system.trim() : '';
  if (systemParts.length > 0 || topLevelSystem) {
    claudeBody.system = [...systemParts, topLevelSystem].filter(Boolean).join('\n\n');
  }
  // Anthropic-native or pass-through fields the converter must not drop.
  for (const key of ['temperature', 'top_p', 'top_k', 'stop_sequences', 'thinking', 'tools', 'tool_choice', 'metadata'] as const) {
    if (body[key] !== undefined) claudeBody[key] = body[key];
  }
  // OpenAI-style `stop` maps to stop_sequences.
  if (claudeBody.stop_sequences === undefined) {
    if (Array.isArray(body.stop)) claudeBody.stop_sequences = body.stop;
    else if (typeof body.stop === 'string' && body.stop) claudeBody.stop_sequences = [body.stop];
  }
  return claudeBody;
}
