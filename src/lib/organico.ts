// Organico di oggi: chi lavora davvero in azienda a una data.
//
// L'anagrafica dei dipendenti e' la fotografia dell'ultimo documento dello
// studio paghe. Fra un documento e l'altro chi tiene l'organico segna i
// cambiamenti (employee_events): una maternita', un contratto non
// rinnovato, un orario diverso. Qui si mettono insieme: scheda dello studio
// piu' cambiamenti fino alla data, e ne esce lo stato di ogni persona.
//
// La scheda non si tocca mai: il dato dello studio resta il dato vero, i
// cambiamenti lo completano finche' lo studio non li riporta.
//
// Funzioni pure, nessuna query. Test in organico.test.ts.
//
// Da non confondere con l'organico «granitico» di headcount.ts: quello
// conta chi ha un cedolino in un mese (costi, storia); questo dice chi c'e'
// oggi (turni, ferie, decisioni).

export type TipoEvento =
  | 'assenza_lunga' | 'rientro' | 'non_rinnovo' | 'proroga' | 'cessazione'
  | 'cambio_orario' | 'cambio_negozio' | 'trasformazione_indeterminato'
  | 'assunzione' | 'altro';

export type StatoEvento = 'da_confermare' | 'confermato' | 'annullato';

export interface EventoOrganico {
  id: string;
  employee_id: string;
  tipo: TipoEvento;
  motivo?: string | null;
  /** Da quando vale. Per cessazione e non rinnovo e' l'ultimo giorno di lavoro. */
  data_dal: string;
  /** Rientro previsto (assenza lunga) o nuova scadenza (proroga, assunzione). */
  data_al?: string | null;
  ore_settimanali?: number | null;
  outlet_id?: string | null;
  contratto_tipo?: string | null;
  nota?: string | null;
  stato: StatoEvento;
  esito_nota?: string | null;
  created_at?: string | null;
  created_by_nome?: string | null;
  documento_path?: string | null;
  documento_nome?: string | null;
}

export interface SchedaPersona {
  id: string;
  nome: string | null;
  cognome: string | null;
  matricola?: string | null;
  outlet_id: string | null;
  contratto_tipo: string | null;
  ore_settimanali: number | null;
  ore_settimanali_paghe?: number | null;
  data_assunzione: string | null;
  scadenza_td: string | null;
  data_cessazione: string | null;
  is_active: boolean | null;
  livello?: string | null;
  qualifica?: string | null;
  role_description?: string | null;
}

export type StatoOggi =
  | 'in_servizio'
  | 'assente'
  | 'scaduto'
  | 'cessato'
  | 'non_ancora_assunto'
  | 'fuori_organico';

export interface PersonaOggi {
  scheda: SchedaPersona;
  stato: StatoOggi;
  /** Ore settimanali a quella data (null = a chiamata o non note). */
  ore: number | null;
  outletId: string | null;
  contratto: string | null;
  /** Scadenza del tempo determinato a quella data, se c'e'. */
  scadenza: string | null;
  /** Giorni alla scadenza del determinato (0 = scade oggi). */
  giorniAllaScadenza: number | null;
  /** Ultimo giorno di lavoro, se la persona e' uscita o uscira'. */
  ultimoGiorno: string | null;
  assenza: { motivo: string | null; dal: string; rientro: string | null } | null;
  /** Cambiamenti segnati dopo la data: si vedono come «dal …». */
  prossimi: EventoOrganico[];
  /** Cambiamenti non ancora riportati dallo studio. */
  daConfermare: EventoOrganico[];
}

export const ETICHETTE_TIPO_EVENTO: Record<TipoEvento, string> = {
  assenza_lunga: 'Assenza lunga',
  rientro: 'Rientro',
  non_rinnovo: 'Non rinnovato',
  proroga: 'Proroga o rinnovo',
  cessazione: 'Licenziamento o dimissioni',
  cambio_orario: "Cambio d'orario",
  cambio_negozio: 'Cambio di negozio',
  trasformazione_indeterminato: 'Passaggio a indeterminato',
  assunzione: 'Assunzione',
  altro: 'Altro',
};

export const DESCRIZIONE_TIPO_EVENTO: Record<TipoEvento, string> = {
  assenza_lunga: 'maternità, malattia lunga, aspettativa',
  rientro: 'torna dopo un’assenza lunga',
  non_rinnovo: 'il contratto finisce alla scadenza',
  proroga: 'nuova scadenza del determinato',
  cessazione: 'il rapporto si chiude prima',
  cambio_orario: 'nuove ore settimanali',
  cambio_negozio: 'lavora in un altro negozio',
  trasformazione_indeterminato: 'trasformazione del contratto',
  assunzione: 'una persona nuova',
  altro: 'con una nota',
};

export const ETICHETTE_STATO_OGGI: Record<StatoOggi, string> = {
  in_servizio: 'In servizio',
  assente: 'Assente',
  scaduto: 'Contratto scaduto',
  cessato: 'Non più in forza',
  non_ancora_assunto: 'Non ancora assunto',
  fuori_organico: 'Fuori organico',
};

const MS_GIORNO = 86_400_000;

/** Giorni da a a b (date ISO), b - a. */
export function giorniTra(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_GIORNO);
}

/** Data ISO di oggi nel fuso di Roma. */
export function oggiRoma(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
}

export function aggiungiGiorni(data: string, n: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function eAmministratore(s: Pick<SchedaPersona, 'contratto_tipo' | 'qualifica' | 'role_description'>): boolean {
  return s.contratto_tipo === 'amministratore'
    || /amministrat/i.test(s.qualifica ?? '')
    || /amministrat/i.test(s.role_description ?? '');
}

export const eAChiamataContratto = (c: string | null | undefined): boolean =>
  !!c && /chiamata|intermittent/i.test(c);

/** Ore settimanali della scheda: quelle dell'anagrafica, poi quelle lette dalle paghe. */
export function oreDellaScheda(s: SchedaPersona): number | null {
  if (eAChiamataContratto(s.contratto_tipo)) return null;
  const o = s.ore_settimanali ?? s.ore_settimanali_paghe ?? null;
  return o != null && Number.isFinite(Number(o)) ? Number(o) : null;
}

/**
 * Stato di una persona a una data, dalla sua scheda e dai suoi cambiamenti.
 * I cambiamenti annullati non contano; quelli confermati e da confermare sì.
 */
export function personaAllaData(scheda: SchedaPersona, eventiTutti: EventoOrganico[], data: string): PersonaOggi {
  const eventi = eventiTutti
    .filter((e) => e.employee_id === scheda.id && e.stato !== 'annullato')
    .sort((a, b) => a.data_dal.localeCompare(b.data_dal) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));

  let ore = oreDellaScheda(scheda);
  let outletId = scheda.outlet_id;
  let contratto = scheda.contratto_tipo;
  let scadenza = contratto === 'indeterminato' ? null : scheda.scadenza_td;
  let inizio = scheda.data_assunzione;
  let ultimoGiorno = scheda.data_cessazione;
  let assenza: PersonaOggi['assenza'] = null;
  let assuntoDaEvento = false;

  for (const e of eventi) {
    const valeOggi = e.data_dal <= data;
    switch (e.tipo) {
      case 'proroga':
        // Una proroga si conosce prima che cominci: la nuova scadenza vale subito.
        if (e.data_al) scadenza = e.data_al;
        if (e.data_al && ultimoGiorno && ultimoGiorno < e.data_al) ultimoGiorno = null;
        // Il rinnovo puo' cambiare l'orario (piu' o meno ore): vale dal primo giorno del rinnovo.
        if (valeOggi && e.ore_settimanali != null) ore = Number(e.ore_settimanali);
        break;
      case 'cessazione':
      case 'non_rinnovo':
        // Anche un'uscita futura si sa gia': si mostra come ultimo giorno.
        ultimoGiorno = e.data_dal;
        break;
      case 'assunzione':
        assuntoDaEvento = true;
        inizio = e.data_dal;
        if (e.ore_settimanali != null) ore = Number(e.ore_settimanali);
        if (e.outlet_id) outletId = e.outlet_id;
        if (e.contratto_tipo) contratto = e.contratto_tipo;
        if (e.data_al) scadenza = e.data_al;
        break;
      case 'cambio_orario':
        if (valeOggi && e.ore_settimanali != null) ore = Number(e.ore_settimanali);
        break;
      case 'cambio_negozio':
        if (valeOggi && e.outlet_id) outletId = e.outlet_id;
        break;
      case 'trasformazione_indeterminato':
        if (valeOggi) {
          contratto = 'indeterminato';
          scadenza = null;
          // Anche il passaggio a indeterminato puo' portare un orario diverso.
          if (e.ore_settimanali != null) ore = Number(e.ore_settimanali);
        }
        break;
      case 'assenza_lunga':
        if (valeOggi && (!e.data_al || data < e.data_al)) {
          assenza = { motivo: e.motivo ?? null, dal: e.data_dal, rientro: e.data_al ?? null };
        } else if (valeOggi && e.data_al && data >= e.data_al) {
          assenza = null;
        }
        break;
      case 'rientro':
        if (valeOggi) assenza = null;
        break;
      default:
        break;
    }
  }
  if (eAChiamataContratto(contratto)) ore = null;

  const prossimi = eventi.filter((e) => e.data_dal > data && e.tipo !== 'proroga');
  const daConfermare = eventi.filter((e) => e.stato === 'da_confermare');

  let stato: StatoOggi;
  if (eAmministratore({ ...scheda, contratto_tipo: contratto })) stato = 'fuori_organico';
  else if (inizio && inizio > data) stato = 'non_ancora_assunto';
  else if (ultimoGiorno && ultimoGiorno < data) stato = 'cessato';
  else if (scheda.is_active === false && !ultimoGiorno && !assuntoDaEvento) stato = 'cessato';
  else if (contratto !== 'indeterminato' && scadenza && scadenza < data) stato = 'scaduto';
  else if (assenza) stato = 'assente';
  else stato = 'in_servizio';

  const giorniAllaScadenza = contratto !== 'indeterminato' && scadenza && scadenza >= data
    ? giorniTra(data, scadenza)
    : null;

  return {
    scheda,
    stato,
    ore,
    outletId,
    contratto,
    scadenza,
    giorniAllaScadenza,
    ultimoGiorno,
    assenza: stato === 'assente' ? assenza : null,
    prossimi,
    daConfermare,
  };
}

/** Tutto l'organico a una data. L'amministratore resta fuori (non e' un addetto). */
export function organicoAllaData(schede: SchedaPersona[], eventi: EventoOrganico[], data: string): PersonaOggi[] {
  return schede
    .map((s) => personaAllaData(s, eventi, data))
    .filter((p) => p.stato !== 'fuori_organico');
}

/** Chi conta nell'organico di oggi: in servizio, assente o col contratto scaduto da decidere. */
export const contaNellOrganico = (p: PersonaOggi): boolean =>
  p.stato === 'in_servizio' || p.stato === 'assente' || p.stato === 'scaduto';

/** Chi puo' lavorare quel giorno: in servizio, con orario noto. */
export const disponibilePerTurni = (p: PersonaOggi): boolean => p.stato === 'in_servizio';

export interface DaDecidere {
  persona: PersonaOggi;
  motivo: 'scaduto' | 'in_scadenza';
  testo: string;
}

/** Le decisioni da prendere: contratti scaduti senza proroga e quelli in scadenza entro N giorni. */
export function decisioniDaPrendere(persone: PersonaOggi[], entroGiorni = 30): DaDecidere[] {
  const out: DaDecidere[] = [];
  for (const p of persone) {
    if (p.stato === 'scaduto' && p.scadenza) {
      out.push({ persona: p, motivo: 'scaduto', testo: `contratto scaduto il ${formattaDataBreve(p.scadenza)}: prorogato o no?` });
    } else if (p.stato !== 'cessato' && p.giorniAllaScadenza != null && p.giorniAllaScadenza <= entroGiorni
      && !p.ultimoGiorno && p.scadenza) {
      out.push({ persona: p, motivo: 'in_scadenza', testo: `scade il ${formattaDataBreve(p.scadenza)}` });
    }
  }
  return out.sort((a, b) => (a.persona.scadenza ?? '').localeCompare(b.persona.scadenza ?? ''));
}

export function formattaDataBreve(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function nomePersona(s: Pick<SchedaPersona, 'nome' | 'cognome'>): string {
  const cap = (x: string | null) => (x ?? '').toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  return [cap(s.cognome), cap(s.nome)].filter(Boolean).join(' ') || 'Senza nome';
}

/** Descrizione breve di un cambiamento, per elenchi e confronti. */
export function descriviEvento(e: EventoOrganico, nomeNegozio?: (id: string) => string): string {
  const dal = formattaDataBreve(e.data_dal);
  const al = e.data_al ? formattaDataBreve(e.data_al) : '';
  switch (e.tipo) {
    case 'assenza_lunga':
      return `${e.motivo ? capitalizza(e.motivo) : 'Assenza lunga'} dal ${dal}${al ? `, rientro previsto ${al}` : ''}`;
    case 'rientro': return `Rientro dal ${dal}`;
    case 'non_rinnovo': return `Non rinnovato: ultimo giorno ${dal}`;
    case 'cessazione': return `${e.motivo ? capitalizza(e.motivo) : 'Uscita'}: ultimo giorno ${dal}`;
    case 'proroga': return `Proroga fino al ${al || '?'}${e.ore_settimanali ? `, ${e.ore_settimanali} ore dal ${dal}` : ''}`;
    case 'cambio_orario': return `${e.ore_settimanali ?? '?'} ore dal ${dal}`;
    case 'cambio_negozio': return `Passa a ${e.outlet_id && nomeNegozio ? nomeNegozio(e.outlet_id) : 'un altro negozio'} dal ${dal}`;
    case 'trasformazione_indeterminato': return `Indeterminato dal ${dal}${e.ore_settimanali ? `, ${e.ore_settimanali} ore` : ''}`;
    case 'assunzione': return `Assunta dal ${dal}${e.ore_settimanali ? `, ${e.ore_settimanali} ore` : ''}${al ? `, scadenza ${al}` : ''}`;
    default: return `${e.nota ?? 'Cambiamento'} dal ${dal}`;
  }
}

const capitalizza = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ── Confronto con lo studio paghe ───────────────────────────────────────

export type EsitoConfronto = 'uguale' | 'diverso' | 'non_riportato' | 'non_verificabile';

export interface ConfrontoEvento {
  esito: EsitoConfronto;
  /** Cosa dice lo studio (anagrafica o cedolini), in parole. */
  studio: string;
}

/**
 * Un cambiamento segnato in azienda contro quello che dice oggi la scheda
 * (scritta dai documenti dello studio). Assenze lunghe e rientri non
 * compaiono in nessun documento letto dal gestionale: non verificabili.
 */
export function confrontoEvento(
  e: EventoOrganico,
  scheda: SchedaPersona,
  haCedolinoDalMese: boolean,
  nomeNegozio: (id: string) => string = (id) => id,
): ConfrontoEvento {
  switch (e.tipo) {
    case 'cambio_orario': {
      const o = scheda.ore_settimanali;
      if (o == null) return { esito: 'non_riportato', studio: 'orario non indicato' };
      return { esito: Number(o) === Number(e.ore_settimanali) ? 'uguale' : 'diverso', studio: `${o} ore` };
    }
    case 'proroga': {
      if (!scheda.scadenza_td) return { esito: 'non_riportato', studio: 'nessuna scadenza' };
      const oreStudio = scheda.ore_settimanali != null ? `, ${scheda.ore_settimanali} ore` : '';
      const studio = `scadenza ${formattaDataBreve(scheda.scadenza_td)}${e.ore_settimanali != null ? oreStudio : ''}`;
      const stessaScadenza = scheda.scadenza_td === e.data_al;
      const stesseOre = e.ore_settimanali == null || Number(scheda.ore_settimanali) === Number(e.ore_settimanali);
      return { esito: stessaScadenza && stesseOre ? 'uguale' : 'diverso', studio };
    }
    case 'cessazione':
    case 'non_rinnovo':
      if (!scheda.data_cessazione) return { esito: 'non_riportato', studio: 'ancora in forza' };
      return { esito: scheda.data_cessazione === e.data_dal ? 'uguale' : 'diverso', studio: `cessazione ${formattaDataBreve(scheda.data_cessazione)}` };
    case 'trasformazione_indeterminato': {
      if (scheda.contratto_tipo !== 'indeterminato') return { esito: 'non_riportato', studio: scheda.contratto_tipo ?? 'contratto non indicato' };
      const stesseOre = e.ore_settimanali == null || Number(scheda.ore_settimanali) === Number(e.ore_settimanali);
      return { esito: stesseOre ? 'uguale' : 'diverso', studio: `indeterminato${scheda.ore_settimanali != null ? `, ${scheda.ore_settimanali} ore` : ''}` };
    }
    case 'cambio_negozio':
      if (!scheda.outlet_id) return { esito: 'non_riportato', studio: 'negozio non indicato' };
      return { esito: scheda.outlet_id === e.outlet_id ? 'uguale' : 'non_riportato', studio: nomeNegozio(scheda.outlet_id) };
    case 'assunzione':
      return haCedolinoDalMese
        ? { esito: 'uguale', studio: 'cedolino elaborato' }
        : { esito: 'non_riportato', studio: 'nessun cedolino ancora' };
    default:
      return { esito: 'non_verificabile', studio: 'non compare nei documenti dello studio' };
  }
}

export interface AnomaliaCedolini {
  persona: PersonaOggi;
  tipo: 'pagata_fuori_organico' | 'in_organico_senza_cedolino';
  testo: string;
}

/**
 * Il mese dei cedolini contro l'organico a fine mese: chi e' stato pagato
 * ma per noi non c'e', e chi per noi c'e' ma non ha la busta. Chi entra o
 * esce durante il mese non conta: e' normale che abbia o non abbia la busta.
 */
export function confrontaConCedolini(
  schede: SchedaPersona[],
  eventi: EventoOrganico[],
  pagatiNelMese: Set<string>,
  anno: number,
  mese: number,
): AnomaliaCedolini[] {
  const primo = `${anno}-${String(mese).padStart(2, '0')}-01`;
  const ultimo = new Date(Date.UTC(anno, mese, 0)).toISOString().slice(0, 10);
  const etichetta = `${String(mese).padStart(2, '0')}/${anno}`;
  const out: AnomaliaCedolini[] = [];
  for (const s of schede) {
    const fine = personaAllaData(s, eventi, ultimo);
    if (fine.stato === 'fuori_organico') continue;
    const inizio = personaAllaData(s, eventi, primo);
    const pagata = pagatiNelMese.has(s.id);
    const dentroTuttoIlMese = contaNellOrganico(fine) && contaNellOrganico(inizio);
    const fuoriTuttoIlMese = !contaNellOrganico(fine) && !contaNellOrganico(inizio)
      && !(fine.ultimoGiorno && fine.ultimoGiorno >= primo);
    if (pagata && fuoriTuttoIlMese) {
      out.push({ persona: fine, tipo: 'pagata_fuori_organico', testo: `ha il cedolino di ${etichetta} ma non è nell'organico` });
    } else if (!pagata && dentroTuttoIlMese && fine.stato !== 'assente' && inizio.stato !== 'assente') {
      out.push({ persona: fine, tipo: 'in_organico_senza_cedolino', testo: `è nell'organico ma non ha il cedolino di ${etichetta}` });
    }
  }
  return out;
}
