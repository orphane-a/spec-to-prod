import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, EVENEMENT_DECONNEXION } from '../api';
import { Logo } from './Icones';

type Etat = 'verification' | 'connexion' | 'connecte' | 'injoignable';

/** Affiche l'application seulement une fois connectée, quand le tableau est protégé. */
export function Garde({ children }: { children: ReactNode }) {
  const [etat, setEtat] = useState<Etat>('verification');

  useEffect(() => {
    api
      .session()
      .then((s) => setEtat(s.connecte ? 'connecte' : 'connexion'))
      .catch(() => setEtat('injoignable'));
    const deconnecte = () => setEtat('connexion');
    window.addEventListener(EVENEMENT_DECONNEXION, deconnecte);
    return () => window.removeEventListener(EVENEMENT_DECONNEXION, deconnecte);
  }, []);

  if (etat === 'connecte') return <>{children}</>;
  if (etat === 'verification') return null;
  if (etat === 'injoignable') {
    return (
      <EcranConnexion>
        <p className="message-erreur" role="alert">
          Le serveur ne répond pas. Vérifiez votre connexion puis rechargez la page.
        </p>
      </EcranConnexion>
    );
  }
  return (
    <EcranConnexion>
      <FormulaireConnexion connecter={() => setEtat('connecte')} />
    </EcranConnexion>
  );
}

function EcranConnexion({ children }: { children: ReactNode }) {
  return (
    <main className="connexion">
      <div className="marque">
        <Logo />
        <h1>Spec to prod</h1>
      </div>
      {children}
    </main>
  );
}

function FormulaireConnexion({ connecter }: { connecter: () => void }) {
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    if (!motDePasse) {
      setErreur('Saisissez votre mot de passe.');
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await api.connexion(motDePasse);
      connecter();
    } catch (err) {
      setErreur(err instanceof Error ? err.message : 'Connexion impossible.');
      setMotDePasse('');
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="formulaire-connexion" noValidate>
      <label className="champ">
        Mot de passe
        <input
          type="password"
          autoComplete="current-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          autoFocus
          aria-invalid={erreur !== null}
        />
      </label>
      {erreur && (
        <p className="message-erreur" role="alert">
          {erreur}
        </p>
      )}
      <button type="submit" className="bouton bouton-encre" disabled={envoi}>
        Se connecter
      </button>
    </form>
  );
}
