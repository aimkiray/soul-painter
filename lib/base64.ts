export function normalizeToDataUrl(raw: string) {
  let s = (raw || '').trim();
  if (!s) throw new Error('输入内容不能为空');
  const prefixRe = /^data:[^;,]+;base64,/i;
  while (prefixRe.test(s)) s = s.replace(prefixRe, '');
  s = s.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) throw new Error('包含非法的 Base64 字符');
  let bin: string;
  try {
    bin = atob(s.slice(0, 32).padEnd(Math.ceil(s.slice(0, 32).length / 4) * 4, '='));
  } catch (e) {
    throw new Error('Base64 解码失败：' + (e as Error).message);
  }
  const b = [...bin].map((c) => c.charCodeAt(0));
  let mime = 'image/png';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) mime = 'image/png';
  else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
  else if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) mime = 'image/gif';
  else if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) mime = 'image/webp';
  return { dataUrl: 'data:' + mime + ';base64,' + s, mime, b64: s };
}
