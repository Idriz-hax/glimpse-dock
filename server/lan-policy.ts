import { isIP } from 'node:net';

type Address = { family: 4 | 6; value: bigint; bits: 32 | 128 };
export type Cidr = Address & { prefix: number; network: bigint };

function parseAddress(input: string): Address {
  if (input.includes('%')) throw new Error('Scoped IP addresses are not supported');
  const family = isIP(input);
  if (family === 4) {
    const value = input.split('.').reduce((n, part) => (n << 8n) | BigInt(part), 0n);
    return { family: 4, value, bits: 32 };
  }
  if (family !== 6) throw new Error('Invalid IP address');
  const mapped = input.toLowerCase().startsWith('::ffff:');
  if (mapped) {
    const suffix = input.slice(7);
    if (isIP(suffix) === 4) return parseAddress(suffix);
    const value = parseV6(input);
    if ((value >> 32n) === 0xffffn) return { family: 4, value: value & 0xffffffffn, bits: 32 };
  }
  return { family: 6, value: parseV6(input), bits: 128 };
}

function parseV6(input: string): bigint {
  let groups: string[];
  if (input.includes('.')) {
    const lastColon = input.lastIndexOf(':');
    const v4 = parseAddress(input.slice(lastColon + 1));
    const hex = [Number((v4.value >> 16n) & 0xffffn).toString(16), Number(v4.value & 0xffffn).toString(16)];
    input = `${input.slice(0, lastColon)}:${hex.join(':')}`;
  }
  if (input.includes('::')) {
    const halves = input.split('::');
    if (halves.length !== 2) throw new Error('Invalid IPv6 address');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    if (left.length + right.length >= 8) throw new Error('Invalid IPv6 address');
    groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  } else {
    groups = input.split(':');
    if (groups.length !== 8) throw new Error('Invalid IPv6 address');
  }
  return groups.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}

const mask = (bits: number, prefix: number) => ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
function inPrefix(address: Address, network: Address, prefix: number): boolean {
  return address.family === network.family && (address.value & mask(address.bits, prefix)) === (network.value & mask(network.bits, prefix));
}
const privateRanges: Array<[string, number]> = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['fc00::', 7]];

export function parseCidr(input: string): Cidr {
  if (input.trim() !== input || input.split('/').length !== 2) throw new Error('Invalid CIDR');
  const [literal, prefixText] = input.split('/');
  const address = parseAddress(literal);
  if (address.family === 4 && literal.includes(':')) throw new Error('Mapped CIDR is not supported');
  if (!/^\d{1,3}$/.test(prefixText)) throw new Error('Invalid CIDR prefix');
  const prefix = Number(prefixText);
  if (prefix < 1 || prefix > address.bits) throw new Error('Invalid CIDR prefix');
  const network = address.value & mask(address.bits, prefix);
  const end = network | (mask(address.bits, prefix) ^ ((1n << BigInt(address.bits)) - 1n));
  const contained = privateRanges.some(([range, rangePrefix]) => {
    const base = parseAddress(range);
    return address.family === base.family && inPrefix({ ...address, value: network }, base, rangePrefix) && inPrefix({ ...address, value: end }, base, rangePrefix);
  });
  if (!contained) throw new Error('CIDR must be wholly within RFC1918 or ULA space');
  return { ...address, prefix, network };
}

export function containsAddress(cidr: Cidr, input: string): boolean {
  let address: Address;
  try { address = parseAddress(input); } catch { return false; }
  return address.family === cidr.family && (address.value & mask(cidr.bits, cidr.prefix)) === cidr.network;
}

export function normalizeAddress(input: string): string | undefined {
  try {
    const address = parseAddress(input);
    if (address.family === 4) return [24n, 16n, 8n, 0n].map(shift => Number((address.value >> shift) & 255n)).join('.');
    return address.value === 1n ? '::1' : address.value.toString(16);
  } catch { return; }
}
