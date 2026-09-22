// Il modulo di richiesta ferie, in PDF e in Excel.
//
// Serve adesso perche' i dipendenti non hanno ancora un accesso al
// gestionale: il modulo si stampa o si allega a una mail, la persona lo
// compila, l'amministrazione ricopia i giorni qui dentro. Quando gli
// accessi ci saranno, questi stessi file restano utili come ricevuta di
// quello che e' stato chiesto e approvato.
//
// Il modulo esce in due modi, a seconda di cosa ha in mano chi lo genera:
//   - CON i giorni gia' scelti: e' la ricevuta della richiesta;
//   - SENZA giorni: e' il foglio da compilare, con i saldi gia' stampati
//     sopra, cosi' la persona sa quante ore ha prima di chiedere.
//
// QUESTO FOGLIO LO LEGGE IL DIPENDENTE. Quindi niente linguaggio interno:
// non si nomina il tabulato delle paghe, non si dice che un dato e' dedotto
// o da confermare, non si parla di "gestionale". La persona ha diritto di
// sapere quante ore ha e a che data sono aggiornate; da dove arriva il
// numero e come lo teniamo e' affare nostro e resta a video, nella pagina
// che usa l'amministrazione. Il test ferieExport.test.ts controlla che
// nessuna parola interna finisca in un modulo.
//
// xlsx e jspdf si caricano al click, non all'avvio: pesano, e questa
// pagina si apre anche solo per guardare i saldi.

import {
  ETICHETTE_VOCE, ETICHETTE_TIPO, ETICHETTE_VOCE_BREVI,
  formattaOre, formattaData, formattaDataLunga, giornateDaOre, totaliPerVoce,
  intervalli, type GiornoRichiesto, type DisponibilitaVoce, type VoceFerie,
} from './ferieRichiesta';

export type DipendenteModulo = {
  nominativo: string;
  matricola: string | null;
  outlet: string | null;
  oreSettimanali: number | null;
  oreGiornata: number;
  fonteOrario: 'paghe' | 'anagrafica' | 'ripiego';
};

export type ModuloFerie = {
  azienda: string;
  dipendente: DipendenteModulo;
  saldi: DisponibilitaVoce[];
  giorni: GiornoRichiesto[];
  titolo?: string | null;
  note?: string | null;
  stato?: string | null;
  /** Righe bianche nel modulo da compilare a mano. */
  righeVuote?: number;
};

const VOCI_ORDINE: VoceFerie[] = ['F01', 'F02', 'F03'];
const RIGHE_VUOTE_DEFAULT = 12;

const oggi = () => new Date().toLocaleDateString('it-IT');

/**
 * L'orario, detto al diretto interessato: il suo contratto e quanto vale
 * per lui una giornata. Da dove il numero arriva non lo riguarda, e quando
 * non lo sappiamo non se ne inventa uno: si lascia da indicare.
 */
export const notaOrario = (d: DipendenteModulo): string =>
  d.fonteOrario === 'ripiego'
    ? 'Orario settimanale da indicare'
    : `${d.oreSettimanali ?? '—'} ore a settimana · una giornata vale ${formattaOre(d.oreGiornata)}`;

/**
 * A che data sono aggiornate le ore. La data c'e' sempre quando c'e' un
 * saldo, ed e' l'unica cosa che serve sapere a chi compila: il numero e'
 * gia' al netto di quello che ha chiesto e non e' ancora stato conteggiato.
 */
export function notaSaldi(m: ModuloFerie): string {
  const d = m.saldi.find((s) => s.saldo_alla_data)?.saldo_alla_data ?? null;
  if (!d) return 'Ore disponibili non indicate: chiedile all\'amministrazione prima di compilare.';
  return `Ore disponibili aggiornate al ${formattaData(d)}, al netto delle richieste già presentate.`;
}

export function nomeFileModulo(m: ModuloFerie | ModuloFerie[], estensione: 'pdf' | 'xlsx'): string {
  const data = new Date().toISOString().slice(0, 10);
  if (Array.isArray(m)) return `Richieste_ferie_${data}.${estensione}`;
  const nome = m.dipendente.nominativo.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
  return `Richiesta_ferie_${nome}_${data}.${estensione}`;
}

/** Righe della tabella dei saldi, uguali in PDF e in Excel. */
export function righeSaldi(m: ModuloFerie): string[][] {
  const chiesto = totaliPerVoce(m.giorni);
  return VOCI_ORDINE.map((voce) => {
    const s = m.saldi.find((x) => x.voce === voce);
    const disponibileOggi = s?.residuo_disponibile ?? s?.residuo ?? null;
    const fineAnno = s?.da_fruire_disponibile ?? s?.da_fruire ?? null;
    return [
      ETICHETTE_VOCE[voce],
      formattaOre(disponibileOggi),
      disponibileOggi != null ? giornateDaOre(disponibileOggi, m.dipendente.oreGiornata).toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—',
      formattaOre(fineAnno),
      s?.ore_in_attesa ? formattaOre(s.ore_in_attesa) : '—',
      chiesto[voce] ? formattaOre(chiesto[voce]) : '—',
    ];
  });
}

const INTESTAZIONE_SALDI = [
  'Voce', 'Disponibili oggi', 'in giornate', 'Entro fine anno', 'Già in attesa', 'In questa richiesta',
];

const INTESTAZIONE_GIORNI = ['Data', 'Tipo', 'Voce', 'Ore', 'Nota'];

export function righeGiorni(m: ModuloFerie): string[][] {
  if (!m.giorni.length) {
    const n = m.righeVuote ?? RIGHE_VUOTE_DEFAULT;
    return Array.from({ length: n }, () => ['', '', '', '', '']);
  }
  return [...m.giorni]
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((g) => [
      formattaDataLunga(g.data),
      ETICHETTE_TIPO[g.tipo],
      ETICHETTE_VOCE_BREVI[g.voce],
      formattaOre(g.ore),
      g.nota ?? '',
    ]);
}

/** Una riga di riepilogo per periodo continuo: «dal 3 al 9, ferie, 5 giorni». */
export function righeRiepilogo(m: ModuloFerie): string[][] {
  return intervalli(m.giorni).map((i) => [
    i.dal === i.al ? formattaData(i.dal) : `dal ${formattaData(i.dal)} al ${formattaData(i.al)}`,
    ETICHETTE_VOCE_BREVI[i.voce],
    ETICHETTE_TIPO[i.tipo],
    String(i.giorni),
    formattaOre(i.ore),
  ]);
}

// ─────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────

export async function esportaModuloPdf(moduli: ModuloFerie | ModuloFerie[]): Promise<void> {
  const elenco = Array.isArray(moduli) ? moduli : [moduli];
  if (!elenco.length) return;

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const SCURO: [number, number, number] = [15, 23, 42];
  const GRIGIO: [number, number, number] = [100, 116, 139];
  const finalY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;

  elenco.forEach((m, idx) => {
    if (idx > 0) doc.addPage();
    const vuoto = m.giorni.length === 0;

    doc.setFontSize(14);
    doc.setTextColor(...SCURO);
    doc.text(vuoto ? 'Richiesta di ferie e permessi' : 'Richiesta di ferie e permessi — riepilogo', 40, 48);

    doc.setFontSize(9);
    doc.setTextColor(...GRIGIO);
    doc.text(`${m.azienda} · stampato il ${oggi()}`, 40, 64);

    autoTable(doc, {
      startY: 80,
      body: [
        ['Dipendente', m.dipendente.nominativo],
        ['Matricola', m.dipendente.matricola ?? '—'],
        ['Punto vendita', m.dipendente.outlet ?? '—'],
        ['Orario', notaOrario(m.dipendente)],
        ...(m.titolo ? [['Richiesta', m.titolo]] : []),
        ...(m.stato ? [['Stato', m.stato]] : []),
      ],
      theme: 'plain',
      styles: { fontSize: 9, cellPadding: 2.5, textColor: SCURO },
      columnStyles: { 0: { cellWidth: 110, fontStyle: 'bold', textColor: GRIGIO }, 1: { cellWidth: 405 } },
      margin: { left: 40, right: 40 },
    });

    autoTable(doc, {
      startY: finalY() + 16,
      head: [INTESTAZIONE_SALDI],
      body: righeSaldi(m),
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, textColor: SCURO },
      headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 135 }, 1: { cellWidth: 78, halign: 'right' }, 2: { cellWidth: 60, halign: 'right' },
        3: { cellWidth: 78, halign: 'right' }, 4: { cellWidth: 78, halign: 'right' }, 5: { cellWidth: 86, halign: 'right' },
      },
      margin: { left: 40, right: 40 },
    });

    doc.setFontSize(7.5);
    doc.setTextColor(...GRIGIO);
    doc.text(notaSaldi(m), 40, finalY() + 14, { maxWidth: 515 });

    autoTable(doc, {
      startY: finalY() + 26,
      head: [INTESTAZIONE_GIORNI],
      body: righeGiorni(m),
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: vuoto ? 6 : 3.5, textColor: SCURO, minCellHeight: vuoto ? 18 : 0 },
      headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 120 }, 1: { cellWidth: 100 }, 2: { cellWidth: 80 },
        3: { cellWidth: 65, halign: 'right' }, 4: { cellWidth: 150 },
      },
      margin: { left: 40, right: 40 },
    });

    if (vuoto) {
      doc.setFontSize(7.5);
      doc.setTextColor(...GRIGIO);
      doc.text(
        'Tipo: giornata intera, mezza giornata oppure il numero di ore. Voce: ferie, ex festività o ROL. '
        + 'Le ore non serve calcolarle: bastano la data e il tipo.',
        40, finalY() + 14, { maxWidth: 515 },
      );
    } else {
      const riepilogo = righeRiepilogo(m);
      if (riepilogo.length) {
        autoTable(doc, {
          startY: finalY() + 16,
          head: [['Periodo', 'Voce', 'Tipo', 'Giorni', 'Ore']],
          body: riepilogo,
          theme: 'grid',
          styles: { fontSize: 8.5, cellPadding: 3.5, textColor: SCURO },
          headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
          columnStyles: {
            0: { cellWidth: 175 }, 1: { cellWidth: 90 }, 2: { cellWidth: 110 },
            3: { cellWidth: 60, halign: 'right' }, 4: { cellWidth: 80, halign: 'right' },
          },
          margin: { left: 40, right: 40 },
        });
      }
    }

    if (m.note) {
      doc.setFontSize(8.5);
      doc.setTextColor(...SCURO);
      doc.text(`Note: ${m.note}`, 40, finalY() + 20, { maxWidth: 515 });
    }

    const yFirme = Math.min(finalY() + (m.note ? 46 : 36), 760);
    doc.setFontSize(9);
    doc.setTextColor(...GRIGIO);
    doc.text('Firma del dipendente', 40, yFirme);
    doc.text('Firma del responsabile', 310, yFirme);
    doc.setDrawColor(203, 213, 225);
    doc.line(40, yFirme + 26, 270, yFirme + 26);
    doc.line(310, yFirme + 26, 540, yFirme + 26);
  });

  doc.save(nomeFileModulo(Array.isArray(moduli) ? moduli : moduli, 'pdf'));
}

// ─────────────────────────────────────────────────────────────────────
// Excel
// ─────────────────────────────────────────────────────────────────────

export async function esportaModuloExcel(moduli: ModuloFerie | ModuloFerie[]): Promise<void> {
  const elenco = Array.isArray(moduli) ? moduli : [moduli];
  if (!elenco.length) return;

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const usati = new Set<string>();

  for (const m of elenco) {
    const vuoto = m.giorni.length === 0;
    const aoa: (string | number)[][] = [
      ['Richiesta di ferie e permessi'],
      [m.azienda, '', '', `stampato il ${oggi()}`],
      [],
      ['Dipendente', m.dipendente.nominativo],
      ['Matricola', m.dipendente.matricola ?? '—'],
      ['Punto vendita', m.dipendente.outlet ?? '—'],
      ['Orario', notaOrario(m.dipendente)],
      ...(m.titolo ? [['Richiesta', m.titolo]] : []),
      ...(m.stato ? [['Stato', m.stato]] : []),
      [],
      INTESTAZIONE_SALDI,
      ...righeSaldi(m),
      [notaSaldi(m)],
      [],
      INTESTAZIONE_GIORNI,
      ...righeGiorni(m),
    ];

    if (!vuoto) {
      const riepilogo = righeRiepilogo(m);
      if (riepilogo.length) {
        aoa.push([], ['Periodo', 'Voce', 'Tipo', 'Giorni', 'Ore'], ...riepilogo);
      }
    } else {
      aoa.push([], ['Tipo: giornata intera, mezza giornata oppure il numero di ore. Voce: ferie, ex festività o ROL.'],
                   ['Le ore non serve calcolarle: bastano la data e il tipo.']);
    }

    if (m.note) aoa.push([], ['Note', m.note]);
    aoa.push([], ['Firma del dipendente', '', 'Firma del responsabile']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 26 }, { wch: 22 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, nomeFoglio(m.dipendente.nominativo, usati));
  }

  XLSX.writeFile(wb, nomeFileModulo(Array.isArray(moduli) ? moduli : moduli, 'xlsx'));
}

/** Excel non accetta nomi oltre 31 caratteri, né due fogli con lo stesso nome. */
export function nomeFoglio(nominativo: string, usati: Set<string>): string {
  const base = (nominativo.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Dipendente').slice(0, 28);
  let nome = base;
  let n = 2;
  while (usati.has(nome.toLowerCase())) {
    nome = `${base.slice(0, 26)} ${n}`;
    n += 1;
  }
  usati.add(nome.toLowerCase());
  return nome;
}
