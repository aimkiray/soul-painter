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
import { shouldUseSecureCookie } from '@/lib/chat-asset-session';
import { readLimitedText } from '@/lib/limited-body';

// Node runtime: shouldUseSecureCookie lives with the other cookie helpers which
// use node:crypto and Prisma.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE = MODEL_GATE_UNLOCK_MAX_AGE_SEC;

function cookieOptions(request: NextRequest, maxAge = COOKIE_MAX_AGE) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: shouldUseSecureCookie(request),
    path: '/',
    maxAge,
  };
}

function clearGateCookies(response: NextResponse, request: NextRequest) {
  response.cookies.set(MODEL_GATE_ENABLED_COOKIE, '', cookieOptions(request, 0));
  response.cookies.set(MODEL_GATE_TAP_COOKIE, '', cookieOptions(request, 0));
  response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(request, 0));
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
    response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(request, 0));
  }
  if (!current.enabled) clearGateCookies(response, request);
  return response;
}

export async function POST(request: NextRequest) {
  const limited = await readLimitedText(request, 4096);
  let body = {} as Record<string, unknown>;
  if (!('tooLarge' in limited)) {
    try {
      const parsed = JSON.parse(limited.text || '{}');
      if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
    } catch {
      // Malformed JSON is treated as an empty action.
    }
  }
  const action = body?.action === 'tap' ? 'tap' : body?.action === 'clear' ? 'clear' : 'state';
  const current = await readGateState(request);

  if (action === 'tap') {
    if (!current.enabled) {
      const response = NextResponse.json({
        enabled: false,
        unlocked: false,
      });
      clearGateCookies(response, request);
      return response;
    }

    const nextTaps = Math.min(MODEL_GATE_VERSION_TAPS, current.taps + 1);
    const unlocked = current.unlocked || nextTaps >= MODEL_GATE_VERSION_TAPS;
    const response = NextResponse.json({
      enabled: true,
      unlocked,
    });

    response.cookies.set(MODEL_GATE_TAP_COOKIE, String(nextTaps), cookieOptions(request));
    if (unlocked) {
      response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, await createModelGateUnlockToken(), cookieOptions(request));
    }

    return response;
  }

  if (action === 'clear') {
    const response = NextResponse.json({
      enabled: current.enabled,
      unlocked: false,
    });
    clearGateCookies(response, request);
    return response;
  }

  const response = NextResponse.json({
    enabled: current.enabled,
    unlocked: current.unlocked,
    message: current.enabled && !current.unlocked ? getRandomModelGateMessage() : '',
  });
  if (!current.enabled || !current.unlocked) {
    response.cookies.set(MODEL_GATE_UNLOCKED_COOKIE, '', cookieOptions(request, 0));
  }
  if (!current.enabled) clearGateCookies(response, request);
  return response;
}
