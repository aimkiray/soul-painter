import { NextRequest, NextResponse } from 'next/server';
import {
  getRandomModelGateMessage,
  MODEL_GATE_ENABLED_COOKIE,
  MODEL_GATE_TAP_COOKIE,
  MODEL_GATE_UNLOCKED_COOKIE,
  MODEL_GATE_VERSION_TAPS,
} from '@/lib/model-gate';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function cookieOptions(maxAge = COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

function clearGateCookies(response: NextResponse) {
  response.cookies.set(MODEL_GATE_ENABLED_COOKIE, '', cookieOptions(0));
  response.cookies.set(MODEL_GATE_TAP_COOKIE, '', cookieOptions(0));
  response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(0));
}

function readGateState(request: NextRequest) {
  const enabled = request.cookies.get(MODEL_GATE_ENABLED_COOKIE)?.value === '1';
  const unlocked = request.cookies.get(MODEL_GATE_UNLOCKED_COOKIE)?.value === '1';
  const taps = Math.max(0, Math.min(
    MODEL_GATE_VERSION_TAPS,
    parseInt(request.cookies.get(MODEL_GATE_TAP_COOKIE)?.value || '0', 10) || 0,
  ));
  return {
    enabled,
    unlocked,
    taps,
    remaining: unlocked ? 0 : Math.max(0, MODEL_GATE_VERSION_TAPS - taps),
  };
}

export async function GET(request: NextRequest) {
  return NextResponse.json(readGateState(request));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = body?.action === 'tap' ? 'tap' : 'configure';
  const enabled = !!body?.enabled;
  const current = readGateState(request);

  if (action === 'tap') {
    if (!current.enabled) {
      return NextResponse.json(current);
    }

    const nextTaps = Math.min(MODEL_GATE_VERSION_TAPS, current.taps + 1);
    const unlocked = current.unlocked || nextTaps >= MODEL_GATE_VERSION_TAPS;
    const response = NextResponse.json({
      enabled: true,
      unlocked,
      taps: nextTaps,
      remaining: unlocked ? 0 : Math.max(0, MODEL_GATE_VERSION_TAPS - nextTaps),
    });

    response.cookies.set(MODEL_GATE_ENABLED_COOKIE, '1', cookieOptions());
    response.cookies.set(MODEL_GATE_TAP_COOKIE, String(nextTaps), cookieOptions());
    if (unlocked) {
      response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '1', cookieOptions());
    }

    return response;
  }

  if (!enabled) {
    const response = NextResponse.json({
      enabled: false,
      unlocked: false,
      taps: 0,
      remaining: MODEL_GATE_VERSION_TAPS,
    });
    clearGateCookies(response);
    return response;
  }

  if (!current.enabled) {
    const response = NextResponse.json({
      enabled: true,
      unlocked: false,
      taps: 0,
      remaining: MODEL_GATE_VERSION_TAPS,
      message: getRandomModelGateMessage(),
    });
    response.cookies.set(MODEL_GATE_ENABLED_COOKIE, '1', cookieOptions());
    response.cookies.set(MODEL_GATE_TAP_COOKIE, '0', cookieOptions());
    response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(0));
    return response;
  }

  const response = NextResponse.json({
    ...current,
    message: current.unlocked ? '' : getRandomModelGateMessage(),
  });
  response.cookies.set(MODEL_GATE_ENABLED_COOKIE, '1', cookieOptions());
  return response;
}
