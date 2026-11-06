import { describe, expect, it } from 'vitest';
import { parseCidr, containsAddress, normalizeAddress } from '../server/lan-policy.ts';

describe('LAN CIDR policy', () => {
  it('normalizes IPv4-mapped IPv6 peers', () => {
    expect(containsAddress(parseCidr('192.168.1.0/24'), '::ffff:192.168.1.22')).toBe(true);
  });
  it('preserves IPv6 loopback identity when normalizing addresses', () => {
    expect(normalizeAddress('::1')).toBe('::1');
  });
  it('requires the entire network to fit within private address space', () => {
    expect(() => parseCidr('10.0.0.0/7')).toThrow();
    expect(() => parseCidr('fc00::/6')).toThrow();
  });
  it('rejects zones, loopback, unspecified and malformed addresses', () => {
    for (const cidr of ['fe80::1%en0/64', '127.0.0.1/8', '0.0.0.0/0', 'ff02::/16', '2001:db8::/32']) expect(() => parseCidr(cidr)).toThrow();
  });
  it('matches valid IPv6 CIDRs', () => {
    expect(containsAddress(parseCidr('fd12:3456::/48'), 'fd12:3456::abcd')).toBe(true);
    expect(containsAddress(parseCidr('fd12:3456::/48'), 'fd12:3457::1')).toBe(false);
  });
});
