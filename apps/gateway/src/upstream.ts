import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Node BlockList treats IPv4 as IPv4-mapped IPv6 internally. Keep families
// separate or blocking ::ffff:0:0/96 also blocks every public IPv4 address.
const blockedV4 = new BlockList();
const blockedV6 = new BlockList();
for (const [subnet, prefix] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],
  ['224.0.0.0',4],['240.0.0.0',4],['::',128],['::1',128],['fc00::',7],['fe80::',10],
  ['ff00::',8],['::ffff:0:0',96],['64:ff9b::',96],['64:ff9b:1::',48],
  ['2001:db8::',32],['2002::',16],
] as const) {
  const ipv4 = isIP(subnet) === 4;
  (ipv4 ? blockedV4 : blockedV6).addSubnet(subnet, prefix, ipv4 ? 'ipv4' : 'ipv6');
}
export function isBlockedUpstreamAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? blockedV4.check(address, 'ipv4') :
    family === 6 ? blockedV6.check(address, 'ipv6') : true;
}

export type UpstreamResult = { status: number; contentType: string; body: Buffer };
export async function forwardUpstream(url: URL, method: string, headers: Record<string,string>,
  body: Buffer, allowLocal = false, timeoutMs = 10_000): Promise<UpstreamResult> {
  if (url.username || url.password || url.hash ||
      !(url.protocol === 'https:' || (allowLocal && url.protocol === 'http:')))
    throw new Error('UPSTREAM_ORIGIN_NOT_ALLOWED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('UPSTREAM_TIMEOUT')), timeoutMs);
  let abortLookup: (() => void) | undefined;
  try {
  const resolved = await Promise.race([lookup(url.hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      abortLookup = () => reject(new Error('UPSTREAM_TIMEOUT'));
      controller.signal.addEventListener('abort', abortLookup, { once: true });
    })]);
  if (abortLookup) controller.signal.removeEventListener('abort', abortLookup);
  if (!resolved.length || resolved.some(item => !allowLocal && isBlockedUpstreamAddress(item.address)))
    throw new Error('UPSTREAM_ADDRESS_NOT_ALLOWED');
  if (allowLocal && !['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname) &&
      resolved.some(item => isBlockedUpstreamAddress(item.address)))
    throw new Error('UPSTREAM_ADDRESS_NOT_ALLOWED');
  const address = resolved[0]!;
  return await new Promise((resolve, reject) => {
    const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const connectionOptions = { autoSelectFamily: false };
    const req = requester(url, {
      method, headers, signal: controller.signal, timeout: timeoutMs, maxHeaderSize: 16_384,
      // We already selected and validated one address. Node's automatic family
      // selection expects an array from lookup and would reject this pinned IP.
      ...connectionOptions,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, response => {
      const status = response.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        response.destroy(); reject(new Error('UPSTREAM_REDIRECT_DENIED')); return;
      }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) { response.destroy(new Error('UPSTREAM_RESPONSE_TOO_LARGE')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ status,
        contentType: String(response.headers['content-type'] ?? 'application/octet-stream'),
        body: Buffer.concat(chunks) }));
    });
    req.on('timeout', () => req.destroy(new Error('UPSTREAM_TIMEOUT')));
    req.on('error', cause => reject(controller.signal.aborted ? new Error('UPSTREAM_TIMEOUT') : cause));
    if (body.length) req.write(body);
    req.end();
  });
  } finally {
    clearTimeout(timer);
    if (abortLookup) controller.signal.removeEventListener('abort', abortLookup);
  }
}
