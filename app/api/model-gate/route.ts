import { NextRequest, NextResponse } from 'next/server';
import {
  createModelGateUnlockToken,
  getRandomModelGateMessage,
  MODEL_GATE_ENABLED_COOKIE,
  MODEL_GATE_TAP_COOKIE,
  MODEL_GATE_UNLOCKED_COOKIE,
  MODEL_GATE_UNLOCK_MAX_AGE_SEC,
  MODEL_GATE_VERSION_TAPS,
  verifyModelGateUnlockToken,
} from '@/lib/model-gate';
import { isModelGateEnabled } from '@/lib/model-gate-env';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE = MODEL_GATE_UNLOCK_MAX_AGE_SEC;

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

async function readGateState(request: NextRequest) {
  const enabled = isModelGateEnabled();
  const unlocked = await verifyModelGateUnlockToken(request.cookies.get(MODEL_GATE_UNLOCKED_COOKIE)?.value);
  const rawTaps = Math.max(0, Math.min(
    MODEL_GATE_VERSION_TAPS,
    parseInt(request.cookies.get(MODEL_GATE_TAP_COOKIE)?.value || '0', 10) || 0,
  ));
  const taps = !unlocked && rawTaps >= MODEL_GATE_VERSION_TAPS ? 0 : rawTaps;
  return {
    enabled,
    unlocked,
    taps,
    remaining: unlocked ? 0 : Math.max(0, MODEL_GATE_VERSION_TAPS - taps),
  };
}

export async function GET(request: NextRequest) {
  const current = await readGateState(request);
  const response = NextResponse.json({
    enabled: current.enabled,
    unlocked: current.unlocked,
    message: current.enabled && !current.unlocked ? getRandomModelGateMessage() : '',
  });
  if (!current.enabled || !current.unlocked) {
    response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(0));
  }
  if (!current.enabled) clearGateCookies(response);
  return response;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = body?.action === 'tap' ? 'tap' : body?.action === 'clear' ? 'clear' : 'state';
  const current = await readGateState(request);

  if (action === 'tap') {
    if (!current.enabled) {
      const response = NextResponse.json({
        enabled: false,
        unlocked: false,
      });
      clearGateCookies(response);
      return response;
    }

    const nextTaps = Math.min(MODEL_GATE_VERSION_TAPS, current.taps + 1);
    const unlocked = current.unlocked || nextTaps >= MODEL_GATE_VERSION_TAPS;
    const response = NextResponse.json({
      enabled: true,
      unlocked,
    });

    response.cookies.set(MODEL_GATE_TAP_COOKIE, String(nextTaps), cookieOptions());
    if (unlocked) {
      response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, await createModelGateUnlockToken(), cookieOptions());
    }

    return response;
  }

  if (action === 'clear') {
    const response = NextResponse.json({
      enabled: current.enabled,
      unlocked: false,
    });
    clearGateCookies(response);
    return response;
  }

  const response = NextResponse.json({
    enabled: current.enabled,
    unlocked: current.unlocked,
    message: current.enabled && !current.unlocked ? getRandomModelGateMessage() : '',
  });
  if (!current.enabled || !current.unlocked) {
    response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(0));
  }
  if (!current.enabled) clearGateCookies(response);
  return response;
}
