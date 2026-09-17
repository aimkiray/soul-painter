import { describe, expect, it } from 'vitest';
import { ipIsPrivate, parseIPv6ToBytes } from '@/lib/ip-private';

describe('ipIsPrivate', () => {
  it('blocks IPv4 loopback, private, link-local, CGNAT and reserved ranges', () => {
    for (const ip of [
      '0.1.2.3',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(ipIsPrivate(ip), ip).toBe(true);
    }
  });

  it('allows public IPv4 literals', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.114.1']) {
      expect(ipIsPrivate(ip), ip).toBe(false);
    }
  });

  it('blocks IPv6 unspecified, loopback, ULA, link-local, site-local and multicast', () => {
    for (const ip of [
      '::',
      '::1',
      'fc00::1',
      'fd00::1',
      'fe80::1',
      'febf::ffff',
      // fec0::/10 site-local (deprecated, still routable on some stacks)
      'fec0::1',
      'feff::ffff:1',
      'ff02::1',
    ]) {
      expect(ipIsPrivate(ip), ip).toBe(true);
    }
  });

  it('blocks every spelling of IPv4-mapped IPv6', () => {
    for (const ip of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '0000::ffff:7f00:0001',
      '0:0:0:0:0:ffff:169.254.169.254',
      '0:0:0:0:0:ffff:a9fe:a9fe',
      '::ffff:10.0.0.1',
      '::ffff:192.168.0.1',
    ]) {
      expect(ipIsPrivate(ip), ip).toBe(true);
    }
    expect(ipIsPrivate('::ffff:8.8.8.8')).toBe(false);
    expect(ipIsPrivate('0:0:0:0:0:ffff:0808:0808')).toBe(false);
  });

  it('blocks v4-compatible IPv6 and tunneling forms that embed private IPv4', () => {
    for (const ip of [
      // deprecated v4-compatible ::/96
      '::127.0.0.1',
      '0:0:0:0:0:0:7f00:1',
      // 6to4: relay v4 in bytes 2-5
      '2002:7f00:1::',
      '2002:a9fe:a9fe::',
      // Teredo 2001::/32 (v4 XOR-encoded — block whole prefix)
      '2001:0000:4136:e378:8000:63bf:3fff:fdd2',
      // NAT64 well-known + local-use
      '64:ff9b::7f00:1',
      '64:ff9b:1::7f00:1',
      // ISATAP embedded private v4
      '2001:db8::5efe:7f00:1',
      '::5efe:10.0.0.1',
      'fe80::200:5efe:169.254.169.254',
    ]) {
      expect(ipIsPrivate(ip), ip).toBe(true);
    }
    // ISATAP with a public embedded v4 is classified by that v4.
    expect(ipIsPrivate('2606:4700::5efe:0808:0808')).toBe(false);
    // ...but a documentation-prefix outer still wins over a public tunnel.
    expect(ipIsPrivate('2001:db8::5efe:0808:0808')).toBe(true);
    // 6to4 with a public relay v4 is allowed.
    expect(ipIsPrivate('2002:0808:0808::')).toBe(false);
  });

  it('blocks IPv6 discard-only, benchmarking and documentation ranges', () => {
    for (const ip of ['100::1', '2001:2::1', '2001:db8::1']) {
      expect(ipIsPrivate(ip), ip).toBe(true);
    }
  });

  it('allows ordinary public IPv6', () => {
    for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888']) {
      expect(ipIsPrivate(ip), ip).toBe(false);
    }
  });

  it('fails closed on non-IP input', () => {
    for (const value of ['', 'not-an-ip', '::ffff:zzz', 'example.com', '[::1', '1.2.3.4.5']) {
      expect(ipIsPrivate(value), value).toBe(true);
    }
  });
});

describe('parseIPv6ToBytes', () => {
  it('expands compressed and embedded-v4 forms into 16 bytes', () => {
    expect([...parseIPv6ToBytes('::1')!]).toEqual([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]);
    expect([...parseIPv6ToBytes('::ffff:127.0.0.1')!].slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
    expect([...parseIPv6ToBytes('0:0:0:0:0:ffff:7f00:1')!].slice(10)).toEqual([0xff, 0xff, 127, 0, 0, 1]);
    expect(parseIPv6ToBytes('[::1]')).not.toBeNull();
  });

  it('rejects malformed addresses', () => {
    for (const value of [':::', '1::2::3', '12345::', '::ffff:999.1.1.1', 'gg::1', '1.2.3.4']) {
      expect(parseIPv6ToBytes(value), value).toBeNull();
    }
  });
});
