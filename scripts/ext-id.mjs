// manifest.key(base64 공개키 DER) → Chrome 확장 ID (sha256 앞 16바이트를 a~p로)
import { createHash } from 'node:crypto';

export function extensionIdFromKey(keyB64) {
  const hex = createHash('sha256').update(Buffer.from(keyB64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
