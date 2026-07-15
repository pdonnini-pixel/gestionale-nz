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
    title: 'Scadenzario e Distinta pagamenti',
    icon: Receipt,
    description: 'Da qui vedi le fatture fornitori da pagare, prepari la DISTINTA (la lista dei bonifici), la mandi a chi paga e, al ritorno, la confermi. Le fatture confermate restano "in sospeso" finché il bonifico non arriva in banca e viene riconciliato: solo allora si chiudono. Nessuna fattura si chiude prima del pagamento reale.',
    tips: [
      '① SELEZIONA le fatture da pagare: spunta la casella a sinistra di ogni riga. In basso compare la barra con il totale e, per ogni banca in uso, il saldo attuale → saldo residuo stimato (sempre a colpo d\'occhio).',
      '② ASSEGNA BANCA e TIPO: nel pannello che si apre sotto la riga scegli la Banca e il Tipo. "Saldo" = paghi tutto il residuo. "Parziale" = acconto: scrivi l\'importo. Sotto vedi live il tipo (ACCONTO/SALDO, con la rata es. 1/3) e il netto del bonifico.',
      '③ NOTE DI CREDITO (compensazione): se il fornitore ha NC aperte, compaiono i pulsanti "Scala note di credito". Selezionandole, l\'importo del bonifico scende del loro valore e la causale le cita ("al netto NC n.123…"), pronta da scrivere nel bonifico. Le NC NON si chiudono ora: solo al pagamento.',
      '④ CREA DISTINTA: genera l\'anteprima (email + riepilogo per banca). NON scrive nulla sul gestionale: puoi rileggerla, correggere e rigenerare. Copiala o mandala via Gmail a chi esegue i bonifici.',
      '⑤ CONFERMA DISTINTA: quando torni, premi "Conferma distinta". Le fatture passano IN SOSPESO (escono dallo scadenzario attivo) e restano in attesa. Non vengono ancora segnate come pagate.',
      '⑥ BOZZA AUTOMATICA: il lavoro in corso (selezione + piano) si salva da solo nel browser. Se cambi pagina/finestra o ricarichi, al ritorno lo ritrovi ("Bozza distinta ripristinata"). Si azzera a conferma o con "Annulla".',
      '⑦ IN SOSPESO: le fatture disposte le rivedi col pill "In sospeso" nella barra filtri (o filtro stato "In sospeso"). Da qui puoi cambiare idea con "Rimuovi dalla distinta" (torna attiva) o chiuderle a mano.',
      '⑧ RICONCILIAZIONE: quando l\'estratto conto arriva, il movimento si aggancia da solo alla fattura e la chiude. Se il bonifico non trova riscontro (causale non riconosciuta, o importo netto per NC) lo abbini a mano in Banche → Riconciliazione: chiude la fattura (e le NC collegate) senza creare doppioni.',
      '⑨ CHIUDI A MANO (valvola): se un pagamento non risulterà mai in banca, puoi chiudere la fattura a mano indicando data e banca. Non crea un movimento: la prima nota resta i soli movimenti bancari reali.',
    ],
    faq: [
      { q: 'Quando si chiudono le fatture e le note di credito?', a: 'Mai alla conferma della distinta. Solo quando il bonifico arriva ed è riconciliato (in automatico o a mano), oppure se la chiudi a mano. Fino ad allora restano "in sospeso", in attesa. Fattura e NC collegate si chiudono insieme.' },
      { q: 'La distinta ha segnato le fatture come pagate?', a: 'No. La conferma le mette solo "in sospeso" con la banca prevista. Diventano "pagate" solo al riscontro del movimento bancario.' },
      { q: 'Ho sbagliato la banca dopo aver confermato. Come correggo?', a: 'Vai nel filtro "In sospeso", trova la fattura e usa "Rimuovi dalla distinta": torna attiva e la ridisponi con la banca giusta. (Prima di confermare, basta cambiare la banca nel pannello e rigenerare.)' },
      { q: 'Come funzionano ACCONTO e SALDO nella distinta?', a: 'ACCONTO se paghi in "Parziale" o se è una rata intermedia di un piano (es. 1/3, 2/3). SALDO se paghi tutto o è l\'ultima rata. L\'etichetta mostra anche la rata (es. "SALDO (rata 3/3)").' },
      { q: 'Fattura 8.000 con 2 note di credito da 1.000: come faccio?', a: 'Selezioni la fattura, poi con "Scala note di credito" spunti le due NC: il bonifico diventa 6.000 e la causale diventa "…al netto NC n.X e NC n.Y". Bonifichi 6.000; alla riconciliazione la fattura si chiude e le due NC si compensano da sole.' },
      { q: 'Se chiudo a mano e poi il bonifico arriva lo stesso, si duplica?', a: 'In prima nota no: la prima nota sono solo i movimenti bancari veri, la chiusura a mano non crea movimenti. Il movimento arrivato lo abbini alla fattura (anche già chiusa) in Banche → Riconciliazione, così non resta "spaiato".' },
      { q: 'Ho perso il lavoro sulla distinta cambiando finestra?', a: 'No: la bozza si salva da sola nel browser e viene ripristinata quando torni sulla pagina. Attenzione: è legata al tuo browser/PC (non è condivisa con le altre operatrici).' },
      { q: 'Come aggiungo una scadenza manuale?', a: 'Con "+ Nuova scadenza". Le fatture ricevute via SDI/A-Cube generano invece le scadenze in automatico.' },
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
    title: 'Fatturazione Elettronica',
    icon: FileCode,
    description: 'La sezione ha tre schede: FATTURE PASSIVE (ricevute dai fornitori), FATTURE ATTIVE (di vendita, emesse dall\'azienda) e CORRISPETTIVI (incassi giornalieri). Le fatture passive e attive arrivano da sole dal Cassetto Fiscale tramite A-Cube: qui le consulti, cerchi e filtri. Per produrre gli XML delle vendite da caricare in Agenzia delle Entrate usi lo strumento "Converti Excel → XML".',
    tips: [
      '① FATTURE PASSIVE: le fatture ricevute dai fornitori via SDI. Vengono scaricate in automatico dal Cassetto Fiscale ogni 6 ore. Il pulsante "Sincronizza SDI" in alto a destra forza un aggiornamento immediato. Puoi anche importare a mano un XML con "Importa XML". Clic su una riga = fattura formattata leggibile.',
      '② FATTURE ATTIVE: le fatture di vendita emesse dall\'azienda, anch\'esse scaricate in automatico dal Cassetto. Cerca per cliente o numero, filtra per periodo (mese per mese), la lista è sempre ordinata dalla più recente. La colonna "Stato SDI" mostra il percorso della fattura (Inviata, Consegnata, Accettata…).',
      '③ CONVERTI EXCEL → XML: nel tab Attive, il pulsante verde apre lo strumento che trasforma l\'export Excel del gestionale in XML FatturaPA (FPR12), uno per fattura, pronti per l\'import in AdE. Ogni generazione resta in archivio. La guida di dettaglio si apre dentro quella pagina.',
      '④ NUOVA VIA A-CUBE è temporaneamente disattivato (grigio): per ora le fatture di vendita si producono con "Converti Excel → XML".',
      '⑤ CORRISPETTIVI: gli incassi giornalieri (POS / corrispettivi telematici dell\'Agenzia delle Entrate).',
      '⑥ Il numero accanto a ogni scheda (badge) conta le fatture del periodo/anno selezionato in alto nella pagina.',
    ],
    faq: [
      { q: 'Da dove arrivano le fatture che vedo?', a: 'Dal Cassetto Fiscale tramite A-Cube: sia le passive (acquisti) sia le attive (vendite) vengono scaricate in automatico ogni 6 ore. Il pulsante "Sincronizza SDI" in alto forza subito un aggiornamento.' },
      { q: 'Come genero gli XML da caricare in Agenzia delle Entrate?', a: 'Tab Fatture Attive → pulsante verde "Converti Excel → XML" → carica il file Excel esportato dal gestionale (oppure incolla le righe) → "Genera XML" → "Scarica tutti (.zip)". Ogni generazione resta salvata nell\'archivio in fondo alla pagina.' },
      { q: 'Perché "Nuova via A-Cube" è grigio e non si clicca?', a: 'L\'emissione diretta via A-Cube è temporaneamente disattivata. Per ora le fatture di vendita si producono con il convertitore "Converti Excel → XML".' },
      { q: 'Cosa significano gli stati SDI delle fatture attive?', a: 'Sono lo stato di trasmissione: Inviata (trasmessa all\'AdE), Consegnata (recapitata al cliente), Accettata (validata dall\'AdE), Scartata (rifiutata, da correggere).' },
      { q: 'Il numero sulla scheda non coincide con le righe in tabella. Perché?', a: 'Il badge della scheda conta le fatture del periodo/anno selezionato in alto; la tabella può avere un filtro periodo diverso (o "Tutti i periodi"). Allinea i due filtri per farli coincidere.' },
      { q: 'Come importo una fattura passiva a mano?', a: 'Nel tab Fatture Passive usa "Importa XML" e carica il file XML FatturaPA del fornitore.' },
    ]
  },
  '/fatturazione/converti-xml': {
    title: 'Converti Excel → XML',
    icon: FileCode,
    description: 'Trasforma l\'export Excel del gestionale in file XML Fattura Elettronica (formato FPR12), uno per fattura, pronti per l\'import in Agenzia delle Entrate. Funziona tutto sul tuo computer: nessuna fattura viene inviata da qui.',
    tips: [
      '① NUMERO DI PARTENZA: è il progressivo di invio (a 5 cifre) da assegnare. Lo strumento ricorda l\'ultimo numero usato e propone in automatico il successivo; puoi comunque sovrascriverlo.',
      '② DATI IN INGRESSO: due modi. "Carica file Excel" (.xls/.xlsx esportato dal gestionale) oppure "Incolla righe" copiate da Excel — meglio includendo la riga di intestazione, così le colonne vengono riconosciute per nome.',
      '③ GENERA XML: le fatture vengono ordinate per data, numerate progressivamente e trasformate in un XML ciascuna. Nel riepilogo, le righe dove Imponibile + Imposta ≠ Totale sono evidenziate in rosso (l\'XML si genera lo stesso).',
      '④ SCARICA: usa "Scarica tutti (.zip)" per l\'intero blocco, poi importa i singoli XML in Agenzia delle Entrate.',
      '⑤ ARCHIVIO GENERAZIONI: ogni "Genera XML" resta salvato qui. Puoi cercare per numero o cliente, filtrare per mese, ri-scaricare il singolo XML o l\'intero .zip, oppure eliminare una generazione sbagliata.',
    ],
    faq: [
      { q: 'I file generati restano salvati?', a: 'Sì. Ogni generazione viene archiviata (visibile solo alla tua azienda). La ritrovi in "Archivio generazioni" in fondo, con ricerca, filtro per mese e download del singolo file o dell\'intero .zip.' },
      { q: 'Che numerazione usa?', a: 'Il progressivo di invio a 5 cifre (es. 00021), che finisce sia nel nome del file sia nel campo ProgressivoInvio dell\'XML. Il numero della fattura vera resta quello del gestionale (es. 4/2026/A/TOR).' },
      { q: 'Gli XML sono già firmati e pronti?', a: 'No: NON sono firmati digitalmente (.p7m) né validati contro lo schema XSD ufficiale. Hanno la stessa forma del file modello già usato per l\'import manuale in AdE.' },
      { q: 'Una fattura è segnata in rosso ("NO" nella colonna Quadra): che faccio?', a: 'Vuol dire che Imponibile + Imposta non fa il Totale (oltre 1 centesimo di differenza). L\'XML viene comunque generato: se serve, correggi l\'importo nell\'export Excel e rigenera.' },
      { q: 'Ho generato per errore: come annullo?', a: 'In "Archivio generazioni" premi "Elimina" sulla generazione sbagliata. Il numero progressivo ricordato non cambia: al prossimo giro puoi reimpostare a mano il "Numero di partenza".' },
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
