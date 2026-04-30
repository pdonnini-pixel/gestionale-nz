import React, { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

const PAGE_HELP: Record<string, string> = {
  dashboard: "Questa è la tua panoramica finanziaria. I numeri vengono dal bilancio importato e dai movimenti bancari. Gli alert in rosso richiedono la tua attenzione: fatture scadute, liquidità negativa, scadenze imminenti.",
  tesoreria: "Qui vedi tutti i tuoi conti bancari e la liquidità. Il saldo viene dall'estratto conto importato (CSV/Excel dalla banca). Per collegare la banca automaticamente via PSD2, clicca 'Collega banca'. La riconciliazione confronta movimenti bancari con fatture.",
  cashflow: "Mostra quanto denaro entrerà e uscirà nei prossimi mesi. Le uscite previste vengono dalle fatture da pagare. Se il saldo diventa negativo (alert rosso), potresti non avere abbastanza liquidità per le spese.",
  'conto-economico': "Il conto economico mostra se l'azienda guadagna o perde. Dati dal bilancio importato (PDF/Excel dal commercialista). Ricavi - Costi = Utile. Il confronto anno su anno mostra se stai migliorando.",
  outlet: "La scheda di ogni punto vendita. Il fatturato viene dai dati POS/corrispettivi. Se è zero, importa i dati POS dall'Import Hub.",
  budget: "Il business plan per outlet. Ricavi (verde) dal bilancio importato. Costi previsti (blu) li inserisci tu: affitto, personale, utenze. Il risultato dice quanto guadagna ogni outlet.",
  fornitori: "Elenco fornitori con fatture ricevute. Dati dalle fatture elettroniche SDI (XML). Vedi spesa per fornitore, debito residuo, stato pagamenti.",
  fatturazione: "Fatture passive dallo SDI (XML). Fatture attive le crei tu. Corrispettivi dai dati POS. Per importare: Import Hub → Fatture Elettroniche → carica XML.",
  scadenzario: "Calendario pagamenti. Rosso = scaduto. Giallo = in scadenza. Verde = pagato. Blu = futuro. Filtra per tipo pagamento e verifica ogni scadenza.",
  dipendenti: "Costi del personale dal bilancio importato. Per il dettaglio per persona, importa i cedolini dall'Import Hub.",
  'categorizzazione-ai': "L'AI analizza i movimenti bancari e suggerisce categorie. Conferma se corretti, Correggi per cambiare. Più confermi, più il sistema impara.",
  'import-hub': "Centro importazione dati. Carica: estratti conto (CSV/Excel), fatture (XML SDI), bilanci (PDF/Excel), cedolini (PDF), dati POS (CSV), corrispettivi (CSV/XML AdE). Ogni file alimenta automaticamente le altre pagine.",
  'margini-outlet': "Confronta i margini di ogni outlet: heatmap mensile, alert per margini critici (<5%), e dettaglio ricavi/costi per ogni punto vendita. Clicca su un outlet nella tabella per espandere il breakdown per conto.",
  'produttivita': "Analisi della produttività del personale per outlet. KPI principali: fatturato medio per dipendente, ranking outlet, trend mensile. Puoi simulare spostamenti di personale tra outlet.",
  'scenario-planning': "Simula scenari what-if: varia ricavi e costi personale con i cursori, attiva l'ipotesi nuovo outlet con costi stimati. Vedi in tempo reale l'impatto su margine, cash e break-even.",
};

interface PageHelpProps {
  page: string
}

export default function PageHelp({ page }: PageHelpProps) {
  const [open, setOpen] = useState(false);
  const text = PAGE_HELP[page];
  if (!text) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg hover:bg-blue-700 transition"
        title="Aiuto"
      >
        <HelpCircle size={24} />
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 z-10">
            <button onClick={() => setOpen(false)} className="absolute top-4 right-4 text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-blue-100 p-2 rounded-lg"><HelpCircle size={20} className="text-blue-600" /></div>
              <h3 className="text-lg font-bold text-slate-900">Come funziona questa pagina</h3>
            </div>
            <p className="text-slate-600 leading-relaxed">{text}</p>
          </div>
        </div>
      )}
    </>
  );
}
