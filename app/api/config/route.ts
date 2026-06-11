import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    defaultBaseUrl: process.env.DEFAULT_BASE_URL || '',
    hasDefaultKey: !!process.env.DEFAULT_API_KEY,
  });
}
