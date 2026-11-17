export declare function memeVersion(lue: unknown, attendue: unknown): boolean;
export declare function construireCorps(runId: string, type: string, champs?: Record<string, unknown>): { runId: string; evenement: Record<string, unknown> };
export declare function signaler(
  type: string,
  champs: Record<string, unknown>,
  env?: Record<string, string | undefined>,
  options?: { essais?: number; pauseMs?: number },
): Promise<{ ok: boolean; statut: number; texte: string }>;
export declare function attendreVersion(
  url: string,
  attendue: string,
  options?: { champ?: string; minutes?: number; pauseMs?: number; fetcher?: typeof fetch; journal?: (m: string) => void },
): Promise<{ ok: boolean; version: unknown }>;
