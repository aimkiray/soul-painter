import type { AppConfig } from '@/types';

import { get, set } from 'idb-keyval';

export const IMAGE_STREAM_CAPABILITY_STORAGE_KEY = 'imggen-image-stream-capability-v1';
export const IMAGE_STREAM_FIRST_EVENT_TIMEOUT_MS = 60_000;
export const IMAGE_STREAM_COMPLETE_TIMEOUT_MS = 90_000;
export const IMAGE_STREAM_UNSUPPORTED_TTL_MS = 24 * 60 * 60 * 1000;
export const IMAGE_STREAM_SUPPORTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ImageStreamCapability = 'supported' | 'unsupported';

export interface ImageStreamCapabilityRecord {
  state: ImageStreamCapability;
  updatedAt: number;
  expiresAt: number;
}

export function getImageStreamCapabilityKey(endpoint: string, config: AppConfig, model: string, defaultBaseUrl: string) {
  const baseUrl = (config.baseUrl || defaultBaseUrl).trim().replace(/\/+$/, '') || 'server-default';
  return `${endpoint}|${baseUrl}|${model || 'default'}`;
}

async function readImageStreamCapabilities(): Promise<Record<string, ImageStreamCapabilityRecord>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = await get(IMAGE_STREAM_CAPABILITY_STORAGE_KEY);
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? parsed as Record<string, ImageStreamCapabilityRecord> : {};
  } catch {
    return {};
  }
}

async function writeImageStreamCapabilities(records: Record<string, ImageStreamCapabilityRecord>) {
  if (typeof window === 'undefined') return;
  try {
    await set(IMAGE_STREAM_CAPABILITY_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Capability caching is opportunistic.
  }
}

export async function getImageStreamCapability(key: string): Promise<ImageStreamCapability | 'unknown'> {
  const records = await readImageStreamCapabilities();
  const record = records[key];
  if (!record || (record.state !== 'supported' && record.state !== 'unsupported')) return 'unknown';
  if (record.expiresAt <= Date.now()) {
    delete records[key];
    await writeImageStreamCapabilities(records);
    return 'unknown';
  }
  return record.state;
}

export async function setImageStreamCapability(key: string, state: ImageStreamCapability) {
  const now = Date.now();
  const ttl = state === 'unsupported' ? IMAGE_STREAM_UNSUPPORTED_TTL_MS : IMAGE_STREAM_SUPPORTED_TTL_MS;
  const records = await readImageStreamCapabilities();
  records[key] = { state, updatedAt: now, expiresAt: now + ttl };
  await writeImageStreamCapabilities(records);
}

export function createImageStreamAttempt(parentSignal: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  let imageEventSeen = false;
  let completeSeen = false;
  let completeTimeoutId: number | null = null;

  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) {
    controller.abort();
  } else {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    if (imageEventSeen || parentSignal.aborted) return;
    timedOut = true;
    controller.abort();
  }, IMAGE_STREAM_FIRST_EVENT_TIMEOUT_MS);

  const scheduleCompleteTimeout = () => {
    if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
    completeTimeoutId = window.setTimeout(() => {
      if (completeSeen || parentSignal.aborted) return;
      timedOut = true;
      controller.abort();
    }, IMAGE_STREAM_COMPLETE_TIMEOUT_MS);
  };

  return {
    signal: controller.signal,
    markPartial() {
      imageEventSeen = true;
      window.clearTimeout(timeoutId);
      scheduleCompleteTimeout();
    },
    markComplete() {
      imageEventSeen = true;
      completeSeen = true;
      window.clearTimeout(timeoutId);
      if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
    },
    didTimeout() {
      return timedOut;
    },
    cleanup() {
      window.clearTimeout(timeoutId);
      if (completeTimeoutId) window.clearTimeout(completeTimeoutId);
      parentSignal.removeEventListener('abort', abortFromParent);
    },
  };
}
