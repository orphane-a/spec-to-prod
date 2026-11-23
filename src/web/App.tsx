import { useState } from 'react';
import { afficheDansTableau, DEFINITIONS_COLONNES } from '../domaine/colonnes';
import { resultatDepot, type ActionDepot } from '../domaine/glisser-deposer';
import type { Nature, Ticket } from '../domaine/types';
import { api, type Action } from './api';
import { Carte, type OngletFiche } from './composants/Carte';
import { Colonne } from './composants/Colonne';
import { Confirmation } from './composants/Confirmation';
import { Entete } from './composants/Entete';
import { FicheTicket } from './composants/FicheTicket';
import { FormulaireTicket } from './composants/FormulaireTicket';
import { IconeAlerte, IconeBug } from './composants/Icones';
import { formaterHeure } from './format';
import { useTableau } from './useTableau';

type Fenetre =
  | { type: 'aucune' }
  | { type: 'ajout'; nature: Nature }
  | { type: 'modification'; id: number }
  | { type: 'fiche'; id: number; onglet: OngletFiche }
  | { type: 'deploiement'; id: number }
  | { type: 'suppression'; id: number };

export function App() {
  const { tickets, projets, quota, chargement, erreur, connecte, remplacer, retirer } = useTableau();
  const [filtre, setFiltre] = useState<number | null>(null);
  const [fenetre, setFenetre] = useState<Fenetre>({ type: 'aucune' });
  const [occupes, setOccupes] = useState<Set<number>>(new Set());
  const [erreurAction, setErreurAction] = useState<string | null>(null);
  const [glisseId, setGlisseId] = useState<number | null>(null);
  /** Colonne survolée pendant un glisser, dans sa ligne : `fonctionnalite:dev` ou `bug:dev`. */
  const [survol, setSurvol] = useState<string | null>(null);

  const nomProjet = (id: number | null) => projets.find((p) => p.id === id)?.nom ?? null;
  const ticketPar = (id: number) => tickets.find((t) => t.id === id);
  const maintenant = new Date();
  const visibles = tickets.filter((t) => (filtre === null || t.projetId === filtre) && afficheDansTableau(t, maintenant));
  const fermer = () => setFenetre({ type: 'aucune' });

  async function agir(ticket: Ticket, action: Action, corps?: unknown) {
    setOccupes((s) => new Set(s).add(ticket.id));
    setErreurAction(null);
    try {
      remplacer(await api.agir(ticket.id, action, corps));
    } catch (e) {
      setErreurAction(`${ticket.titre} : ${e instanceof Error ? e.message : 'action impossible.'}`);
    } finally {
      setOccupes((s) => {
        const copie = new Set(s);
        copie.delete(ticket.id);
        return copie;
      });
    }
  }

  const glisse = glisseId === null ? undefined : ticketPar(glisseId);

  function finGlisser() {
    setGlisseId(null);
    setSurvol(null);
  }

  /** Un dépôt accepté déclenche la même décision que le bouton de la carte. */
  function deposer(ticket: Ticket, action: ActionDepot) {
    finGlisser();
    if (action === 'LANCER_CONCEPTION') void agir(ticket, 'lancer-conception');
    else if (action === 'LANCER_DEV') void agir(ticket, 'lancer-dev');
    else if (action === 'LANCER_CORRECTION') void agir(ticket, 'lancer-correction');
    else setFenetre({ type: 'deploiement', id: ticket.id });
  }

  const titreDe = (id: number | null) => (id === null ? null : (ticketPar(id)?.titre ?? null));
  const fonctionnalites = visibles.filter((t) => t.nature !== 'bug');
  const bugs = visibles.filter((t) => t.nature === 'bug');

  /** Les six colonnes d'une ligne. Une carte ne se dépose que dans sa propre ligne. */
  function colonnes(nature: Nature, contenus: Ticket[]) {
    const ligneBugs = nature === 'bug';
    return DEFINITIONS_COLONNES.map((definition, index) => {
      const contenu = contenus.filter((t) => t.colonne === definition.id);
      const cle = `${nature}:${definition.id}`;
      const resultat = glisse && (glisse.nature === 'bug') === ligneBugs ? resultatDepot(glisse, definition.id) : null;
      return (
        <Colonne
          key={cle}
          definition={definition}
          premiere={index === 0}
          nombre={contenu.length}
          ligneBugs={ligneBugs}
          depot={{
            resultat,
            survolee: survol === cle,
            entrer: () => setSurvol(cle),
            sortir: () => setSurvol((s) => (s === cle ? null : s)),
            deposer: () => glisse && resultat?.type === 'action' && deposer(glisse, resultat.action),
          }}
        >
          {contenu.map((ticket) => (
            <Carte
              key={ticket.id}
              ticket={ticket}
              glissee={glisseId === ticket.id}
              commencerGlisser={() => setGlisseId(ticket.id)}
              finirGlisser={finGlisser}
              projet={nomProjet(ticket.projetId)}
              trouveSur={titreDe(ticket.trouveSur)}
              occupe={occupes.has(ticket.id)}
              ouvrir={(onglet) => setFenetre({ type: 'fiche', id: ticket.id, onglet: onglet ?? (ticket.blocage ? 'journal' : 'description') })}
              lancerConception={() => agir(ticket, 'lancer-conception')}
              lancerDesign={() => agir(ticket, 'lancer-design')}
              lancerDev={() => agir(ticket, 'lancer-dev')}
              lancerCorrection={() => agir(ticket, 'lancer-correction')}
              demanderDeploiement={() => setFenetre({ type: 'deploiement', id: ticket.id })}
              relancer={() => agir(ticket, 'relancer')}
            />
          ))}
        </Colonne>
      );
    });
  }

  const ficheOuverte = fenetre.type === 'fiche' ? ticketPar(fenetre.id) : undefined;
  const aModifier = fenetre.type === 'modification' ? ticketPar(fenetre.id) : undefined;
  const aDeployer = fenetre.type === 'deploiement' ? ticketPar(fenetre.id) : undefined;
  const aSupprimer = fenetre.type === 'suppression' ? ticketPar(fenetre.id) : undefined;

  return (
    <div className="page">
      <Entete
        projets={projets}
        filtre={filtre}
        choisirFiltre={setFiltre}
        quota={quota}
        ajouter={() => setFenetre({ type: 'ajout', nature: 'fonctionnalite' })}
        signalerBug={() => setFenetre({ type: 'ajout', nature: 'bug' })}
      />

      {quota?.epuise && (
        <div className="bandeau" role="status">
          <IconeAlerte />
          <div>
            <p>Quota Claude épuisé.</p>
            <p className="secondaire">
              Les tickets concernés sont bloqués et ne repartent pas seuls.
              {quota.repriseEstimee ? ` Reprise estimée vers ${formaterHeure(quota.repriseEstimee)}.` : ''} Relancez les quand le quota est rétabli.
            </p>
          </div>
        </div>
      )}

      {erreur && (
        <p className="message-erreur" role="alert">
          {erreur}
        </p>
      )}
      {!connecte && !chargement && !erreur && (
        <p className="texte" role="status">
          Connexion au serveur perdue. Le tableau se met à jour dès son retour.
        </p>
      )}
      {erreurAction && (
        <p className="message-erreur" role="alert">
          {erreurAction}
        </p>
      )}

      <main className="defilement" aria-busy={chargement}>
        <section aria-labelledby="ligne-fonctionnalites" className="ligne">
          <div className="ligne-titre">
            <h2 id="ligne-fonctionnalites">Fonctionnalités</h2>
            <span className="texte">Chaque ticket passe par la conception et la spec</span>
          </div>
          <div className="tableau">{colonnes('fonctionnalite', fonctionnalites)}</div>
        </section>

        <section aria-labelledby="ligne-bugs" className="ligne ligne-bugs">
          <div className="bandeau-bugs">
            <IconeBug taille={26} />
            <h2 id="ligne-bugs">Bugs</h2>
            <span className="compteur compteur-bug" aria-label={`${bugs.length} ${bugs.length > 1 ? 'bugs' : 'bug'}`}>
              {bugs.length}
            </span>
            <p>Correction directe, sans phase de spec. Les bugs trouvés par l’agent de test exploratoire arrivent ici.</p>
          </div>
          <div className="tableau">{colonnes('bug', bugs)}</div>
        </section>
      </main>

      {fenetre.type === 'ajout' && (
        <FormulaireTicket
          projets={projets}
          projetParDefaut={filtre}
          nature={fenetre.nature}
          fermer={fermer}
          enregistrer={async (saisie) => {
            remplacer(await api.creer(saisie));
            fermer();
          }}
        />
      )}

      {aModifier && (
        <FormulaireTicket
          projets={projets}
          ticket={aModifier}
          projetParDefaut={filtre}
          fermer={() => setFenetre({ type: 'fiche', id: aModifier.id, onglet: 'description' })}
          enregistrer={async (saisie) => {
            remplacer(await api.modifier(aModifier.id, saisie));
            setFenetre({ type: 'fiche', id: aModifier.id, onglet: 'description' });
          }}
        />
      )}

      {ficheOuverte && fenetre.type === 'fiche' && (
        <FicheTicket
          key={ficheOuverte.id}
          ticket={ficheOuverte}
          projet={nomProjet(ficheOuverte.projetId)}
          ongletInitial={fenetre.onglet}
          fermer={fermer}
          modifier={() => setFenetre({ type: 'modification', id: ficheOuverte.id })}
          supprimer={() => setFenetre({ type: 'suppression', id: ficheOuverte.id })}
          remplacer={remplacer}
        />
      )}

      {aDeployer && (
        <Confirmation
          titre="Déployer en prod ?"
          libelleConfirmer="Oui, déployer en prod"
          fermer={fermer}
          confirmer={async () => {
            remplacer(await api.agir(aDeployer.id, 'deployer-prod', { confirmation: true }));
            fermer();
          }}
        >
          <p style={{ marginTop: 0 }}>
            La branche de « {aDeployer.titre} » sera fusionnée puis envoyée sur le serveur de production.
          </p>
          <p style={{ marginBottom: 0 }}>
            {aDeployer.scenarios.filter((s) => s.fait).length} scénarios faits sur {aDeployer.scenarios.length}.
          </p>
        </Confirmation>
      )}

      {aSupprimer && (
        <Confirmation
          titre="Supprimer ce ticket ?"
          libelleConfirmer="Supprimer"
          variante="danger"
          fermer={() => setFenetre({ type: 'fiche', id: aSupprimer.id, onglet: 'description' })}
          confirmer={async () => {
            await api.supprimer(aSupprimer.id);
            retirer(aSupprimer.id);
            fermer();
          }}
        >
          <p style={{ margin: 0 }}>« {aSupprimer.titre} » et son journal seront supprimés définitivement.</p>
          {(aSupprimer.branche || aSupprimer.versionDeployee) && (
            <p style={{ marginBottom: 0 }}>La branche GitHub et ce qui est déjà en ligne ne seront pas touchés.</p>
          )}
        </Confirmation>
      )}
    </div>
  );
}
