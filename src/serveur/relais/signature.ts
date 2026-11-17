import { createHmac, timingSafeEqual } from 'node:crypto';

export const ENTETE_SIGNATURE = 'x-signature';

/** Signature HMAC SHA 256 du corps brut, au format « sha256=<hex> ». */
export function signer(corps: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(corps, 'utf8').digest('hex')}`;
}

/** Comparaison à temps constant : ne révèle rien sur la bonne signature. */
export function verifierSignature(corps: string, entete: string | undefined, secret: string): boolean {
  if (!entete) return false;
  const attendue = Buffer.from(signer(corps, secret));
  const recue = Buffer.from(entete);
  return attendue.length === recue.length && timingSafeEqual(attendue, recue);
}
