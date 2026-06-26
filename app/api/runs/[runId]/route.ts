import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';
import { toPublicServerRun, type ServerRunRecord } from '@/lib/server-runs';
import { cancelServerRun, ensureServerRunStarted } from '@/lib/server-runner';
import { readServerRun } from '@/lib/server-run-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ runId: string }>;
}

function hashAccessToken(runId: string, token: string) {
  return createHash('sha256').update(`${runId}\0${token}`).digest('hex');
}

function safeEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function requestAccessToken(request: NextRequest) {
  return request.headers.get('x-run-access-token')
    || request.nextUrl.searchParams.get('token')
    || '';
}

function assertAuthorized(request: NextRequest, run: ServerRunRecord) {
  const token = requestAccessToken(request);
  return !!token && safeEqual(hashAccessToken(run.id, token), run.accessTokenHash);
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  const run = await readServerRun(runId);
  if (!run) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (!assertAuthorized(request, run)) return NextResponse.json({ error: '无权访问任务' }, { status: 404 });
  if (run.status === 'queued' || run.status === 'running') {
    void ensureServerRunStarted(run.id);
  }
  return NextResponse.json({ ok: true, run: toPublicServerRun(run) });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  const run = await readServerRun(runId);
  if (!run) return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  if (!assertAuthorized(request, run)) return NextResponse.json({ error: '无权访问任务' }, { status: 404 });
  await cancelServerRun(runId);
  return NextResponse.json({ ok: true });
}
