export declare const ENTETE_SIGNATURE: 'x-signature';
export declare function signer(corps: string, secret: string): string;
export declare function envoyer(
  url: string,
  corps: unknown,
  secret: string,
  options?: { essais?: number; pauseMs?: number },
): Promise<{ ok: boolean; statut: number; texte: string }>;
