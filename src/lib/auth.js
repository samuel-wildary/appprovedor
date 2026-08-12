import crypto from 'node:crypto';
import util from 'node:util';

const scrypt = util.promisify(crypto.scrypt);
const randomBytes = util.promisify(crypto.randomBytes);

const SECRET = process.env.JWT_SECRET || 'acesseweb_admin_secret_key_12345';

export async function hashPassword(password) {
  const salt = await randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return {
    hash: derivedKey.toString('hex'),
    salt: salt.toString('hex')
  };
}

export async function verifyPassword(password, hash, salt) {
  const derivedKey = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return derivedKey.toString('hex') === hash;
}

export function generateToken(payload, expiresInMs = 12 * 60 * 60 * 1000) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  
  const exp = Date.now() + expiresInMs;
  const payloadWithExp = { ...payload, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payloadWithExp)).toString('base64url');
  
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(`${header}.${payloadB64}`)
    .digest('base64url');
    
  return `${header}.${payloadB64}.${signature}`;
}

export function verifyToken(token) {
  try {
    const [header, payloadB64, signature] = token.split('.');
    
    const expectedSignature = crypto
      .createHmac('sha256', SECRET)
      .update(`${header}.${payloadB64}`)
      .digest('base64url');
      
    if (signature !== expectedSignature) {
      return null;
    }
    
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    
    return payload;
  } catch (error) {
    return null;
  }
}
