const net = require('net');

// Only trust Cloudflare's client header when the verified proxy chain ends at a
// Cloudflare edge. Direct-origin callers can otherwise rotate this header freely.
// Official ranges: https://www.cloudflare.com/ips-v4/ and /ips-v6/ (2026-10-15).
const cloudflare = new net.BlockList();
for (const cidr of [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32',
  '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32',
]) {
  const [address, prefix] = cidr.split('/');
  cloudflare.addSubnet(address, Number(prefix), net.isIP(address) === 6 ? 'ipv6' : 'ipv4');
}
const HEADER = process.env.CLIENT_IP_HEADER === undefined
  ? 'cf-connecting-ip'
  : String(process.env.CLIENT_IP_HEADER).trim().toLowerCase();

function clientIp(req) {
  const peer = String(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown').replace(/^::ffff:/, '');
  const family = net.isIP(peer);
  if (HEADER === 'cf-connecting-ip' && family && cloudflare.check(peer, family === 6 ? 'ipv6' : 'ipv4')) {
    const value = String(req.headers[HEADER] || '').split(',')[0].trim();
    if (value && net.isIP(value)) return value;
  }
  return peer;
}

module.exports = { clientIp };
