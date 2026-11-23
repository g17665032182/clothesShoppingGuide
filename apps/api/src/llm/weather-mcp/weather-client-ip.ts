import type { IncomingMessage } from 'node:http';
import { isIPv4 } from 'node:net';
import proxyAddr from 'proxy-addr';

const isNonPublic = proxyAddr.compile([
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/3',
]);

export function createWeatherClientIpReader(trustedProxies: string) {
  const ranges = trustedProxies
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const trust = proxyAddr.compile(ranges);

  return (request: IncomingMessage): string | null => {
    if (!request.socket.remoteAddress) return null;
    // 只穿过明确配置的代理，避免信任客户端自行填写的转发地址。
    const address = proxyAddr(request, trust).replace(/^::ffff:/i, '');
    return isIPv4(address) && !isNonPublic(address, 0) ? address : null;
  };
}
