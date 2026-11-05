// «Correggi dati»: si corregge un errore di inserimento direttamente da
// «Organico» (un livello sbagliato, un nome scritto male, le ore
// battute male quando si e' aggiunta una persona). Non e' un cambiamento:
// quello si segna con «Segna» e vale da una data.
//
// Nome, cognome e livello si correggono per tutti. Negozio, contratto, ore,
// inizio e scadenza solo finche' l'assunzione segnata in azienda aspetta
// i documenti dello studio: in quel caso si correggono insieme scheda e
// assunzione, cosi' Organico, turni, ferie e Dipendenti dicono la stessa
// cosa. Arrivati i documenti vale lo studio (regola del 29/09/2026).
// Tutto passa da organico_correggi_persona (migration 334), che lascia una
// nota datata in coda alla scheda.

import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Modal } from './ui/Modal';
import { useToast } from './Toast';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { sqlNull } from '../lib/sqlNull';
import { nomePersona, type EventoOrganico, type PersonaOggi } from '../lib/organico';
import { nomeNegozio, type NegozioRif } from '../lib/organicoDati';

type Props = {
  onClose: () => void;
  onSalvato: () => void;
  persona: PersonaOggi;
  eventi: EventoOrganico[];
  negozi: NegozioRif[];
  /** apre tutti i dati dell'anagrafica (codice fiscale, qualifica, tempo
   *  determinato...): solo per chi scrive l'anagrafica e solo per chi ha gia'
   *  i documenti dello studio. Per chi li aspetta passa tutto da qui, cosi'
   *  scheda e assunzione restano allineate. */
  onAltriDati?: () => void;
};

const LIVELLI = ['1 Livello', '2 Livello', '3 Livello', '4 Livello', '5 Livello', '6 Livello', '7 Livello'];

const inputCls = 'w-full min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

/** L'assunzione segnata in azienda che aspetta ancora i documenti dello studio. */
export function assunzioneInAttesa(eventi: EventoOrganico[], employeeId: string): EventoOrganico | null {
  const lista = eventi
    .filter((e) => e.employee_id === employeeId && e.tipo === 'assunzione' && e.stato === 'da_confermare')
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  return lista[0] ?? null;
}

export default function CorreggiPersona({ onClose, onSalvato, persona, eventi, negozi, onAltriDati }: Props) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const autore = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || profile?.email || '';
  const s = persona.scheda;
  const ass = useMemo(() => assunzioneInAttesa(eventi, s.id), [eventi, s.id]);

  const [nome, setNome] = useState(s.nome ?? '');
  const [cognome, setCognome] = useState(s.cognome ?? '');
  const [livello, setLivello] = useState(s.livello ?? '');
  // Per chi aspetta lo studio i valori veri sono quelli dell'assunzione segnata.
  const [negozio, setNegozio] = useState(ass?.outlet_id ?? s.outlet_id ?? '');
  const [contratto, setContratto] = useState(ass?.contratto_tipo ?? s.contratto_tipo ?? 'determinato');
  const [ore, setOre] = useState(String(ass?.ore_settimanali ?? s.ore_settimanali ?? ''));
  const [dal, setDal] = useState(ass?.data_dal ?? s.data_assunzione ?? '');
  const [al, setAl] = useState(ass?.data_al ?? s.scadenza_td ?? '');
  const [salvo, setSalvo] = useState(false);

  useEffect(() => { if (contratto === 'indeterminato') setAl(''); }, [contratto]);

  const aChiamata = /chiamata/.test(contratto);
  const errore = useMemo(() => {
    if (!nome.trim() || !cognome.trim()) return 'Servono nome e cognome.';
    if (!ass) return null;
    if (!negozio) return 'Scegli il negozio.';
    if (!dal) return 'Indica la data di inizio.';
    if (contratto === 'determinato' && !al) return 'Indica la scadenza del contratto.';
    if (al && dal && al < dal) return 'La scadenza viene prima della data di inizio.';
    if (!aChiamata && (!ore || Number(ore) <= 0 || Number(ore) > 48)) return 'Le ore settimanali vanno da 1 a 48.';
    return null;
  }, [nome, cognome, ass, negozio, dal, al, contratto, ore, aChiamata]);

  const salva = async () => {
    if (errore || salvo) return;
    setSalvo(true);
    try {
      const { data, error } = await supabase.rpc('organico_correggi_persona', {
        p_employee_id: s.id,
        p_nome: nome.trim(),
        p_cognome: cognome.trim(),
        p_livello: livello,
        // NULL voluto quando non c'e' un'assunzione da confermare: in quel caso la
        // funzione non legge questi campi (vedi sqlNull).
        p_outlet_id: sqlNull(ass ? negozio : null),
        p_contratto_tipo: sqlNull(ass ? contratto : null),
        p_ore_settimanali: sqlNull(ass && ore ? Number(ore) : null),
        p_data_assunzione: sqlNull(ass ? dal : null),
        p_scadenza: sqlNull(ass && contratto !== 'indeterminato' && al ? al : null),
        p_autore_nome: autore,
      });
      if (error) throw error;
      toast({
        type: 'success',
        message: data ? `Dati di ${cognome.trim()} ${nome.trim()} corretti.` : 'Nessuna differenza da salvare.',
      });
      onSalvato();
      onClose();
    } catch (e) {
      toast({ type: 'error', message: e instanceof Error ? e.message : 'Correzione non riuscita.' });
    } finally {
      setSalvo(false);
    }
  };

  const negoziScelta = negozi.filter((n) => n.is_active !== false || n.id === negozio);
  const livelli = livello && !LIVELLI.includes(livello) ? [livello, ...LIVELLI] : LIVELLI;

  return (
    <Modal open onClose={onClose} title={`Modifica i dati di ${nomePersona(s)}`} maxWidthClass="max-w-2xl" closeOnBackdrop={false}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls} htmlFor="cp-cognome">Cognome</label><input id="cp-cognome" className={inputCls} value={cognome} onChange={(e) => setCognome(e.target.value)} /></div>
          <div><label className={labelCls} htmlFor="cp-nome">Nome</label><input id="cp-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="cp-livello">Livello</label>
            <select id="cp-livello" className={inputCls} value={livello} onChange={(e) => setLivello(e.target.value)}>
              <option value="">Non indicato</option>
              {livelli.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="cp-negozio">Negozio</label>
            <select id="cp-negozio" className={inputCls} value={negozio} onChange={(e) => setNegozio(e.target.value)} disabled={!ass}>
              <option value="">Scegli…</option>
              {negoziScelta.map((n) => <option key={n.id} value={n.id}>{nomeNegozio(n)}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls} htmlFor="cp-contratto">Contratto</label>
            <select id="cp-contratto" className={inputCls} value={contratto} onChange={(e) => setContratto(e.target.value)} disabled={!ass}>
              <option value="determinato">Tempo determinato</option>
              <option value="indeterminato">Tempo indeterminato</option>
              {!['determinato', 'indeterminato'].includes(contratto) && <option value={contratto}>{aChiamata ? 'A chiamata' : contratto}</option>}
            </select>
          </div>
          <div><label className={labelCls} htmlFor="cp-ore">Ore settimanali</label><input id="cp-ore" type="number" min={1} max={48} step={0.5} className={inputCls} value={ore} onChange={(e) => setOre(e.target.value)} disabled={!ass} /></div>
          <div><label className={labelCls} htmlFor="cp-dal">Inizio</label><input id="cp-dal" type="date" className={inputCls} value={dal} onChange={(e) => setDal(e.target.value)} disabled={!ass} /></div>
          <div><label className={labelCls} htmlFor="cp-al">Scadenza</label><input id="cp-al" type="date" className={inputCls} value={al} onChange={(e) => setAl(e.target.value)} disabled={!ass || contratto === 'indeterminato'} /></div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex gap-2 text-sm text-slate-700">
          <Info size={15} className="shrink-0 mt-0.5 text-slate-400" />
          {ass ? (
            <span>
              Questa persona è stata aggiunta in azienda e aspetta i documenti dello studio: la correzione vale per la scheda e per l'assunzione, quindi anche per turni e ferie.
              Serve a correggere un errore di inserimento. Un cambiamento vero, che vale da una certa data (un orario nuovo, un altro negozio), si segna con «Segna».
            </span>
          ) : (
            <span>
              Negozio, contratto, ore e date vengono dai documenti dello studio paghe e qui non si correggono: se sono cambiati si segna il cambiamento con «Segna».
              Nome, cognome e livello si correggono subito.
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500">Ogni correzione lascia una nota datata nella scheda, con chi l'ha fatta e cosa è cambiato.</p>
        {onAltriDati && !ass && (
          <button type="button" onClick={onAltriDati} className="text-sm font-medium text-blue-700 hover:underline">
            Tutti i dati dell'anagrafica (codice fiscale, qualifica, tempo determinato…)
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
        {errore && <span className="text-sm text-amber-700 mr-auto">{errore}</span>}
        <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button type="button" onClick={salva} disabled={!!errore || salvo}
          className="min-h-[40px] px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
          {salvo ? 'Salvo…' : 'Salva'}
        </button>
      </div>
    </Modal>
  );
}
