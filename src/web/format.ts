const jour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const complet = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formaterJour = (iso: string) => jour.format(new Date(iso));
export const formaterHeure = (iso: string) => heure.format(new Date(iso)).replace(':', ' h ');
export const formaterHorodatage = (iso: string) => complet.format(new Date(iso));

/** « 1 scénario », « 2 scénarios ». */
export const pluriel = (n: number, singulier: string, plurielForme = `${singulier}s`) => `${n} ${n > 1 ? plurielForme : singulier}`;
