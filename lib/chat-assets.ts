import { copyFile, mkdir, opendir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { isChatAssetSessionId } from '@/lib/chat-asset-session-id';
import { ipIsPrivate } from '@/lib/ip-private';
import { fetchPinned, type ResolvedAddress } from '@/lib/pinned-fetch';

const CHAT_ASSET_DIR = path.join(process.cwd(), 'data', 'chat-assets');
const MAX_IMAGE_BYTES = getPositiveEnvInt('CHAT_ASSET_MAX_IMAGE_BYTES', 8 * 1024 * 1024);
const SESSION_MAX_BYTES = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_BYTES', 256 * 1024 * 1024);
const SESSION_MAX_FILES = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_FILES', 200);
const SESSION_MAX_AGE_MS = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_AGE_DAYS', 30) * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
// Global disk budget across ALL session dirs: per-session quotas alone cannot
// stop an attacker rotating anonymous cookies to mint unbounded session dirs.
const CHAT_ASSETS_MAX_TOTAL_BYTES = getPositiveEnvInt('CHAT_ASSETS_MAX_TOTAL_BYTES', 1024 * 1024 * 1024);
// The running total is re-measured by walking the store at most this often;
// between refreshes it is kept accurate by write/delete deltas.
const STORE_TOTAL_REFRESH_MS = 60_000;
const REMOTE_FETCH_TIMEOUT_MS = getPositiveEnvInt('CHAT_ASSET_REMOTE_FETCH_TIMEOUT_MS', 15_000);
const REMOTE_FETCH_MAX_REDIRECTS = getPositiveEnvInt('CHAT_ASSET_REMOTE_FETCH_MAX_REDIRECTS', 3);
export const CHAT_ASSET_MAX_BODY_BYTES = getPositiveEnvInt(
  'CHAT_ASSET_MAX_BODY_BYTES',
  Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 * 1024,
);
export const CHAT_ASSET_CACHE_MAX_AGE_SECONDS = getPositiveEnvInt('CHAT_ASSET_CACHE_MAX_AGE_SECONDS', 60 * 60);
const ASSET_ID_PATTERN = /^[a-f0-9]{64}\.(png|jpg|jpeg|webp|gif)$/;
const SESSION_META_FILE = 'meta.json';
let lastCleanupStartedAt = 0;
let cleanupPromise: Promise<void> | null = null;

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export interface StoredChatAsset {
  id: string;
  url: string;
  mime: string;
  size: number;
}

export interface ChatAssetSource {
  dataUrl?: string;
  url?: string;
}

export interface ChatAssetCopyResult {
  copied: number;
  skipped: number;
  failed: Array<{ id: string; error: string }>;
}

interface SessionAssetFile {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

interface SessionMeta {
  sessionId: string;
  lastAccessedAt: number;
}

function isMissingPathError(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function getPositiveEnvInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error('Invalid image data');

  const mime = match[1].toLowerCase();
  const isBase64 = !!match[2];
  const data = (match[3] || '').replace(/\s+/g, '');
  const buffer = isBase64
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data));
  return { bytes: new Uint8Array(buffer), mime };
}

function isPrivateIp(ip: string) {
  // Delegated to lib/ip-private.ts: byte-level parsing catches expanded IPv6
  // forms (v4-mapped/v4-compatible, 6to4, Teredo, NAT64) that prefix string
  // checks miss.
  return ipIsPrivate(ip);
}

export interface PublicRemoteImageUrl {
  url: URL;
  /** Validated addresses the fetch must pin to (prevents DNS-rebinding TOCTOU). */
  addresses: ResolvedAddress[];
}

export async function assertPublicRemoteUrl(rawUrl: string): Promise<PublicRemoteImageUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid image URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Unsupported image URL protocol');
  }
  if (url.username || url.password) {
    throw new Error('Image URL credentials are not allowed');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || hostname === 'localhost') {
    throw new Error('Image URL host is not allowed');
  }

  const literalFamily = net.isIP(hostname);
  if (literalFamily) {
    if (isPrivateIp(hostname)) throw new Error('Image URL host is not allowed');
    return { url, addresses: [{ address: hostname, family: literalFamily }] };
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error('Image URL host is not allowed');
  }

  return { url, addresses };
}

async function readResponseBytes(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Image response is empty');

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Image is too large');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchRemoteImageBytes(
  rawUrl: string,
  redirects = 0,
  deadline = Date.now() + REMOTE_FETCH_TIMEOUT_MS,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const { url, addresses } = await assertPublicRemoteUrl(rawUrl);
  // DNS validation above shares the same timeout budget as the fetch itself.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));

  try {
    const response = await fetchPinned(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
    }, addresses);

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= REMOTE_FETCH_MAX_REDIRECTS) throw new Error('Too many image redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid image redirect');
      return fetchRemoteImageBytes(new URL(location, url).toString(), redirects + 1, deadline);
    }

    if (!response.ok) throw new Error('Failed to fetch image URL');

    const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!MIME_TO_EXT[mime]) throw new Error('Unsupported image type');

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) throw new Error('Image is too large');

    return { bytes: await readResponseBytes(response), mime };
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new Error('Image URL fetch timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function isValidChatAssetId(assetId: string) {
  return ASSET_ID_PATTERN.test(assetId);
}

function assetPath(sessionId: string, assetId: string) {
  if (!isChatAssetSessionId(sessionId)) throw new Error('Invalid asset session');
  if (!isValidChatAssetId(assetId)) throw new Error('Invalid asset id');
  return path.join(CHAT_ASSET_DIR, sessionId, assetId);
}

function sessionDir(sessionId: string) {
  if (!isChatAssetSessionId(sessionId)) throw new Error('Invalid asset session');
  return path.join(CHAT_ASSET_DIR, sessionId);
}

function sessionMetaPath(sessionId: string) {
  return path.join(sessionDir(sessionId), SESSION_META_FILE);
}

async function readSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  try {
    const meta = JSON.parse(await readFile(sessionMetaPath(sessionId), 'utf8')) as Partial<SessionMeta>;
    if (meta.sessionId !== sessionId || typeof meta.lastAccessedAt !== 'number') return null;
    return { sessionId, lastAccessedAt: meta.lastAccessedAt };
  } catch {
    return null;
  }
}

export async function touchChatAssetSession(sessionId: string, now = Date.now()) {
  const dir = sessionDir(sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    sessionMetaPath(sessionId),
    JSON.stringify({ sessionId, lastAccessedAt: now }),
  );
}

async function listSessionAssets(
  sessionId: string,
  options: { strictOpen?: boolean } = {},
): Promise<SessionAssetFile[]> {
  const dir = sessionDir(sessionId);
  const files: SessionAssetFile[] = [];
  let handle;
  try {
    handle = await opendir(dir);
  } catch (error) {
    if (options.strictOpen && !isMissingPathError(error)) throw error;
    return [];
  }

  for await (const entry of handle) {
    if (!entry.isFile() || !isValidChatAssetId(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    try {
      const fileStat = await stat(filePath);
      files.push({
        name: entry.name,
        path: filePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch {
      // Ignore files that disappeared between directory listing and stat.
    }
  }
  return files;
}

async function enforceSessionAssetLimits(sessionId: string, protectedAssetId?: string) {
  const files = await listSessionAssets(sessionId);
  let totalSize = files.reduce((sum, file) => sum + file.size, 0);
  let totalFiles = files.length;

  if (totalSize <= SESSION_MAX_BYTES && totalFiles <= SESSION_MAX_FILES) return;

  const evictionQueue = files
    .filter((file) => file.name !== protectedAssetId)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);

  while ((totalSize > SESSION_MAX_BYTES || totalFiles > SESSION_MAX_FILES) && evictionQueue.length > 0) {
    const file = evictionQueue.shift()!;
    try {
      await rm(file.path, { force: true });
      totalSize -= file.size;
      totalFiles -= 1;
      noteStoredBytesDelta(-file.size);
    } catch {
      // Best effort cleanup; the next save will try again.
    }
  }
}

async function cleanupExpiredChatAssetSessions() {
  let handle;
  try {
    handle = await opendir(CHAT_ASSET_DIR);
  } catch {
    return;
  }

  const expiresBefore = Date.now() - SESSION_MAX_AGE_MS;
  let removedAny = false;
  for await (const entry of handle) {
    if (!entry.isDirectory() || !isChatAssetSessionId(entry.name)) continue;
    const dir = path.join(CHAT_ASSET_DIR, entry.name);
    try {
      const meta = await readSessionMeta(entry.name);
      const fallbackStat = meta ? null : await stat(dir);
      const lastAccessedAt = meta?.lastAccessedAt || fallbackStat?.mtimeMs || 0;
      if (lastAccessedAt < expiresBefore) {
        await rm(dir, { recursive: true, force: true });
        removedAny = true;
      }
    } catch {
      // Best effort cleanup; ignore directories that disappear mid-scan.
    }
  }
  // Whole dirs were removed; force the next budget check to re-measure.
  if (removedAny) storeBytesCache = null;
}

function scheduleExpiredChatAssetCleanup() {
  const now = Date.now();
  if (cleanupPromise || now - lastCleanupStartedAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupStartedAt = now;
  cleanupPromise = cleanupExpiredChatAssetSessions()
    .catch(() => undefined)
    .finally(() => {
      cleanupPromise = null;
    });
}

/** Thrown when the cross-session store budget is exhausted; routes map this
 *  507-style failure to a retryable 429 response. */
export class ChatAssetStoreFullError extends Error {
  constructor() {
    super('Chat asset storage is full, please retry later');
    this.name = 'ChatAssetStoreFullError';
  }
}

let storeBytesCache: { bytes: number; measuredAt: number } | null = null;
let storeBytesMeasure: Promise<number> | null = null;

/** Keep the cached total accurate between full re-measurements. */
function noteStoredBytesDelta(delta: number) {
  if (storeBytesCache) storeBytesCache.bytes = Math.max(0, storeBytesCache.bytes + delta);
}

async function measureStoreBytes(): Promise<number> {
  let total = 0;
  let handle;
  try {
    handle = await opendir(CHAT_ASSET_DIR);
  } catch {
    return 0;
  }
  for await (const entry of handle) {
    if (!entry.isDirectory() || !isChatAssetSessionId(entry.name)) continue;
    const dir = path.join(CHAT_ASSET_DIR, entry.name);
    let inner;
    try {
      inner = await opendir(dir);
    } catch {
      continue;
    }
    for await (const file of inner) {
      if (!file.isFile()) continue;
      try {
        total += (await stat(path.join(dir, file.name))).size;
      } catch {
        // File disappeared mid-scan; the total stays approximately correct.
      }
    }
  }
  return total;
}

async function totalStoredBytes(): Promise<number> {
  if (storeBytesCache && Date.now() - storeBytesCache.measuredAt < STORE_TOTAL_REFRESH_MS) {
    return storeBytesCache.bytes;
  }
  // Single-flight the directory walk so concurrent saves share one scan.
  storeBytesMeasure ??= measureStoreBytes()
    .then((bytes) => {
      storeBytesCache = { bytes, measuredAt: Date.now() };
      return bytes;
    })
    .finally(() => {
      storeBytesMeasure = null;
    });
  return storeBytesMeasure;
}

interface SessionDirSummary {
  sessionId: string;
  lastAccessedAt: number;
  bytes: number;
}

// While the store is over budget every upload would otherwise re-walk every
// session dir (listSessionAssets + readSessionMeta per dir). A short-lived
// single-flight result keeps eviction roughly current without rescanning.
let sessionDirSummaryCache: { summaries: SessionDirSummary[]; measuredAt: number } | null = null;
let sessionDirSummaryMeasure: Promise<SessionDirSummary[]> | null = null;
const SESSION_SUMMARY_REFRESH_MS = 10_000;

async function measureSessionDirSummaries(): Promise<SessionDirSummary[]> {
  let handle;
  try {
    handle = await opendir(CHAT_ASSET_DIR);
  } catch {
    return [];
  }
  const summaries: SessionDirSummary[] = [];
  for await (const entry of handle) {
    if (!entry.isDirectory() || !isChatAssetSessionId(entry.name)) continue;
    try {
      const files = await listSessionAssets(entry.name);
      const meta = await readSessionMeta(entry.name);
      let lastAccessedAt = meta?.lastAccessedAt || 0;
      if (!lastAccessedAt) {
        lastAccessedAt = (await stat(path.join(CHAT_ASSET_DIR, entry.name))).mtimeMs;
      }
      summaries.push({
        sessionId: entry.name,
        lastAccessedAt,
        bytes: files.reduce((sum, file) => sum + file.size, 0),
      });
    } catch {
      // Directory disappeared mid-scan; skip it.
    }
  }
  return summaries.sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
}

/** Session dirs sorted oldest-idle first — the same ordering the expired
 *  session cleanup applies via lastAccessedAt. */
function listSessionDirSummaries(): Promise<SessionDirSummary[]> {
  if (sessionDirSummaryCache && Date.now() - sessionDirSummaryCache.measuredAt < SESSION_SUMMARY_REFRESH_MS) {
    return Promise.resolve(sessionDirSummaryCache.summaries);
  }
  sessionDirSummaryMeasure ??= measureSessionDirSummaries()
    .then((summaries) => {
      sessionDirSummaryCache = { summaries, measuredAt: Date.now() };
      return summaries;
    })
    .finally(() => {
      sessionDirSummaryMeasure = null;
    });
  return sessionDirSummaryMeasure;
}

/** Enforce the global store budget before a write: evict oldest-idle sessions
 *  until under budget, and fail when eviction cannot make room. */
async function enforceGlobalStoreBudget(protectedSessionId: string) {
  let total = await totalStoredBytes();
  if (total <= CHAT_ASSETS_MAX_TOTAL_BYTES) return;

  for (const summary of await listSessionDirSummaries()) {
    if (total <= CHAT_ASSETS_MAX_TOTAL_BYTES) break;
    if (summary.sessionId === protectedSessionId) continue;
    await rm(path.join(CHAT_ASSET_DIR, summary.sessionId), { recursive: true, force: true })
      .catch(() => undefined);
    total -= summary.bytes;
    noteStoredBytesDelta(-summary.bytes);
    // Drop the evicted dir from the cached scan so a re-entry inside the TTL
    // cannot double-subtract it.
    if (sessionDirSummaryCache) {
      sessionDirSummaryCache.summaries = sessionDirSummaryCache.summaries
        .filter((item) => item.sessionId !== summary.sessionId);
    }
  }
  if (total > CHAT_ASSETS_MAX_TOTAL_BYTES) throw new ChatAssetStoreFullError();
}

export async function clearChatAssets(sessionId: string) {
  await rm(sessionDir(sessionId), { recursive: true, force: true });
  // Whole-dir removal: force the next budget check to re-measure.
  storeBytesCache = null;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

export async function copyChatAssetsBetweenSessions(
  sourceSessionId: string,
  targetSessionId: string,
): Promise<ChatAssetCopyResult> {
  const result: ChatAssetCopyResult = { copied: 0, skipped: 0, failed: [] };
  if (sourceSessionId === targetSessionId) return result;

  const files = await listSessionAssets(sourceSessionId, { strictOpen: true });
  if (files.length === 0) return result;

  await mkdir(sessionDir(targetSessionId), { recursive: true });
  for (const file of files) {
    const targetPath = assetPath(targetSessionId, file.name);
    try {
      await stat(targetPath);
      result.skipped += 1;
      continue;
    } catch {
      // Missing target is expected; copying below handles real failures.
    }

    try {
      await copyFile(file.path, targetPath);
      result.copied += 1;
      noteStoredBytesDelta(file.size);
    } catch (error) {
      result.failed.push({ id: file.name, error: errorMessage(error) });
    }
  }

  if (result.copied > 0 || result.skipped > 0) {
    await touchChatAssetSession(targetSessionId);
    await enforceSessionAssetLimits(targetSessionId);
    // The copy duplicated bytes, so the global budget is re-checked after the
    // copy (before would risk evicting the source session mid-migration).
    await enforceGlobalStoreBudget(targetSessionId);
    scheduleExpiredChatAssetCleanup();
  }

  return result;
}

export async function saveChatAsset(sessionId: string, bytes: Uint8Array, mime: string): Promise<StoredChatAsset> {
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new Error('Unsupported image type');
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large');
  }

  // Global budget runs before any write so cookie-rotated anonymous sessions
  // cannot grow the store without bound.
  await enforceGlobalStoreBudget(sessionId);

  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `${hash}.${ext}`;
  const filePath = assetPath(sessionId, id);

  await touchChatAssetSession(sessionId);
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, bytes);
    noteStoredBytesDelta(bytes.byteLength);
  }
  await enforceSessionAssetLimits(sessionId, id);
  scheduleExpiredChatAssetCleanup();

  return {
    id,
    url: `/api/chat-assets/${id}`,
    mime,
    size: bytes.byteLength,
  };
}

export async function resolveChatAsset(sessionId: string, source: ChatAssetSource): Promise<StoredChatAsset> {
  if (source.dataUrl) {
    const { bytes, mime } = dataUrlToBytes(source.dataUrl);
    return saveChatAsset(sessionId, bytes, mime);
  }

  if (source.url) {
    const { bytes, mime } = await fetchRemoteImageBytes(source.url);
    return saveChatAsset(sessionId, bytes, mime);
  }

  throw new Error('No image source provided');
}

export async function readChatAsset(sessionId: string, assetId: string) {
  const filePath = assetPath(sessionId, assetId);
  const bytes = await readFile(filePath);
  await touchChatAssetSession(sessionId);
  const ext = path.extname(assetId).slice(1).toLowerCase();
  const mime = EXT_TO_MIME[ext] || 'application/octet-stream';
  return { bytes, mime };
}
