export const MODEL_GATE_VERSION_TAPS = 3;
export const MODEL_GATE_ENABLED_COOKIE = 'model_gate_enabled';
export const MODEL_GATE_UNLOCKED_COOKIE = 'model_gate_unlocked';
export const MODEL_GATE_TAP_COOKIE = 'model_gate_taps';
export const MODEL_GATE_UNLOCK_MAX_AGE_SEC = 20 * 24 * 60 * 60;

export const MODEL_GATE_MESSAGES = [
  '模型今天在午睡，熟悉这里的人知道怎么把它叫醒。',
  '访问口令暂时失踪了，看看标题栏，也许它留了暗号。',
  '服务器说需要一点熟人确认，完成后再继续。',
  '模型把门轻轻带上了，先完成标题栏的小确认。',
  '今天的接入姿势不太传统，确认身份后再继续。',
  '模型正在装酷，完成熟人小动作后它才愿意上班。',
] as const;

export function getRandomModelGateMessage() {
  return MODEL_GATE_MESSAGES[Math.floor(Math.random() * MODEL_GATE_MESSAGES.length)] || MODEL_GATE_MESSAGES[0];
}

function getModelGateSecret(): string {
  return (
    process.env.MODEL_GATE_SECRET ||
    process.env.DEFAULT_API_KEY ||
    process.env.DEFAULT_CHAT_API_KEY ||
    'soul-painter-local-model-gate'
  );
}

async function signModelGatePayload(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getModelGateSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function createModelGateUnlockToken(now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload = `v1.${issuedAt}`;
  const signature = await signModelGatePayload(payload);
  return `${payload}.${signature}`;
}

export async function verifyModelGateUnlockToken(
  token: string | undefined | null,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const issuedAt = Number(parts[1]);
  if (!Number.isInteger(issuedAt) || issuedAt <= 0) return false;

  const age = Math.floor(now / 1000) - issuedAt;
  if (age < 0 || age > MODEL_GATE_UNLOCK_MAX_AGE_SEC) return false;

  const payload = `v1.${issuedAt}`;
  const expected = await signModelGatePayload(payload);
  return timingSafeEqual(expected, parts[2]);
}
