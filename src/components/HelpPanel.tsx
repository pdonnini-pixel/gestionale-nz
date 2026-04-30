import React, { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import {
  HelpCircle, X, ChevronRight, ExternalLink,
  LayoutDashboard, Store, Receipt, Landmark, Users, FileText,
  Calculator, BarChart3, GitCompare, Wallet, Building2,
  CalendarClock, DatabaseZap, Archive, FileCode, Settings,
  LucideIcon
} from 'lucide-react'

interface FaqItem {
  q: string
  a: string
}

interface HelpContent {
  title: string
  icon: LucideIcon
  description: string
  tips: string[]
  faq: FaqItem[]
}

// Guida contestuale per ogni pagina
const HELP_CONTENT: Record<string, HelpContent> = {
  '/': {
    title: 'Dashboard',
    icon: LayoutDashboard,
    description: 'Panoramica finanziaria della tua azienda. Qui trovi i KPI principali, il trend dei ricavi e le informazioni sulle AI insights.',
    tips: [
      'I KPI in alto mostrano fatturato, costi, margine e liquidità del periodo selezionato.',
      'La sezione "AI Insights" mostra lo stato della categorizzazione automatica dei movimenti bancari.',
      'Clicca su qualsiasi card per accedere alla sezione di dettaglio.',
    ],
    faq: [
      { q: 'Come cambio il periodo visualizzato?', a: 'Usa il selettore di periodo in alto a destra per scegliere mese, trimestre o anno.' },
      { q: 'Cosa significa "Da verificare"?', a: 'Sono movimenti bancari categorizzati dall\'AI che necessitano della tua conferma.' },
    ]
  },
  '/outlet': {
    title: 'Outlet',
    icon: Store,
    description: 'Gestione dei tuoi punti vendita. Visualizza performance, ricavi giornalieri e costi per ogni outlet.',
    tips: [
      'Seleziona un outlet dalla lista per vedere il dettaglio delle performance.',
      'Puoi caricare ricavi giornalieri tramite file CSV dall\'Import Hub.',
      'Il confronto tra outlet è disponibile nella pagina dedicata.',
    ],
    faq: [
      { q: 'Come aggiungo un nuovo outlet?', a: 'Vai su Impostazioni → Azienda per aggiungere nuovi punti vendita.' },
      { q: 'Come importo i dati POS?', a: 'Usa l\'Import Hub per caricare i file POS nel formato richiesto.' },
    ]
  },
  '/scadenzario': {
    title: 'Scadenzario',
    icon: Receipt,
    description: 'Gestione scadenze fornitori e pagamenti. Monitora le fatture in scadenza e pianifica i pagamenti.',
    tips: [
      'Le scadenze in rosso sono già scadute e richiedono attenzione immediata.',
      'Puoi registrare un pagamento cliccando sull\'icona "Paga" nella riga della scadenza.',
      'Usa i filtri per visualizzare solo le scadenze di un fornitore specifico.',
    ],
    faq: [
      { q: 'Come aggiungo una scadenza manuale?', a: 'Clicca "+ Nuova scadenza" per inserire manualmente una scadenza fornitore.' },
      { q: 'Le fatture SDI si aggiornano automaticamente?', a: 'Sì, le fatture ricevute via SDI generano automaticamente le scadenze corrispondenti.' },
    ]
  },
  '/banche': {
    title: 'Banche',
    icon: Landmark,
    description: 'Gestione conti bancari, movimenti e riconciliazione. Connetti le banche via Open Banking o importa gli estratti conto.',
    tips: [
      'Il tab "Movimenti" mostra tutti i movimenti importati con filtri avanzati.',
      'Il tab "AI Categorie" permette la categorizzazione automatica dei movimenti.',
      'Il tab "Riconciliazione" abbina automaticamente movimenti e fatture.',
    ],
    faq: [
      { q: 'Come connetto la mia banca?', a: 'Vai su "Open Banking" e segui la procedura di collegamento tramite Yapily.' },
      { q: 'Come funziona la riconciliazione?', a: 'Il sistema abbina automaticamente movimenti bancari con fatture in base a importo, data e nome. Tu confermi o correggi gli abbinamenti.' },
    ]
  },
  '/fornitori': {
    title: 'Fornitori',
    icon: Building2,
    description: 'Anagrafica fornitori con dettaglio fatture, scadenze e storico pagamenti.',
    tips: [
      'Ogni fornitore mostra il totale fatturato, il saldo aperto e lo storico delle scadenze.',
      'Puoi collegare i movimenti bancari ai fornitori per una riconciliazione più precisa.',
    ],
    faq: [
      { q: 'Come aggiungo un fornitore?', a: 'I fornitori vengono creati automaticamente dall\'import delle fatture SDI. Puoi anche aggiungerli manualmente.' },
    ]
  },
  '/budget': {
    title: 'Budget & Controllo',
    icon: Calculator,
    description: 'Confronto budget vs consuntivo per ogni centro di costo e categoria.',
    tips: [
      'Inserisci il budget annuale per categoria, poi confrontalo con i costi effettivi.',
      'Le barre colorate mostrano lo scostamento: verde = sotto budget, rosso = sopra budget.',
      'Puoi esportare il confronto in formato Excel.',
    ],
    faq: [
      { q: 'Come inserisco il budget?', a: 'Clicca "Modifica budget" per inserire gli importi previsti per ogni categoria di costo.' },
    ]
  },
  '/conto-economico': {
    title: 'Conto Economico',
    icon: BarChart3,
    description: 'Conto economico riclassificato con confronto tra periodi.',
    tips: [
      'Puoi confrontare il conto economico di due periodi diversi per analizzare i trend.',
      'I dati vengono importati dai bilanci caricati nell\'Import Hub.',
    ],
    faq: [
      { q: 'Come importo il bilancio?', a: 'Usa l\'Import Hub per caricare il file del bilancio in formato CSV o Excel.' },
    ]
  },
  '/cash-flow': {
    title: 'Cashflow Prospettico',
    icon: Wallet,
    description: 'Previsione dei flussi di cassa basata su scadenze, ricavi previsti e impegni futuri.',
    tips: [
      'Il grafico mostra l\'andamento previsto della liquidità nei prossimi mesi.',
      'I dati si basano sulle scadenze fornitore, le previsioni di incasso e i costi ricorrenti.',
    ],
    faq: [
      { q: 'Come miglioro la precisione della previsione?', a: 'Più dati inserisci (scadenze, budget, ricavi giornalieri), più la previsione sarà accurata.' },
    ]
  },
  '/fatturazione': {
    title: 'Fatturazione',
    icon: FileCode,
    description: 'Gestione fatture elettroniche attive e passive con tracking SDI.',
    tips: [
      'Le fatture ricevute via SDI appaiono automaticamente con stato aggiornato.',
      'Puoi filtrare per direzione (attive/passive) e stato SDI.',
      'Lo stato SDI si aggiorna automaticamente quando arrivano le notifiche dall\'Agenzia delle Entrate.',
    ],
    faq: [
      { q: 'Come invio una fattura?', a: 'Crea la fattura dalla sezione "Nuova fattura" e il sistema la invierà automaticamente all\'SDI.' },
    ]
  },
  '/scadenze-fiscali': {
    title: 'Scadenze Fiscali',
    icon: CalendarClock,
    description: 'Calendario scadenze fiscali: F24, IVA, INPS, IRPEF, IRAP e tutti gli adempimenti.',
    tips: [
      'Le scadenze sono precaricate con le date standard italiane.',
      'Puoi segnare una scadenza come "Pagata" una volta effettuato il versamento.',
      'Le scadenze ricorrenti vengono rigenerate automaticamente per l\'anno successivo.',
    ],
    faq: [
      { q: 'Come aggiungo una scadenza personalizzata?', a: 'Clicca "+ Nuova scadenza" e compila il form con tipo, data e importo.' },
      { q: 'Cosa sono i codici tributo?', a: 'I codici tributo identificano il tipo di versamento nel modello F24 (es. 6001 = IVA gennaio).' },
    ]
  },
  '/import-hub': {
    title: 'Import Hub',
    icon: DatabaseZap,
    description: 'Centro importazione dati: estratti conto, fatture, POS, bilanci e altri documenti.',
    tips: [
      'Trascina i file nell\'area di upload o clicca per selezionarli.',
      'I formati supportati sono: CSV, Excel (xlsx), XML (fatture SDI), PDF.',
      'Dopo l\'upload, il sistema analizza automaticamente il contenuto del file.',
    ],
    faq: [
      { q: 'Quale formato devo usare per gli estratti conto?', a: 'Il formato dipende dalla banca. Sono supportati i principali formati bancari italiani in CSV o Excel.' },
    ]
  },
  '/archivio': {
    title: 'Archivio Documenti',
    icon: Archive,
    description: 'Archivio centralizzato di tutti i documenti con conservazione sostitutiva a norma.',
    tips: [
      'Il tab "Conservazione Sostitutiva" mostra lo stato di conservazione legale dei documenti.',
      'I documenti fiscali devono essere conservati per 10 anni (art. 2220 C.C.).',
      'Puoi cercare documenti per nome, tipo o fonte di importazione.',
    ],
    faq: [
      { q: 'Cos\'è la conservazione sostitutiva?', a: 'È l\'obbligo legale di conservare i documenti fiscali in formato digitale per 10 anni, con garanzia di integrità e autenticità.' },
    ]
  },
  '/dipendenti': {
    title: 'Dipendenti',
    icon: Users,
    description: 'Gestione anagrafica dipendenti, contratti e documenti del personale.',
    tips: [
      'Puoi caricare contratti, cedolini e altri documenti per ogni dipendente.',
      'Lo storico dei documenti è disponibile nel dettaglio di ogni dipendente.',
    ],
    faq: []
  },
  '/impostazioni': {
    title: 'Impostazioni',
    icon: Settings,
    description: 'Configurazione azienda, utenti, ruoli e preferenze del sistema.',
    tips: [
      'Gestisci gli utenti e i ruoli dalla sezione "Utenti".',
      'Configura i dati aziendali (P.IVA, indirizzo, etc.) dalla sezione "Azienda".',
    ],
    faq: []
  },
  '/confronto-outlet': {
    title: 'Confronto Outlet',
    icon: GitCompare,
    description: 'Confronto performance tra outlet: ricavi, costi, margini e produttività.',
    tips: [
      'Seleziona due o più outlet per confrontare le performance nello stesso periodo.',
      'I grafici mostrano le differenze in termini di ricavi, costi e margine.',
    ],
    faq: []
  },
}

export default function HelpPanel() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  // Normalize path
  const path = '/' + location.pathname.split('/').filter(Boolean).join('/')
  const content = HELP_CONTENT[path === '/' ? '/' : path] || null

  // Close on route change
  useEffect(() => {
    setExpandedFaq(null)
  }, [path])

  if (!content) return null

  const Icon = content.icon

  return (
    <>
      {/* Floating help button */}
      <button
        onClick={() => setOpen(!open)}
        className={`fixed bottom-6 right-6 z-40 p-3 rounded-full shadow-lg transition-all ${
          open ? 'bg-slate-700 text-white rotate-45' : 'bg-blue-600 text-white hover:bg-blue-700 hover:scale-105'
        }`}
        title="Aiuto"
      >
        {open ? <X size={20} /> : <HelpCircle size={20} />}
      </button>

      {/* Help panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-40 w-[380px] max-h-[70vh] bg-white rounded-2xl border border-slate-200 shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white px-5 py-4 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-white/20 rounded-lg">
                <Icon size={20} />
              </div>
              <div>
                <h3 className="font-bold text-base">{content.title}</h3>
                <p className="text-blue-100 text-xs mt-0.5">Guida contestuale</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Description */}
            <p className="text-sm text-slate-600 leading-relaxed">{content.description}</p>

            {/* Tips */}
            {content.tips.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Suggerimenti</h4>
                <div className="space-y-2">
                  {content.tips.map((tip, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-600">
                      <ChevronRight size={14} className="text-blue-500 shrink-0 mt-0.5" />
                      <span>{tip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FAQ */}
            {content.faq.length > 0 && (
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2">Domande frequenti</h4>
                <div className="space-y-1.5">
                  {content.faq.map((item, i) => (
                    <div key={i} className="border border-slate-100 rounded-lg overflow-hidden">
                      <button
                        onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                        className="w-full text-left px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 flex items-center justify-between gap-2 transition"
                      >
                        <span>{item.q}</span>
                        <ChevronRight size={14} className={`text-slate-400 shrink-0 transition-transform ${expandedFaq === i ? 'rotate-90' : ''}`} />
                      </button>
                      {expandedFaq === i && (
                        <div className="px-3 pb-3 text-sm text-slate-600 border-t border-slate-100 pt-2">
                          {item.a}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
