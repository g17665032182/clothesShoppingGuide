import { BlockList, isIP } from 'node:net';

const privateIpv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  privateIpv4.addSubnet(address, prefix, 'ipv4');
}

const globalIpv6 = new BlockList();
globalIpv6.addSubnet('2000::', 3, 'ipv6');
const reservedIpv6 = new BlockList();
reservedIpv6.addSubnet('2001::', 23, 'ipv6');
reservedIpv6.addSubnet('2001:db8::', 32, 'ipv6');
reservedIpv6.addSubnet('2002::', 16, 'ipv6');

/** 商品链接只允许外部公开地址；不解析 DNS，也不主动请求目标地址。 */
export function publicProductUrl(value: string): URL | null {
  if (!/^https?:\/\//i.test(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname
  ) {
    return null;
  }

  const hostname = parsed.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  const family = isIP(hostname);
  if (family === 4) return privateIpv4.check(hostname, 'ipv4') ? null : parsed;
  if (family === 6) {
    return globalIpv6.check(hostname, 'ipv6') &&
      !reservedIpv6.check(hostname, 'ipv6')
      ? parsed
      : null;
  }
  if (
    !hostname.includes('.') ||
    /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/i.test(
      hostname,
    )
  ) {
    return null;
  }
  return parsed;
}
