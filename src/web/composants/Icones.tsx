/** Icônes SVG au trait, reprises de la maquette. Jamais d'emoji. */
interface Props {
  taille?: number;
  couleur?: string;
}

export function IconeBug({ taille = 18, couleur = 'var(--rouge-texte)' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <ellipse cx="12" cy="14" rx="5" ry="6" />
      <path d="M12 8V4M9 5l1.5 2M15 5l-1.5 2M7 11H3M17 11h4M7 15H3M17 15h4M8 19l-2 2M16 19l2 2" />
    </svg>
  );
}

export function IconePersonne({ taille = 16, couleur = 'var(--encre)' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </svg>
  );
}

export function IconeRotation({ taille = 16, couleur = 'var(--vert-eau)', epaisseur = 2.2 }: Props & { epaisseur?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

export function IconeCoche({ taille = 16, couleur = 'var(--vert-valide)', epaisseur = 2.4 }: Props & { epaisseur?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function IconeCercle({ taille = 16, couleur = 'var(--gris-pointille)' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.2" aria-hidden="true">
      <circle cx="12" cy="12" r="7" />
    </svg>
  );
}

export function IconeCroix({ taille = 16, couleur = 'var(--rouge-texte)' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M6.5 6.5l11 11" />
      <path d="M17.5 6.5l-11 11" />
    </svg>
  );
}

export function IconeAlerte({ taille = 18, couleur = 'var(--rouge-texte)' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17.5v.01" />
    </svg>
  );
}

export function IconePlus({ taille = 16, couleur = '#FFFFFF' }: Props) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke={couleur} strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function Logo() {
  return (
    <svg width="44" height="24" viewBox="0 0 44 24" aria-hidden="true">
      <path d="M5 12h34" stroke="#14233A" strokeWidth="2.5" fill="none" />
      <circle cx="6" cy="12" r="4.5" fill="#14233A" />
      <rect x="18" y="7.5" width="9" height="9" rx="2.5" fill="#F2AE1B" />
      <circle cx="38" cy="12" r="4.5" fill="#2B6B6E" />
    </svg>
  );
}
