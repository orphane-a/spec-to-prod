import type { ControlesDev, EtapesDeploiement, EtatControle, Ticket } from '../../domaine/types';
import { actionsDisponibles } from '../../domaine/machine-etats';
import { formaterHeure, formaterJour, pluriel } from '../format';
import { IconeAlerte, IconeCercle, IconeCoche, IconeCroix, IconePersonne, IconeRotation } from './Icones';

export type OngletFiche = 'description' | 'spec' | 'design' | 'scenarios' | 'commentaires' | 'journal';

interface Props {
  ticket: Ticket;
  projet: string | null;
  occupe: boolean;
  ouvrir: (onglet?: OngletFiche) => void;
  lancerConception: () => void;
  lancerDesign: () => void;
  lancerDev: () => void;
  lancerCorrection: () => void;
  /** Titre du ticket dont le test exploratoire a trouvé ce bug, s'il est encore là. */
  trouveSur: string | null;
  demanderDeploiement: () => void;
  relancer: () => void;
  glissee: boolean;
  commencerGlisser: () => void;
  finirGlisser: () => void;
}

/** Enveloppe glissable : un ticket terminé ou en cours d'action ne se déplace pas. */
export function Carte(props: Props) {
  const { ticket, occupe, glissee } = props;
  const deplacable = ticket.colonne !== 'done' && !occupe;
  return (
    <div
      className={`carte-deplacable${deplacable ? ' actif' : ''}${glissee ? ' glissee' : ''}`}
      draggable={deplacable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(ticket.id));
        props.commencerGlisser();
      }}
      onDragEnd={props.finirGlisser}
    >
      <ContenuCarte {...props} />
    </div>
  );
}

function ContenuCarte(props: Props) {
  const { ticket } = props;
  if (ticket.blocage) return <CarteBloquee {...props} />;
  if (ticket.colonne === 'done') return <CarteDone {...props} />;

  return (
    <article className="carte" aria-label={ticket.titre}>
      <Titre {...props} />
      {props.projet && <span className="etiquette">{props.projet}</span>}
      <Corps {...props} />
    </article>
  );
}

function Titre({ ticket, ouvrir }: Props) {
  return (
    <h3 className="carte-titre">
      <button type="button" onClick={() => ouvrir()}>
        {ticket.titre}
      </button>
    </h3>
  );
}

function Corps(props: Props) {
  const { ticket, occupe } = props;
  const actions = actionsDisponibles(ticket);

  switch (ticket.colonne) {
    case 'backlog':
      if (ticket.nature === 'bug') return <BugEnAttente {...props} />;
      return (
        <>
          {ticket.description && <p className="texte">{premierePhrase(ticket.description)}</p>}
          <button type="button" className="bouton bouton-contour" disabled={occupe} onClick={props.lancerConception}>
            Lancer la conception
          </button>
        </>
      );

    case 'conception':
      if (ticket.runEnCours === 'spec' || !ticket.spec) {
        return (
          <>
            <p className="statut en-cours">
              <IconeRotation />
              Claude rédige la spec
            </p>
            <button type="button" className="bouton bouton-attente" disabled aria-describedby={`attente-${ticket.id}`}>
              Lancer le dev
            </button>
            <p className="texte-petit" id={`attente-${ticket.id}`}>
              Disponible quand la spec est prête.
            </p>
          </>
        );
      }
      if (ticket.runEnCours === 'design') {
        return (
          <>
            <p className="statut valide">
              <IconeCoche />
              Spec prête
            </p>
            <p className="statut en-cours">
              <IconeRotation />
              Claude conçoit la maquette
            </p>
            <button type="button" className="bouton bouton-contour" onClick={() => props.ouvrir('spec')}>
              Lire la spec
            </button>
            <button type="button" className="bouton bouton-attente" disabled aria-describedby={`attente-${ticket.id}`}>
              Lancer le dev
            </button>
            <p className="texte-petit" id={`attente-${ticket.id}`}>
              Disponible quand la maquette est prête.
            </p>
          </>
        );
      }
      if (!ticket.urlMaquette) {
        return (
          <>
            <p className="statut valide">
              <IconeCoche />
              Spec prête
            </p>
            <p className="texte">Pas de maquette pour ce ticket. Le design est facultatif.</p>
            <button type="button" className="bouton bouton-contour" onClick={() => props.ouvrir('spec')}>
              Lire la spec
            </button>
            <button type="button" className="bouton bouton-contour" disabled={occupe || !actions.includes('LANCER_DESIGN')} onClick={props.lancerDesign}>
              Lancer le design
            </button>
            <button type="button" className="bouton bouton-ambre" disabled={occupe || !actions.includes('LANCER_DEV')} onClick={props.lancerDev}>
              Lancer le dev
            </button>
          </>
        );
      }
      return (
        <>
          <p className="statut valide">
            <IconeCoche />
            Spec et maquette prêtes
          </p>
          <p className="texte">
            Spec version {ticket.specVersion}, design version {ticket.designVersion}, à relire avant le développement.
          </p>
          <button type="button" className="bouton bouton-contour" onClick={() => props.ouvrir('design')}>
            Voir le design
          </button>
          <button type="button" className="bouton bouton-ambre" disabled={occupe || !actions.includes('LANCER_DEV')} onClick={props.lancerDev}>
            Lancer le dev
          </button>
        </>
      );

    case 'dev':
      if (ticket.runEnCours === 'preprod') {
        return (
          <>
            {ticket.branche && <p className="branche">Branche {ticket.branche}</p>}
            <p className="statut valide">
              <IconeCoche />
              Dev terminé, tests au vert
            </p>
            <p className="statut en-cours">
              <IconeRotation />
              Déploiement en préprod
            </p>
            <p className="texte-petit">{pluriel(ticket.scenarios.length, 'scénario')} prêts pour vos tests.</p>
          </>
        );
      }
      return (
        <>
          {ticket.branche && <p className="branche">Branche {ticket.branche}</p>}
          <Iterations ticket={ticket} />
          <Controles controles={ticket.controles} bug={ticket.nature === 'bug'} />
        </>
      );

    case 'test': {
      const faits = ticket.scenarios.filter((s) => s.fait).length;
      const total = ticket.scenarios.length;
      return (
        <>
          <p className="statut valide">
            <IconeCoche />
            Préprod à jour
          </p>
          <div className="progression">
            <span className="normal">
              {pluriel(total, 'scénario')} à réaliser, {faits === 0 ? 'aucun encore fait' : `${faits} déjà ${faits > 1 ? 'faits' : 'fait'}`}.
            </span>
            <Segments total={total} pleins={faits} valide libelle={`${faits} ${faits > 1 ? 'scénarios' : 'scénario'} sur ${total} ${faits > 1 ? 'réalisés' : 'réalisé'}`} />
          </div>
          <button type="button" className="bouton bouton-contour" onClick={() => props.ouvrir('scenarios')}>
            Ouvrir les scénarios
          </button>
          <button type="button" className="bouton bouton-ambre" disabled={occupe} onClick={props.demanderDeploiement}>
            Déployer en prod
          </button>
        </>
      );
    }

    case 'deploiement':
      return <Etapes etapes={ticket.etapesDeploiement} />;

    default:
      return null;
  }
}

/** Bug du backlog : son origine, sa description et la correction directe, sans conception. */
function BugEnAttente(props: Props) {
  const { ticket, occupe } = props;
  const possible = actionsDisponibles(ticket).includes('LANCER_CORRECTION');
  return (
    <>
      {ticket.origine === 'agent' ? (
        <p className="statut en-cours">
          <IconeRotation taille={14} />
          Trouvé par l’agent de test
        </p>
      ) : (
        <p className="statut origine">
          <IconePersonne taille={14} />
          Signalé par vous
        </p>
      )}
      {ticket.description && <p className="texte">{premierePhrase(ticket.description)}</p>}
      {props.trouveSur && <p className="texte-petit">Remonté pendant le test exploratoire de « {props.trouveSur} ».</p>}
      <button
        type="button"
        className="bouton bouton-ambre"
        disabled={occupe || !possible}
        aria-describedby={possible ? undefined : `correction-${ticket.id}`}
        onClick={props.lancerCorrection}
      >
        Lancer la correction
      </button>
      {!possible && (
        <p className="texte-petit" id={`correction-${ticket.id}`}>
          Ajoutez une description pour que Claude puisse reproduire le bug.
        </p>
      )}
    </>
  );
}

function CarteBloquee(props: Props) {
  const { ticket } = props;
  const blocage = ticket.blocage!;
  return (
    <article className="carte bloquee" aria-label={`${ticket.titre}, bloqué`}>
      <Titre {...props} />
      {props.projet && <span className="etiquette">{props.projet}</span>}
      <p className="statut bloque">
        <IconeAlerte />
        <span>Bloqué : {blocage.motif.replace(/\.$/, '')}.</span>
      </p>
      {blocage.cause === 'quota' && (
        <p className="texte">
          {blocage.repriseEstimee ? `Reprise estimée vers ${formaterHeure(blocage.repriseEstimee)}.` : 'Heure de reprise inconnue.'} Relancez quand le quota est rétabli.
        </p>
      )}
      <button type="button" className="bouton bouton-ambre" disabled={props.occupe} onClick={props.relancer}>
        Relancer
      </button>
      <button type="button" className="bouton bouton-contour" onClick={() => props.ouvrir('journal')}>
        Ouvrir le journal
      </button>
    </article>
  );
}

function CarteDone({ ticket, projet, ouvrir }: Props) {
  return (
    <article className="carte compacte" aria-label={ticket.titre}>
      <h3 className="carte-titre">
        <button type="button" onClick={() => ouvrir()}>
          {ticket.titre}
        </button>
      </h3>
      <p className="texte">
        {[projet, ticket.deployeLe ? `${ticket.nature === 'bug' ? 'corrigé' : 'en ligne'} le ${formaterJour(ticket.deployeLe)}` : ticket.nature === 'bug' ? 'corrigé' : 'en ligne']
          .filter(Boolean)
          .join(', ')}
        {ticket.versionDeployee ? ` (${ticket.versionDeployee})` : ''}
      </p>
    </article>
  );
}

function Iterations({ ticket }: { ticket: Ticket }) {
  const actuelle = ticket.iteration === 0 && ticket.runEnCours === 'dev' ? 1 : ticket.iteration;
  const libelle = `Itération ${actuelle} sur ${ticket.iterationMax}`;
  return (
    <div className="progression">
      <span>{libelle}</span>
      <Segments total={ticket.iterationMax} pleins={actuelle} libelle={libelle} />
    </div>
  );
}

function Segments({ total, pleins, libelle, valide = false }: { total: number; pleins: number; libelle: string; valide?: boolean }) {
  return (
    <div role="img" aria-label={libelle} className={`segments${valide ? ' valide' : ''}`}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className={i < pleins ? 'plein' : undefined} />
      ))}
    </div>
  );
}

const LIBELLES_CONTROLES: Record<keyof ControlesDev, string> = {
  unitaires: 'Tests unitaires',
  non_regression: 'Non régression',
  exploratoire: 'Test exploratoire',
};

const SUFFIXES: Record<EtatControle, (pluriel: boolean) => string> = {
  vert: (p) => (p ? 'verts' : 'vert'),
  rouge: (p) => (p ? 'en échec' : 'en échec'),
  en_cours: () => 'en cours',
  en_attente: () => 'en attente',
};

function Controles({ controles, bug = false }: { controles: ControlesDev; bug?: boolean }) {
  return (
    <ul className="controles" aria-label="Contrôles">
      {(Object.keys(LIBELLES_CONTROLES) as (keyof ControlesDev)[]).map((cle) => {
        const etat = controles[cle];
        // Pour un bug, les tests unitaires commencent par le test qui reproduit le bug.
        const texte =
          bug && cle === 'unitaires'
            ? `Test qui reproduit le bug ${etat === 'vert' ? 'au vert' : SUFFIXES[etat](false)}`
            : `${LIBELLES_CONTROLES[cle]} ${SUFFIXES[etat](cle === 'unitaires')}`;
        return (
          <li key={cle} className={classeEtat(etat)}>
            <IconeEtat etat={etat} />
            {texte}
          </li>
        );
      })}
    </ul>
  );
}

const LIBELLES_ETAPES: Record<keyof EtapesDeploiement, string> = {
  fusion: 'Fusion de la branche',
  envoi: 'Envoi sur le serveur',
  verification: 'Vérification du site',
};

function Etapes({ etapes }: { etapes: EtapesDeploiement }) {
  return (
    <ul className="controles" aria-label="Étapes du déploiement">
      {(Object.keys(LIBELLES_ETAPES) as (keyof EtapesDeploiement)[]).map((cle) => (
        <li key={cle} className={classeEtat(etapes[cle])}>
          <IconeEtat etat={etapes[cle]} />
          {LIBELLES_ETAPES[cle]}
          <span className="visuellement-cache"> : {SUFFIXES[etapes[cle]](false)}</span>
        </li>
      ))}
    </ul>
  );
}

const classeEtat = (etat: EtatControle) => (etat === 'en_attente' ? 'attente' : etat === 'rouge' ? 'rouge' : undefined);

function IconeEtat({ etat }: { etat: EtatControle }) {
  if (etat === 'vert') return <IconeCoche />;
  if (etat === 'en_cours') return <IconeRotation />;
  if (etat === 'rouge') return <IconeCroix />;
  return <IconeCercle />;
}

function premierePhrase(texte: string): string {
  const ligne = texte.split('\n')[0] ?? '';
  return ligne.length > 140 ? `${ligne.slice(0, 137)}...` : ligne;
}
