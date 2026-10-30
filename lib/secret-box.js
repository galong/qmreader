const crypto = require('node:crypto');

// AES-256-GCM envelope for secrets stored at rest. The key comes from
// QMREADER_SECRET_KEY; without it nothing is ever written in the clear.
const PREFIX = 'v1';

function deriveKey(secret) {
  const raw = String(secret || '');
  if (raw.length < 16) return null;
  return crypto.createHash('sha256').update(`qmreader:secret-box:${raw}`).digest();
}

function createSecretBox(secret = process.env.QMREADER_SECRET_KEY) {
  const key = deriveKey(secret);
  return {
    available: Boolean(key),
    encrypt(value) {
      if (!key) throw new Error('QMREADER_SECRET_KEY 未配置，无法加密保存凭证');
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
      return [PREFIX, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
    decrypt(payload) {
      if (!key) throw new Error('QMREADER_SECRET_KEY 未配置，无法读取凭证');
      const [version, iv, tag, body] = String(payload || '').split('.');
      if (version !== PREFIX || !iv || !tag || !body) throw new Error('凭证格式无法识别');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    },
  };
}

module.exports = { createSecretBox };
