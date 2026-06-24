import { describe, it, expect } from 'vitest';
import { extractModelGateMessage, isRecord, stringifyTextContent, parseErrorDetail } from '@/lib/api-parsers';

describe('api-parsers', () => {
  it('extractModelGateMessage extracts message from standard error format', () => {
    const errorText = 'HTTP 418: Gate unlocked';
    expect(extractModelGateMessage(errorText)).toBe('Gate unlocked');
  });

  it('extractModelGateMessage extracts plain string message', () => {
    expect(extractModelGateMessage('Simple string message')).toBe(null);
  });

  it('extractModelGateMessage returns empty string for unknown formats', () => {
    expect(extractModelGateMessage('')).toBe(null);
  });

  it('isRecord correctly identifies records', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('test')).toBe(false);
  });

  it('stringifyTextContent processes content objects correctly', () => {
    expect(stringifyTextContent('text')).toBe('text');
    expect(stringifyTextContent({ type: 'text', text: 'hello' })).toBe('[object Object]');
    expect(stringifyTextContent([{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }])).toBe('hello world');
  });

  it('parseErrorDetail falls back gracefully', () => {
    expect(parseErrorDetail(JSON.stringify({ error: { message: 'API error' } }))).toBe('API error');
    expect(parseErrorDetail(JSON.stringify({ message: 'General error' }))).toBe('General error');
  });
});
