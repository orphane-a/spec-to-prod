import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { definitionColonne } from '../../domaine/colonnes';
import { refusCorrection } from '../../domaine/correction-manuelle';
import { estModifiable, estSupprimable } from '../../domaine/machine-etats';
import type { EvenementJournal, SujetCommentaire, Ticket } from '../../domaine/types';
import { api } from '../api';
import { formaterHeure, formaterHorodatage } from '../format';
import type { OngletFiche } from './Carte';
import { Commentaires } from './Commentaires';
import { EditeurCorrection } from './EditeurCorrection';
import { Fenetre } from './Fenetre';

interface Props {
  ticket: Ticket;
  projet: string | null;
  ongletInitial: OngletFiche;
  fermer: () => void;
  modifier: () => void;
  supprimer: () => void;
  remplacer: (ticket: Ticket) => void;
}

const ONGLETS: { id: OngletFiche; libelle: string }[] = [
  { id: 'description', libelle: 'Description' },
  { id: 'spec', libelle: 'Spec' },
  { id: 'design', libelle: 'Design' },
  { id: 'scenarios', libelle: 'Scénarios' },
  { id: 'commentaires', libelle: 'Commentaires' },
  { id: 'journal', libelle: 'Journal' },
];

export function FicheTicket({ ticket, projet, ongletInitial, fermer, modifier, supprimer, remplacer }: Props) {
  // Un bug n'a ni spec ni design : ces onglets ne s'affichent pas.
  const onglets = ticket.nature === 'bug' ? ONGLETS.filter((o) => o.id !== 'spec' && o.id !== 'design') : ONGLETS;
  const [onglet, setOnglet] = useState<OngletFiche>(onglets.some((o) => o.id === ongletInitial) ? ongletInitial : 'description');
  const [sujet, setSujet] = useState<SujetCommentaire>('general');
  const enAttente = ticket.commentaires.filter((c) => c.prisEnCompteLe === null).length;

  // Sur téléphone la barre d'onglets défile : l'onglet actif reste visible.
  useEffect(() => {
    document.getElementById(`onglet-${onglet}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [onglet]);

  // Bouton Commenter des onglets Spec, Design et Scénarios : ouvre les commentaires sur le bon sujet.
  function commenterSur(s: SujetCommentaire) {
    setSujet(s);
    setOnglet('commentaires');
    requestAnimationFrame(() => document.getElementById('nouveau-commentaire')?.focus());
  }

  return (
    <Fenetre titre={ticket.titre} fermer={fermer} variante="panneau">
      <div className="meta">
        {projet && <span className="etiquette">{projet}</span>}
        <span className="etiquette">{definitionColonne(ticket.colonne).libelle}</span>
        {ticket.branche && <span className="branche">Branche {ticket.branche}</span>}
      </div>

      {ticket.blocage && (
        <p className="message-erreur" role="status">
          Bloqué depuis le {formaterHorodatage(ticket.blocage.le)} : {ticket.blocage.motif.replace(/\.$/, '')}.
          {ticket.blocage.repriseEstimee && ` Reprise estimée vers ${formaterHeure(ticket.blocage.repriseEstimee)}.`}
        </p>
      )}

      <div role="tablist" aria-label="Contenu du ticket" className="onglets">
        {onglets.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            id={`onglet-${o.id}`}
            aria-selected={onglet === o.id}
            aria-controls={`panneau-${o.id}`}
            tabIndex={onglet === o.id ? 0 : -1}
            className="onglet"
            onClick={() => setOnglet(o.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const i = onglets.findIndex((x) => x.id === onglet);
              const suivant = onglets[(i + (e.key === 'ArrowRight' ? 1 : onglets.length - 1)) % onglets.length]!;
              setOnglet(suivant.id);
              document.getElementById(`onglet-${suivant.id}`)?.focus();
            }}
          >
            {o.libelle}
            {o.id === 'commentaires' && enAttente > 0 && (
              <span className="compteur" aria-label={`, ${enAttente} en attente`}>
                {enAttente}
              </span>
            )}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panneau-${onglet}`} aria-labelledby={`onglet-${onglet}`} className="section">
        {onglet === 'description' && <Description ticket={ticket} modifier={modifier} supprimer={supprimer} />}
        {onglet === 'spec' && <Spec ticket={ticket} remplacer={remplacer} commenter={() => commenterSur('spec')} />}
        {onglet === 'design' && <Design ticket={ticket} remplacer={remplacer} commenter={() => commenterSur('design')} />}
        {onglet === 'scenarios' && <Scenarios ticket={ticket} remplacer={remplacer} commenter={() => commenterSur('tests')} />}
        {onglet === 'commentaires' && <Commentaires ticket={ticket} sujetInitial={sujet} remplacer={remplacer} />}
        {onglet === 'journal' && <Journal ticket={ticket} />}
      </div>
    </Fenetre>
  );
}

function Description({ ticket, modifier, supprimer }: { ticket: Ticket; modifier: () => void; supprimer: () => void }) {
  return (
    <div className="fenetre-contenu" style={{ padding: 0 }}>
      {ticket.nature === 'bug' && (
        <p className="statut bloque" style={{ margin: 0 }}>
          {ticket.origine === 'agent' ? 'Bug trouvé par l’agent de test pendant un dev.' : 'Bug signalé par vous.'} Il se corrige sans spec ni maquette.
        </p>
      )}
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{ticket.description || 'Aucune description.'}</p>
      {ticket.urlPreprod && (
        <p style={{ margin: 0 }}>
          Préprod :{' '}
          <a href={ticket.urlPreprod} target="_blank" rel="noreferrer noopener">
            {ticket.urlPreprod}
          </a>
        </p>
      )}
      {ticket.versionDeployee && <p style={{ margin: 0 }}>Version en ligne : {ticket.versionDeployee}</p>}
      {(estModifiable(ticket) || estSupprimable(ticket)) && (
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {estModifiable(ticket) && (
            <button type="button" className="bouton bouton-contour" onClick={modifier}>
              Modifier
            </button>
          )}
          {estSupprimable(ticket) && (
            <button type="button" className="bouton bouton-danger" onClick={supprimer}>
              Supprimer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Bouton « Modifier » d'un bloc (spec ou design) et état d'édition.
 * La règle vient du domaine, la même que celle du serveur : conception ou dev, sans run en cours.
 */
function useCorrection(ticket: Ticket) {
  const [edition, setEdition] = useState(false);
  const bouton = useRef<HTMLButtonElement>(null);
  const refus = refusCorrection(ticket);

  function termine() {
    setEdition(false);
    // Le bouton revient après l'affichage : on lui rend le focus pour le clavier.
    requestAnimationFrame(() => bouton.current?.focus());
  }

  const boutonModifier =
    refus === null ? (
      <button ref={bouton} type="button" className="bouton bouton-contour" onClick={() => setEdition(true)}>
        Modifier
      </button>
    ) : refus.code === 'RUN_EN_COURS' ? (
      <p className="texte-petit" style={{ margin: 0 }}>
        La modification est possible quand aucun run ne tourne.
      </p>
    ) : null;

  return { edition: edition && refus === null, termine, boutonModifier };
}

function Spec({ ticket, remplacer, commenter }: { ticket: Ticket; remplacer: (t: Ticket) => void; commenter: () => void }) {
  const html = useMemo(() => (ticket.spec ? DOMPurify.sanitize(marked.parse(ticket.spec, { async: false })) : ''), [ticket.spec]);
  const { edition, termine, boutonModifier } = useCorrection(ticket);

  if (edition) return <EditeurCorrection genre="spec" ticket={ticket} remplacer={remplacer} termine={termine} />;
  return (
    <>
      <div className="entete-bloc">
        {ticket.spec ? <p className="texte-petit">Version {ticket.specVersion}</p> : <span />}
        <div className="boutons-bloc">
          <BoutonCommenter commenter={commenter} />
          {boutonModifier}
        </div>
      </div>
      {ticket.spec ? (
        <div className="spec" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="texte">{ticket.runEnCours === 'spec' ? 'Claude rédige la spec. Elle apparaîtra ici.' : 'Pas encore de spec pour ce ticket.'}</p>
      )}
    </>
  );
}

/**
 * Maquettes que le serveur sait lire et afficher dans la fiche : fichier GitHub ou mode simulé.
 * Une maquette Claude Design (claude.ai) demande ta connexion : elle s'ouvre dans un nouvel onglet.
 */
function apercuPossible(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'maquette.exemple.test' || (u.hostname === 'github.com' && u.pathname.split('/')[3] === 'blob'));
  } catch {
    return false;
  }
}

function Design({ ticket, remplacer, commenter }: { ticket: Ticket; remplacer: (t: Ticket) => void; commenter: () => void }) {
  const html = useMemo(() => (ticket.design ? DOMPurify.sanitize(marked.parse(ticket.design, { async: false })) : ''), [ticket.design]);
  const { edition, termine, boutonModifier } = useCorrection(ticket);
  // La version dans l'adresse recharge l'aperçu quand Claude livre un nouveau design.
  const apercu = `/api/tickets/${ticket.id}/maquette?version=${ticket.designVersion}`;

  if (edition) return <EditeurCorrection genre="design" ticket={ticket} remplacer={remplacer} termine={termine} />;
  return (
    <>
      <div className="entete-bloc">
        {ticket.design ? <p className="texte-petit">Version {ticket.designVersion}</p> : <span />}
        <div className="boutons-bloc">
          <BoutonCommenter commenter={commenter} />
          {boutonModifier}
        </div>
      </div>
      {ticket.design ? (
        <>
          {ticket.urlMaquette && apercuPossible(ticket.urlMaquette) && (
            <>
              <iframe
                className="apercu-maquette"
                title="Maquette du ticket"
                src={apercu}
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
              <p className="liens-maquette">
                <a href={apercu} target="_blank" rel="noreferrer noopener">
                  Ouvrir la maquette en plein écran
                </a>
                {/^https?:\/\//i.test(ticket.urlMaquette) && (
                  <a href={ticket.urlMaquette} target="_blank" rel="noreferrer noopener">
                    Voir le fichier source
                  </a>
                )}
              </p>
            </>
          )}
          {ticket.urlMaquette && !apercuPossible(ticket.urlMaquette) && ticket.urlMaquette.startsWith('https://') && (
            <p style={{ marginTop: 0 }}>
              <a href={ticket.urlMaquette} target="_blank" rel="noreferrer noopener">
                Ouvrir la maquette
              </a>
            </p>
          )}
          <div className="spec" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      ) : (
        <p className="texte">{ticket.runEnCours === 'design' ? 'Claude conçoit la maquette. Elle apparaîtra ici.' : 'Pas encore de design pour ce ticket.'}</p>
      )}
    </>
  );
}

function Scenarios({ ticket, remplacer, commenter }: { ticket: Ticket; remplacer: (t: Ticket) => void; commenter: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  // Valeurs affichées tout de suite, en attendant la réponse du serveur.
  const [enAttente, setEnAttente] = useState<Record<number, boolean>>({});
  const modifiable = ticket.colonne === 'test';

  if (ticket.scenarios.length === 0) {
    return <p className="texte">Les scénarios de test arrivent quand le ticket passe en test.</p>;
  }

  async function basculer(ordre: number, fait: boolean) {
    setErreur(null);
    setEnAttente((e) => ({ ...e, [ordre]: fait }));
    try {
      remplacer(await api.marquerScenario(ticket.id, ordre, fait));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Enregistrement impossible.');
    } finally {
      setEnAttente((e) => {
        const reste = { ...e };
        delete reste[ordre];
        return reste;
      });
    }
  }

  return (
    <>
      <div className="entete-bloc">
        {ticket.urlPreprod ? (
          <p style={{ margin: 0 }}>
            À tester sur{' '}
            <a href={ticket.urlPreprod} target="_blank" rel="noreferrer noopener">
              la préprod
            </a>
            .
          </p>
        ) : (
          <span />
        )}
        <BoutonCommenter commenter={commenter} />
      </div>
      {erreur && (
        <p className="message-erreur" role="alert">
          {erreur}
        </p>
      )}
      <ul className="liste-scenarios">
        {ticket.scenarios.map((s) => (
          <li key={s.id} className="scenario">
            <input type="checkbox" id={`scenario-${s.id}`} checked={enAttente[s.id] ?? s.fait} disabled={!modifiable} onChange={(e) => basculer(s.id, e.target.checked)} />
            <label htmlFor={`scenario-${s.id}`}>{s.objectif}</label>
            <dl>
              <dt>Étapes</dt>
              <dd>{s.etapes}</dd>
              <dt>Attendu</dt>
              <dd>{s.resultatAttendu}</dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function BoutonCommenter({ commenter }: { commenter: () => void }) {
  return (
    <button type="button" className="bouton bouton-contour" onClick={commenter}>
      Commenter
    </button>
  );
}

/** Rend cliquables les liens du journal (session Claude, maquette, préprod). */
function avecLiens(texte: string) {
  return texte.split(/(https:\/\/[^\s]+[^\s.,;:!?)])/g).map((morceau, i) =>
    i % 2 === 1 ? (
      <a key={i} href={morceau} target="_blank" rel="noreferrer noopener">
        {morceau}
      </a>
    ) : (
      morceau
    ),
  );
}

function Journal({ ticket }: { ticket: Ticket }) {
  const [entrees, setEntrees] = useState<EvenementJournal[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    api
      .journal(ticket.id)
      .then((j) => actif && setEntrees(j))
      .catch((e: Error) => actif && setErreur(e.message));
    return () => {
      actif = false;
    };
    // Le journal se recharge à chaque changement du ticket.
  }, [ticket.id, ticket.modifieLe]);

  if (erreur) return <p className="message-erreur">{erreur}</p>;
  if (!entrees) return <p className="texte">Chargement du journal...</p>;
  if (entrees.length === 0) return <p className="texte">Le journal est vide.</p>;

  return (
    <ol className="liste-journal">
      {[...entrees].reverse().map((e) => (
        <li key={e.id} className={`entree-journal${e.type === 'blocage' ? ' blocage' : ''}`}>
          <time dateTime={e.date}>{formaterHorodatage(e.date)}</time>
          <span>{avecLiens(e.detail)}</span>
        </li>
      ))}
    </ol>
  );
}
