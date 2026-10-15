const net = require('net');

// Behind Cloudflare, Express' req.ip is a shared edge address, so per-IP rate limits would
// throttle unrelated users together. CLIENT_IP_HEADER names the header the trusted proxy sets
// (default Cloudflare's); set it to an empty string to fall back to req.ip only.
const HEADER = process.env.CLIENT_IP_HEADER === undefined
  ? 'cf-connecting-ip'
  : String(process.env.CLIENT_IP_HEADER).trim().toLowerCase();

function clientIp(req) {
  if (HEADER) {
    const value = String(req.headers[HEADER] || '').split(',')[0].trim();
    if (value && net.isIP(value)) return value;
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = { clientIp };
