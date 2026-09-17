import { isIP } from 'node:net';

/**
 * Byte-level IP privacy classification.
 *
 * String-prefix checks on IPv6 literals miss expanded/compressed forms such as
 * `0:0:0:0:ffff:7f00:1` (=127.0.0.1), `0000::ffff:a9fe:a9fe` (cloud metadata),
 * `2002:7f00:1::` (6to4) and Teredo/NAT64 variants. Everything here parses the
 * address into its 16 bytes first and then classifies on byte prefixes.
 */

function parseIPv4ToBytes(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const part = Number(parts[i]);
    if (part > 255) return null;
    bytes[i] = part;
  }
  return bytes;
}

/** Expand an IPv6 literal into its 16 bytes. Handles `::` compression and an
 *  embedded dotted-quad tail (`::ffff:1.2.3.4`). Returns null when invalid. */
export function parseIPv6ToBytes(address: string): Uint8Array | null {
  let input = address.trim().toLowerCase();
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (!input) return null;

  // A dotted-quad tail (e.g. `::ffff:1.2.3.4`) supplies the last two hextets.
  let tailV4: Uint8Array | null = null;
  const lastColon = input.lastIndexOf(':');
  const lastPart = lastColon === -1 ? input : input.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    if (lastColon === -1) return null; // a bare dotted quad is not IPv6
    tailV4 = parseIPv4ToBytes(lastPart);
    if (!tailV4) return null;
    input = input.slice(0, lastColon + 1);
    // `::ffff:` leaves a single dangling colon after removing the quad; a bare
    // `::` (`::1.2.3.4`) keeps both colons.
    if (input.endsWith(':') && !input.endsWith('::')) input = input.slice(0, -1);
  }

  const dcIndex = input.indexOf('::');
  // At most one `::` run is allowed.
  if (dcIndex !== -1 && input.indexOf('::', dcIndex + 1) !== -1) return null;

  const headStr = dcIndex === -1 ? input : input.slice(0, dcIndex);
  const tailStr = dcIndex === -1 ? '' : input.slice(dcIndex + 2);
  const headParts = headStr === '' ? [] : headStr.split(':');
  const tailParts = tailStr === '' ? [] : tailStr.split(':');
  for (const part of [...headParts, ...tailParts]) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
  }

  const v4Hextets = tailV4 ? 2 : 0;
  const hextetCount = headParts.length + tailParts.length + v4Hextets;
  if (hextetCount > 8 || (dcIndex === -1 && hextetCount !== 8)) return null;

  const bytes = new Uint8Array(16);
  let offset = 0;
  const writeHextet = (part: string) => {
    const value = parseInt(part, 16);
    bytes[offset] = value >> 8;
    bytes[offset + 1] = value & 0xff;
    offset += 2;
  };
  for (const part of headParts) writeHextet(part);
  // The compressed middle is implicitly zero; the tail (incl. the dotted
  // quad) is written at the END of the address.
  offset = 16 - (tailParts.length + v4Hextets) * 2;
  for (const part of tailParts) writeHextet(part);
  if (tailV4) bytes.set(tailV4, 12);
  return bytes;
}

function bytesAllZero(bytes: Uint8Array, start: number, end: number) {
  for (let i = start; i < end; i += 1) {
    if (bytes[i] !== 0) return false;
  }
  return true;
}

/** Extract the embedded IPv4 from a parsed IPv6 address: `::ffff:0:0/96`
 *  (v4-mapped, bytes 10-11 = 0xffff) or the deprecated v4-compatible `::/96`
 *  form. Returns null when there is no embedded address. */
export function ipv6ToEmbeddedIPv4(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length !== 16) return null;
  if (!bytesAllZero(bytes, 0, 10)) return null;
  if (bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12);
  if (bytes[10] !== 0 || bytes[11] !== 0) return null;
  // v4-compatible `::/96` — `::` (unspecified) and `::1` (loopback) have their
  // own dedicated checks below, so they are not treated as embedded v4.
  if (bytesAllZero(bytes, 12, 16)) return null;
  if (bytesAllZero(bytes, 12, 15) && bytes[15] === 1) return null;
  return bytes.slice(12);
}

/** IPv4 private/reserved ranges (matches the union of the historical CIDR
 *  lists in upstream-security.ts and chat-assets.ts). */
export function ipv4BytesArePrivate(a: number, b: number, c: number): boolean {
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 31 && c === 196)
    || (a === 192 && b === 52 && c === 193)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 192 && b === 175 && c === 48)
    || (a === 198 && b >= 18 && b <= 19)
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224; // 224/4 multicast + 240/4 reserved
}

function ipv6BytesArePrivate(bytes: Uint8Array): boolean {
  // Embedded IPv4 forms defer to the IPv4 range rules (so `::ffff:7f00:1`
  // and expanded spellings of it classify exactly like 127.0.0.1).
  const embedded = ipv6ToEmbeddedIPv4(bytes);
  if (embedded) return ipv4BytesArePrivate(embedded[0], embedded[1], embedded[2]);

  if (bytesAllZero(bytes, 0, 16)) return true; // :: (unspecified)
  if (bytesAllZero(bytes, 0, 15) && bytes[15] === 1) return true; // ::1 loopback
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10 site-local (deprecated but still routable)
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast

  // ISATAP tunnel interface identifiers embed an IPv4 in the last 32 bits:
  // `::0:5efe:a.b.c.d` (private form) or `::200:5efe:` (u/l-bit form). The
  // tunneled target is the embedded v4 — a private one blocks outright, while
  // a public one still defers to the outer-prefix checks below.
  if ((bytes[8] === 0x00 || bytes[8] === 0x02) && bytes[9] === 0x00
    && bytes[10] === 0x5e && bytes[11] === 0xfe
    && ipv4BytesArePrivate(bytes[12], bytes[13], bytes[14])) {
    return true;
  }

  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true; // 2001::/32 Teredo (v4 is XOR-encoded — block entirely)
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true; // 2001:db8::/32 documentation
    if (bytes[2] === 0x00 && bytes[3] === 0x02 && bytes[4] === 0x00 && bytes[5] === 0x00) {
      return true; // 2001:2::/48 benchmarking
    }
  }

  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes[4] === 0x00 && bytes[5] === 0x01) return true; // 64:ff9b:1::/48 local-use NAT64
    if (bytesAllZero(bytes, 4, 12)) return true; // 64:ff9b::/96 well-known NAT64
  }

  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    // 2002::/16 6to4: the embedded IPv4 relay target sits in bytes 2-5.
    return ipv4BytesArePrivate(bytes[2], bytes[3], bytes[4]);
  }

  if (bytes[0] === 0x01 && bytesAllZero(bytes, 1, 8)) return true; // 100::/64 discard-only

  return false;
}

/** True when `address` is a private/reserved/non-public IP literal.
 *  Anything that is not a valid IP literal is treated as private (fail closed). */
export function ipIsPrivate(address: string): boolean {
  const normalized = address.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const family = isIP(normalized);
  if (family === 4) {
    const bytes = parseIPv4ToBytes(normalized);
    return bytes === null || ipv4BytesArePrivate(bytes[0], bytes[1], bytes[2]);
  }
  if (family === 6) {
    const bytes = parseIPv6ToBytes(normalized);
    return bytes === null || ipv6BytesArePrivate(bytes);
  }
  return true;
}
