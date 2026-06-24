import { copyFile, mkdir, opendir, readFile, rm, stat, writeFile } from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { isChatAssetSessionId } from '@/lib/chat-asset-session-id';

const CHAT_ASSET_DIR = path.join(process.cwd(), 'data', 'chat-assets');
const MAX_IMAGE_BYTES = getPositiveEnvInt('CHAT_ASSET_MAX_IMAGE_BYTES', 8 * 1024 * 1024);
const SESSION_MAX_BYTES = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_BYTES', 256 * 1024 * 1024);
const SESSION_MAX_FILES = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_FILES', 200);
const SESSION_MAX_AGE_MS = getPositiveEnvInt('CHAT_ASSET_SESSION_MAX_AGE_DAYS', 30) * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
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
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) throw new Error('Invalid image data');

  const mime = match[1].toLowerCase();
  const isBase64 = !!match[2];
  const data = match[3] || '';
  const buffer = isBase64
    ? Buffer.from(data, 'base64')
    : Buffer.from(decodeURIComponent(data));
  return { bytes: new Uint8Array(buffer), mime };
}

function ipv4ToNumber(ip: string) {
  const parts = ip.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) + part) >>> 0, 0);
}

function ipv4InRange(value: number, base: string, bits: number) {
  const baseValue = ipv4ToNumber(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function isPrivateIp(ip: string) {
  const normalizedIp = ip.toLowerCase();
  const ipv4Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (ipv4Mapped) return isPrivateIp(ipv4Mapped[1]);
  if (normalizedIp.startsWith('::ffff:')) return true;

  if (net.isIP(ip) === 4) {
    const value = ipv4ToNumber(ip);
    if (value === null) return true;
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.88.99.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => ipv4InRange(value, base as string, bits as number));
  }

  if (net.isIP(ip) === 6) {
    const firstHextet = parseInt(normalizedIp.split(':')[0] || '0', 16);
    return normalizedIp === '::1'
      || normalizedIp === '::'
      || (firstHextet & 0xfe00) === 0xfc00
      || (firstHextet & 0xffc0) === 0xfe80
      || (firstHextet & 0xff00) === 0xff00
      || normalizedIp.startsWith('2001:db8:');
  }

  return true;
}

async function assertPublicRemoteUrl(rawUrl: string): Promise<URL> {
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

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Image URL host is not allowed');
    return url;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error('Image URL host is not allowed');
  }

  return url;
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

async function fetchRemoteImageBytes(rawUrl: string, redirects = 0): Promise<{ bytes: Uint8Array; mime: string }> {
  const url = await assertPublicRemoteUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif' },
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= REMOTE_FETCH_MAX_REDIRECTS) throw new Error('Too many image redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Invalid image redirect');
      return fetchRemoteImageBytes(new URL(location, url).toString(), redirects + 1);
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
  for await (const entry of handle) {
    if (!entry.isDirectory() || !isChatAssetSessionId(entry.name)) continue;
    const dir = path.join(CHAT_ASSET_DIR, entry.name);
    try {
      const meta = await readSessionMeta(entry.name);
      const fallbackStat = meta ? null : await stat(dir);
      const lastAccessedAt = meta?.lastAccessedAt || fallbackStat?.mtimeMs || 0;
      if (lastAccessedAt < expiresBefore) {
        await rm(dir, { recursive: true, force: true });
      }
    } catch {
      // Best effort cleanup; ignore directories that disappear mid-scan.
    }
  }
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

export async function clearChatAssets(sessionId: string) {
  await rm(sessionDir(sessionId), { recursive: true, force: true });
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
    } catch (error) {
      result.failed.push({ id: file.name, error: errorMessage(error) });
    }
  }

  if (result.copied > 0 || result.skipped > 0) {
    await touchChatAssetSession(targetSessionId);
    await enforceSessionAssetLimits(targetSessionId);
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

  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `${hash}.${ext}`;
  const filePath = assetPath(sessionId, id);

  await touchChatAssetSession(sessionId);
  try {
    await stat(filePath);
  } catch {
    await writeFile(filePath, bytes);
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
