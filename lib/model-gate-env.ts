export function isModelGateEnabled(): boolean {
  const value = (process.env.MODEL_GATE_ENABLED || '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}
