import type { ChatMessage, ChatTurnSnapshot } from '@/contexts/ChatContext';
import type { AppConfig, AppOptions, ImageHit } from '@/types';
import { SERVER_RUN_PENDING_STORAGE_KEY } from '@/lib/constants';

export type ServerRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface ServerRunResult {
  prompt: string;
  images: ImageHit[];
  text: string;
  thinking?: string;
  thinkingDone?: boolean;
  code: string;
  extra: string;
  debugRaw?: string;
  statusText?: string;
  statusType?: '' | 'ok' | 'err' | 'warn';
}

export interface ServerRunCreatePayload {
  id: string;
  accessToken: string;
  sessionId: string;
  userMessageId: string;
  botMessageId: string;
  prompt: string;
  config: AppConfig;
  options: AppOptions;
  request: ChatTurnSnapshot;
  historyMessages: ChatMessage[];
  appOrigin?: string;
}

export interface ServerRunRecord extends Omit<ServerRunCreatePayload, 'accessToken'> {
  accessTokenHash: string;
  status: ServerRunStatus;
  result?: ServerRunResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export type ServerRunPublicRecord = Pick<
  ServerRunRecord,
  | 'id'
  | 'sessionId'
  | 'userMessageId'
  | 'botMessageId'
  | 'prompt'
  | 'request'
  | 'status'
  | 'result'
  | 'error'
  | 'createdAt'
  | 'updatedAt'
  | 'startedAt'
  | 'completedAt'
>;

export interface PendingServerRunRef {
  id: string;
  accessToken: string;
  sessionId: string;
  userMessageId: string;
  botMessageId: string;
  createdAt: number;
}

function isPendingServerRunRef(value: unknown): value is PendingServerRunRef {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingServerRunRef>;
  return !!item.id && !!item.accessToken && !!item.sessionId && !!item.userMessageId && !!item.botMessageId;
}

export function createServerRunId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createServerRunAccessToken() {
  return `${createServerRunId()}.${createServerRunId()}`;
}

export function toPublicServerRun(run: ServerRunRecord): ServerRunPublicRecord {
  return {
    id: run.id,
    sessionId: run.sessionId,
    userMessageId: run.userMessageId,
    botMessageId: run.botMessageId,
    prompt: run.prompt,
    request: run.request,
    status: run.status,
    result: run.result,
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  };
}

export function readPendingServerRuns(): PendingServerRunRef[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(SERVER_RUN_PENDING_STORAGE_KEY) || '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPendingServerRunRef).slice(-50) : [];
  } catch {
    return [];
  }
}

export function writePendingServerRuns(items: PendingServerRunRef[]) {
  if (typeof window === 'undefined') return;
  const deduped = new Map<string, PendingServerRunRef>();
  for (const item of items) deduped.set(item.id, item);
  try {
    localStorage.setItem(SERVER_RUN_PENDING_STORAGE_KEY, JSON.stringify([...deduped.values()].slice(-50)));
  } catch {
    // ignore
  }
}

export function addPendingServerRun(item: PendingServerRunRef) {
  writePendingServerRuns([...readPendingServerRuns(), { ...item, createdAt: item.createdAt || Date.now() }]);
}

export function removePendingServerRun(runId: string) {
  writePendingServerRuns(readPendingServerRuns().filter((item) => item.id !== runId));
}
