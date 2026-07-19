# Audit Mobile — Gestionale NZ (viewport 360–430px, touch-first)

> **Data:** 2026-07-19 · **Branch:** `claude/mobile-gestionale-audit-ljslg4` · **Solo analisi: nessuna modifica al codice.**
>
> Audit multi-agente: **16 auditor paralleli** (uno per area) + **verificatore avversariale per ogni finding**
> (165 agenti). La verifica avversariale è stata completata al 100%: 49 verificatori interrotti dal limite
> di spesa nel primo run sono stati rieseguiti in un secondo run. Dei **149 finding grezzi**:
> **109 confermati** (dopo accorpamento di 29 duplicati segnalati da più aree), **11 scartati**
> come falsi positivi / già mitigati / dead code. La sessione principale è intervenuta solo per 4 arbitrati
> documentati inline: 2 conferme annullate per dead code non raggiungibile (verificato su App.tsx e import),
> 1 ri-ancoraggio di un finding valido citato in un file dead-code, 1 spareggio di severità tra verificatori
> in disaccordo (FinanziamentiTab).
> Il comportamento mobile è identico sui 3 tenant (NZ / Made / Zago): codebase unica, 3 deploy Netlify —
> i finding valgono per tutti e tre; l'area 14 segnala i soli punti in cui i tenant divergono davvero.

## Riepilogo

| Severità | Finding |
|---|---|
| 🔴 Critica | 2 |
| 🟠 Alta | 36 |
| 🟡 Media | 50 |
| 🟢 Bassa | 21 |
| **Totale confermati** | **109** |

### I 10 interventi con il miglior rapporto impatto/sforzo

1. **Layout root `h-screen` → `h-dvh`** (critica): con lo scroll solo interno la barra URL mobile non si ritrae mai e gli ultimi ~50–80px di OGNI pagina restano coperti/irraggiungibili; `pb-16` compensa solo la bottom nav. Fix a una riga + stesso cambio nei modali `max-h-[90vh]` → `90dvh`.
2. **`AICategorization.tsx:64`** (critica): fallback hardcoded sull'URL Supabase NZ — su Made/Zago può inviare il JWT dell'utente al progetto sbagliato; usare `getCurrentTenant()` come in Fatturazione (stessa cosa in `Ticket.tsx:1135`).
3. **StoreManager**: dropdown cambio-outlet solo hover + griglie senza breakpoint — è la pagina fatta per Sabrina/Veronica da telefono.
4. **ScadenzarioSmart**: top bar non responsive (overflow orizzontale dell'intera pagina /scadenzario, linkata nella bottom nav mobile).
5. **Bottom nav vs elementi flottanti**: pulsante ? dell'aiuto e barra pagamenti bulk si sovrappongono alla bottom nav; classe `safe-area-pb` usata ma mai definita.
6. **Toast**: backdrop invisibile che ruba il primo tap per 10s + larghezza fissa 384px.
7. **Tabelle senza `overflow-x-auto`** (FinanziamentiTab, Outlet staff, Impostazioni, ArchivioDocumenti, ReportSincronizzazioni, CashflowProspettico): applicare il pattern già usato in Fornitori/RevisionePagamenti.
8. **Griglie KPI a colonne fisse** (`grid-cols-4/5` senza varianti sm:): pattern ripetuto in ~6 pagine.
9. **Tooltip / hover-only**: dare un'attivazione touch (tap/focus) a Tooltip.tsx e alle azioni visibili solo con `group-hover`.
10. **Input con `text-sm`** (14px) → 16px su mobile per eliminare lo zoom automatico iOS su tutti i form; pannello NotificationBell da 400px fissi → `max-w-[calc(100vw-1rem)]`.

---

## 🔴 CRITICA — 2 finding

### CRITICA-1 · `src/components/AICategorization.tsx:64` — Fallback hardcoded sull'URL del progetto Supabase NZ (bypassa il resolver tenant)

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** callEdgeFunction usa `import.meta.env.VITE_SUPABASE_URL || 'https://xfvfxsvqpnpvibgeqpqp.supabase.co'` invece di getCurrentTenant(). Il design documentato in src/lib/tenants.ts (righe 37-38 e 46) prevede che i site Netlify di Made/Zago abbiano le env var SUFFISSATE (VITE_SUPABASE_URL_MADE/_ZAGO): se la var non suffissata non e' definita sul site, su Made/Zago questa pagina (AI Categorie) chiama le Edge Function del progetto NZ, inviando il JWT dell'utente Made/Zago a un progetto altrui — feature rotta (401) su 2 tenant su 3 e violazione del divieto assoluto n.5 di CLAUDE.md (mai project_id/UUID hardcoded di un tenant). E' l'unico punto del frontend, insieme a Ticket.tsx:1135, dove il comportamento diverge davvero per tenant a livello funzionale.

**Fix proposto:** Sostituire la riga 64 con `const { supabaseUrl: baseUrl, supabaseAnonKey } = getCurrentTenant()`, identico al pattern gia' corretto in src/pages/Fatturazione.tsx:131-133. Rimuovere completamente il literal 'xfvfxsvqpnpvibgeqpqp'. Deploy automatico sui 3 tenant via Netlify.

### CRITICA-2 · `src/components/Layout.tsx:307` — Root h-screen (100vh) con scroll interno: viewport mobile sbagliato e barra browser mai ritratta

*Area: Gesti e scroll, Orientamento e viewport · Verifica: avversariale*

**Problema (mobile):** Il layout e' `<div className="flex h-screen overflow-hidden">` e tutto lo scroll avviene dentro `<main className="flex-1 overflow-y-auto">` (riga 346). Su Safari/Chrome mobile 100vh corrisponde al viewport GRANDE (URL bar nascosta): finche' la barra e' visibile, gli ultimi ~50-80px del layout finiscono sotto la barra del browser. In piu', siccome il documento (body) non scrolla mai, la URL bar non si ritrae MAI scrollando: lo spazio verticale perso e' permanente e le ultime righe di tabelle/liste restano parzialmente coperte nonostante il pb-16 per la bottom nav. Stesso problema sui modali dimensionati in vh: `max-h-[90vh]` in Scadenzario.tsx:95, Fornitori.tsx:1426, InvoiceViewer.tsx:490, HelpPanel.tsx:291 (`h-[70vh]`), GlobalSearch.tsx:179 (`max-h-[50vh]`).

**Fix proposto:** Usare le unita' dinamiche: `h-dvh` al posto di `h-screen` sul root del Layout (Tailwind 4 la supporta nativamente) e `max-h-[90dvh]` / `h-[70dvh]` / `max-h-[50dvh]` nei modali e pannelli. Nessun cambio di struttura necessario.

---

## 🟠 ALTA — 36 finding

### ALTA-1 · `src/App.tsx:11` — Dashboard importata eagerly trascina recharts nel bundle iniziale

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Tutte le ~33 pagine sono lazy (righe 14-46) ma Dashboard e' importata staticamente (riga 11: `import Dashboard from './pages/Dashboard'`). Dashboard importa recharts staticamente (src/pages/Dashboard.tsx:15-16: `import { AreaChart, Area, ... } from 'recharts'`), quindi il chunk `vendor-charts` definito in vite.config.ts (recharts 3, ~450KB min / ~130KB gzip) viene scaricato ed eseguito al primo caricamento dell'app — anche sulla pagina Login, prima ancora dell'autenticazione. Su smartphone con rete 4G debole questo ritarda il first paint per Lilian/Sabrina/Veronica a ogni cold start.

**Fix proposto:** Rendere Dashboard lazy come le altre: `const Dashboard = lazy(() => import('./pages/Dashboard'))`. Il fallback PageLoader esiste gia' (riga 49) e la Suspense avvolge gia' tutte le Route (riga 102), quindi e' un cambio di 1 riga. In alternativa/aggiunta: lazy-load del solo grafico AreaChart dentro Dashboard.

### ALTA-2 · `src/components/AICategorization.tsx:637` — text-slate-300 (contrasto ~1.9:1) su testo con significato di stato

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** text-slate-300 (#cbd5e1 su bianco = contrasto ~1.85:1, fallisce WCAG anche per large text, soglia 3:1) e' applicato a testo che comunica uno stato reale: 'Non categorizzato' (riga 637) e in ScadenzarioSmart.tsx:3552 l'importo originale barrato di una fattura parzialmente pagata ('text-slate-300 line-through text-[11px]') — un dato finanziario reso a 11px con contrasto 1.85:1 e' di fatto invisibile su smartphone in condizioni di luce reale. text-slate-300 su testo compare 103 volte; i '—' placeholder (Fornitori.tsx 921-978, Dipendenti.tsx:97, ReportSincronizzazioni.tsx:417) sono i casi meno gravi ma comunque quasi invisibili.

**Fix proposto:** Per testo di stato ('Non categorizzato') e dati (importo barrato) usare text-slate-500; per i trattini '—' placeholder almeno text-slate-400 e' tollerabile ma text-slate-500 e' preferibile. Mai text-slate-300 su testo.

### ALTA-3 · `src/components/FinanziamentiTab.tsx:460` — Tabelle a molte colonne senza wrapper overflow-x-auto (pattern ripetuto)

*Area: Layout responsive, Tabelle dati · Verifica: avversariale*

**Problema (mobile):** Riga 460: `<table className="w-full">` con 8 colonne (Descrizione, Tipo, Conto, Importo, Tasso, Periodicita', Rata, Azioni) e' dentro un div `overflow-hidden` (riga 459) senza `overflow-x-auto`: su 360px le 8 colonne vengono compresse a ~45px, testi e importi si spezzano su piu' righe e i bottoni Azioni diventano incliccabili (tab Finanziamenti della pagina Banche). Stesso pattern verificato in: src/pages/Outlet.tsx:1574 (tabella staff 5 colonne in contenitore overflow-hidden, riga 1573), src/pages/Impostazioni.tsx:994 (tabella categorie costi 7 colonne senza wrapper), src/pages/ArchivioDocumenti.tsx:824 (tabella fatture 6 colonne), src/pages/ReportSincronizzazioni.tsx:86 e 143 (tabelle dettaglio senza wrapper), src/pages/CashflowProspettico.tsx:1569 (wrapper solo `overflow-y-auto`, manca lo scroll orizzontale). [Arbitrato: due verificatori in disaccordo (alta vs critica); confermato sul codice che le celle non hanno whitespace-nowrap → la tabella si comprime (illeggibile) ma i bottoni Azioni restano raggiungibili: alta.]

**Fix proposto:** Avvolgere ogni tabella in `<div className="overflow-x-auto">` (dentro il contenitore rounded/overflow-hidden) e dare alla tabella un `min-w-[640px]` circa, come gia' fatto correttamente in Fornitori.tsx:849 e RevisionePagamenti.tsx:311.

### ALTA-4 · `src/components/HelpPanel.tsx:281` — FAB aiuto sovrapposto alla bottom nav: copre il tab 'Profilo'

*Area: Navigazione, Fixed/sticky e safe-area, Gesti e scroll, Orientamento e viewport, Accessibilità mobile, Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** Il bottone flottante di aiuto e' `fixed bottom-6 right-6 z-40` (44x44px). Su mobile la BottomNav di Layout.tsx (riga 97) e' `fixed bottom-0 ... z-40` alta h-14 (56px). Il FAB occupa la fascia 24-68px dal fondo, quindi copre ~32px verticali del quarto tab a destra ('Profilo'): stesso z-index (z-40) ma HelpPanel e' renderizzato dopo la BottomNav in Layout (riga 359 vs 356), quindi il FAB vince e intercetta i tap. Su 360px il tab 'Profilo' e' largo ~90px e il FAB ne copre la meta' destra: tap che finiscono sul pulsante aiuto invece che sulla navigazione.

**Fix proposto:** Su mobile alzare il FAB sopra la bottom nav: `bottom-20 md:bottom-6` (e coerentemente il pannello riga 291: `bottom-36 md:bottom-20`), tenendo conto anche del safe-area inset iOS.

### ALTA-5 · `src/components/HelpPanel.tsx:291` — Pannello chat AI fixed h-[70vh]: con tastiera virtuale aperta la textarea finisce dietro la tastiera

*Area: Fixed/sticky e safe-area, Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** Il pannello aiuto/chat è `fixed bottom-20 right-6 z-40 w-[380px] max-w-[calc(100vw-3rem)] h-[70vh] max-h-[560px]` con la textarea di input in fondo (riga 176). Su iOS gli elementi fixed restano ancorati al layout viewport quando si apre la tastiera: il campo dove si scrive la domanda all'assistente AI resta nascosto dietro la tastiera e l'utente scrive alla cieca o non vede affatto il campo. Nel repo non c'è alcun uso di `dvh` né dell'API `visualViewport` (grep senza risultati), quindi il problema non è mitigato da nessuna parte. Su viewport 360px il pannello 70vh + bottom-20 lascia inoltre pochissimo spazio ai messaggi.

**Fix proposto:** Su mobile rendere il pannello full-screen con altezza dinamica: `inset-x-0 bottom-0 h-[100dvh] md:h-[70vh] md:bottom-20 md:right-6 md:w-[380px]` (100dvh segue la tastiera) oppure riposizionare il pannello con window.visualViewport.height quando la tastiera è aperta.

### ALTA-6 · `src/components/Layout.tsx:97` — Classe 'safe-area-pb' inesistente: bottom nav sovrapposta alla home indicator iOS

*Area: Layout responsive, Navigazione, Fixed/sticky e safe-area, Gesti e scroll, Orientamento e viewport, Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** La BottomNav mobile usa `className="md:hidden fixed bottom-0 ... safe-area-pb"` ma la classe `safe-area-pb` non e' definita da nessuna parte (verificato: nessuna occorrenza in src/index.css, nessun tailwind.config con quella utility; Tailwind 4 non la fornisce di default). Sugli iPhone senza tasto home le icone della nav (h-14) restano a filo della home indicator e i tap in basso vengono intercettati dal gesto di sistema. Inoltre index.html:5 ha `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` senza `viewport-fit=cover`, quindi `env(safe-area-inset-bottom)` varrebbe comunque 0 in modalita' standalone/PWA.

**Fix proposto:** Definire in src/index.css `.safe-area-pb { padding-bottom: env(safe-area-inset-bottom); }` e aggiungere `viewport-fit=cover` al meta viewport in index.html; in alternativa usare la utility Tailwind 4 `pb-[env(safe-area-inset-bottom)]` direttamente sulla nav.

### ALTA-7 · `src/components/Layout.tsx:103` — Tab 'Profilo' della bottom nav porta a /impostazioni (pagina admin), non a /profilo

*Area: Navigazione · Verifica: avversariale*

**Problema (mobile):** La voce mobile `{ to: '/impostazioni', icon: User, label: 'Profilo' }` porta a Impostazioni azienda, che nella Sidebar e' riservata al solo ruolo super_advisor (Sidebar.tsx riga 119) e per gli altri ruoli mostra tab filtrate/vuote (Impostazioni.tsx righe 15, 1578). Aggravante: ProfileMenu e' `hidden sm:block` (riga 162), quindi da smartphone la pagina /profilo (cambio password, dati personali) e' completamente irraggiungibile: nessun link nella sidebar mobile, nessun avatar nell'header, e l'unico tab etichettato 'Profilo' porta altrove. Le store manager da telefono non possono aprire il proprio profilo.

**Fix proposto:** Cambiare la voce in `{ to: '/profilo', icon: User, label: 'Profilo' }`, oppure renderla dinamica: /impostazioni solo per super_advisor, /profilo per tutti gli altri. In alternativa mostrare ProfileMenu anche su mobile rimuovendo `hidden sm:block`.

### ALTA-8 · `src/components/NotificationBell.tsx:159` — Pannello notifiche largo 400px fisso: tagliato sui viewport 360-430px

*Area: Navigazione, Modali/drawer/dropdown, Gesti e scroll, Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Il dropdown notifiche usa `absolute right-0 top-full mt-2 w-[400px]` senza alcun max-width responsive. Su smartphone (360-430px) il pannello, ancorato alla campanella in alto a destra, si estende oltre il bordo sinistro dello schermo. In piu' e' dentro il wrapper `div.flex-1 flex flex-col overflow-hidden min-w-0` di Layout.tsx (riga 310), quindi la parte fuoriuscita viene CLIPPATA: su un 360px si perdono ~60-100px a sinistra di ogni notifica (icona categoria e inizio del titolo invisibili e non tappabili). Le notifiche (scadenze fornitori, anomalie) sono di fatto semi-inutilizzabili da telefono, il device principale di Sabrina/Veronica.

**Fix proposto:** Sostituire `w-[400px]` con `w-[400px] max-w-[calc(100vw-1.5rem)]` oppure, meglio, su mobile usare posizionamento fixed a tutta larghezza: `fixed inset-x-2 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-[400px]`. Stesso pattern gia' usato correttamente da HelpPanel (`max-w-[calc(100vw-3rem)]`, riga 291).

### ALTA-9 · `src/components/OpenBankingAcube.tsx:368` — P.IVA e ragione sociale di NZ hardcoded come placeholder nel modal onboarding A-Cube

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Il modal 'Collega banca via A-Cube' mostra placeholder `"07362100484"` (riga 368, una P.IVA reale) e `"New Zago Srl"` (riga 378) identici su tutti e 3 i tenant: un utente Made/Zago che collega la banca dallo smartphone vede i dati fiscali di un'ALTRA azienda come esempio da imitare, con rischio concreto di digitare/copiare l'identita' sbagliata in un flusso PSD2. Viola il divieto assoluto n.5 di CLAUDE.md (mai P.IVA hardcoded di un tenant). I dati corretti del tenant sono gia' disponibili in memoria via useCompany (company.vat_number, company.name).

**Fix proposto:** Prefillare onboardForm con i dati del tenant attivo (`const { company } = useCompany()` → fiscalId: company?.vat_number ?? '', businessName: company?.name ?? '') e usare placeholder neutri ('Es. 01234567890', 'Ragione sociale azienda'). Stessa cosa per la riga 378.

### ALTA-10 · `src/components/Toast.tsx:96` — Backdrop invisibile full-screen del toast globale intercetta il primo tap su tutta la pagina

*Area: Fixed/sticky e safe-area, Stati vuoti/loading/errori, Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Finché c'è almeno un toast visibile, viene renderizzato un backdrop invisibile a schermo intero (`<div className="fixed inset-0 z-[99] cursor-pointer" onClick={dismissAll} />`). Qualsiasi tap in qualunque punto della pagina viene consumato per chiudere i toast: su mobile, dopo un salvataggio l'utente tocca subito il bottone successivo e il tap 'sparisce' senza feedback (serve un secondo tap). Con z-[99] il backdrop copre anche la bottom nav (z-40), i modal z-50 e il FAB aiuto: per la durata del toast l'intera UI è di fatto bloccata al primo tocco.

**Fix proposto:** Rimuovere il backdrop full-screen: chiudere il toast solo con la X, con lo swipe o con l'auto-dismiss a timeout. Se si vuole mantenere il tap-to-dismiss, limitare l'area cliccabile al toast stesso (onClick sul ToastItem, non su un overlay inset-0).

### ALTA-11 · `src/components/Tooltip.tsx:56` — Tooltip condiviso solo hover: contenuto troncato irraggiungibile su touch

*Area: Interazioni hover-only, Gesti e scroll, Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Il componente Tooltip aggancia il contenuto esclusivamente a onMouseEnter/onMouseLeave (righe 56-63), senza alcun gestore onClick, onFocus o touch. Per design (commento righe 7-10) e' il veicolo UFFICIALE per mostrare il testo integrale di celle troncate: causali, note, ragioni sociali, descrizioni fatture, nomi file. Su smartphone (viewport 360-430px, dove il truncate scatta quasi sempre) il testo completo e' semplicemente inaccessibile: il tap non genera mouseenter affidabile e comunque il successivo tap-altrove non chiude nulla perche' pos resta null. Usato in 16 pagine: Scadenzario.tsx (es. riga 1381 descrizione max-w-md truncate), PrimaNota.tsx (righe 344-355 controparte/causale/categoria), ScadenzarioSmart, Fornitori, Fatturazione, TesoreriaManuale, ContoEconomico, Dipendenti, CashflowProspettico, BudgetControl, ArchivioDocumenti, ImportHub, Importazioni, MarginiCategoria, Outlet, ReportSincronizzazioni.

**Fix proposto:** Aggiungere al cloneElement anche onClick (toggle: se pos e' nullo mostra, altrimenti nascondi) e onFocus/onBlur, piu' un listener document 'pointerdown' che chiude quando si tocca fuori. In alternativa, sotto un breakpoint touch (matchMedia '(hover: none)') aprire il contenuto come bottom-sheet/popover al tap. Nessuna modifica richiesta nelle 16 pagine chiamanti.

### ALTA-12 · `src/pages/AcubeFatturaForm.tsx:181` — Linee fattura su griglia fissa grid-cols-12: campi da ~40px su viewport 360px

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Ogni linea documento usa `grid grid-cols-12 gap-2` senza breakpoint responsive (riga 181): Descrizione col-span-5, Quantita' col-span-2, Prezzo col-span-2, IVA col-span-2, cestino col-span-1. Su 360px, tolti padding pagina/card (p-4 + p-5) e i gap, restano ~280px di contenuto: i campi Quantita'/Prezzo/IVA scendono a ~40-45px di larghezza — impossibile leggere o toccare il valore digitato, e il numero digitato esce dal campo. Anche le sezioni Cliente (riga 115, `grid grid-cols-2 gap-4`) e Dati Documento (riga 148, `grid grid-cols-3 gap-4`) sono fisse senza `sm:`: su 360px la data e il select Tipo restano ~80px.

**Fix proposto:** Rendere le griglie responsive: righe 115/148 → `grid grid-cols-1 sm:grid-cols-2` / `sm:grid-cols-3`; riga 181 → layout a card su mobile, es. `grid grid-cols-2 sm:grid-cols-12` con Descrizione `col-span-2 sm:col-span-5` e Quantita'/Prezzo/IVA `col-span-1 sm:col-span-2`, cestino allineato a destra. E' il form che emette fatture reali verso SDI: su smartphone oggi e' di fatto inutilizzabile.

### ALTA-13 · `src/pages/AnalyticsPOS.tsx:467` — Etichette esterne della torta lunghe (nome + valore) tagliate ai bordi su 360px

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** La Pie "Distribuzione per Fascia Importo" ha outerRadius={100} e label={({name, value}) => `${name}: ${fmt(value)}`} con labelLine={false}: etichette tipo "50-100€: 12.345" posizionate fuori dalla torta. Su container ~290-300px (card p-6) le etichette delle fette laterali escono dal viewBox SVG e vengono clippate; senza labelLine non è nemmeno chiaro a quale fetta appartengano. Non c'è alcuna Legend di fallback. Stesso pattern in src/pages/ContoEconomico.tsx:2020 e :2826 (outerRadius 105 + label esterna nome+percento, mitigato lì dalla mini-legenda sotto).

**Fix proposto:** Su mobile sostituire le etichette esterne con una legenda sotto il grafico (ModernLegend già esistente in ChartTheme.tsx) o etichette interne solo-percentuale; ridurre outerRadius a valore percentuale (es. "60%").

### ALTA-14 · `src/pages/CashflowProspettico.tsx:1626` — Modal previsione uscita senza max-h né scroll interno

*Area: Modali/drawer/dropdown · Verifica: avversariale*

**Problema (mobile):** Il contenitore del modal 'Aggiungi previsione uscita' è `bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6` senza `max-h` né `overflow-y-auto`. Il form è lungo (~8 campi: tipo, descrizione, importo, data, ricorrenza, mesi, banca...; bottoni Salva/Annulla a riga ~1690). Su 360x640, e ancor più con la tastiera aperta, il modal supera l'altezza del viewport: i bottoni in fondo (e i primi campi in alto, essendo centrato con items-center) diventano irraggiungibili perché non c'è alcuno scroll.

**Fix proposto:** Aggiungere `max-h-[90vh] overflow-y-auto` al contenitore bianco (come già fatto in Fornitori.tsx riga 1426 e ScadenzarioSmart.tsx riga 202). Stesso problema nel modal gemello a riga 1605-1620 se il contenuto cresce.

### ALTA-15 · `src/pages/Dashboard.tsx:173` — Waterfall di 10+ query Supabase sequenziali al caricamento della Dashboard

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Il useEffect di fetch (riga 173) esegue in serie con await singoli molte query tra loro indipendenti: dashPrev (308), bsPrev (317), bcRows (358), cashData (441), loansData (457), cmData (470), count scadenze (528), drData (538) — oltre ai fallback condizionali 197/214/241 che sono serialmente giustificati. Su mobile con RTT 150-300ms sono 8-10 round trip in cascata = 1,5-3 secondi di spinner aggiuntivi solo di latenza di rete, a ogni apertura e cambio anno. Stesso pattern in src/pages/ScadenzarioSmart.tsx (fetchData, righe 690-846: cost_categories, suppliers, cost_centers, recurring_costs, bank_accounts, cash_movements, payable_actions, fiscal_deadlines, companies tutte in serie).

**Fix proposto:** Raggruppare le query indipendenti in Promise.all (il file lo fa gia' in due punti, righe 341 e 513 — estendere lo stesso pattern al resto). Le sole query da tenere sequenziali sono i fallback condizionati da hasViewData.

### ALTA-16 · `src/pages/Dashboard.tsx:564` — Errore di caricamento dati silenzioso: la pagina mostra KPI a zero senza alcun avviso

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** Nel catch del fetch principale c'e' solo `console.error('Dashboard fetch error:', err)` seguito da `setLoading(false)`: nessuno stato di errore, nessun banner. Su smartphone con rete instabile (caso frequente per Lilian/Sabrina/Veronica in negozio) il fetch fallisce e la Dashboard renderizza KPI a 0 EUR e grafici vuoti come se fossero dati reali. Stesso pattern identico in: src/pages/ConfrontoOutlet.tsx:722 (catch che non setta errore, la pagina mostra l'empty 'nessun dato'), src/pages/ScadenzarioSmart.tsx:855 (fetchData principale della pagina piu' usata da mobile: scadenzario appare vuoto = 'niente da pagare'), src/pages/Fornitori.tsx:235, src/pages/ScadenzeFiscali.tsx:239, e ~20 catch in src/pages/ContoEconomico.tsx (577, 660, 712, 731, 751, 767, ...). In un gestionale finanziario in produzione mostrare zeri al posto di un errore e' pericoloso.

**Fix proposto:** Aggiungere uno stato `error` in ogni pagina: nel catch fare `setError('Impossibile caricare i dati. Controlla la connessione e riprova.')` e renderizzare un banner/EmptyState con bottone 'Riprova' (che richiama fetchData) al posto del contenuto. In alternativa creare un hook condiviso useFetchWithError o un componente <ErrorState onRetry> riusabile accanto a EmptyState.tsx.

### ALTA-17 · `src/pages/Fatturazione.tsx:504` — Tabelle fatture 8 colonne con min-width esplicite e Azioni in coda

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella del ciclo passivo ha 8 colonne con min-width dichiarate (Numero min-w-[120px], Fornitore min-w-[200px], Imponibile/IVA/Totale min-w-[100px] ciascuna, righe 504-510): larghezza minima >750px, oltre 2 schermate a 360px. La colonna Azioni (visualizza fattura, riga 511) è l'ultima a destra. Stessa struttura per il ciclo attivo a riga 740 (7 colonne con Stato SDI e Azioni). Solo scroll orizzontale senza indicatore, nessuna card view.

**Fix proposto:** Su mobile nascondere Imponibile e IVA con `hidden md:table-cell` lasciando solo il Totale (il dato che serve in mobilità), e ridurre min-w di Fornitore sotto md. Valutare card view con Numero+Fornitore+Totale+Stato e tap sull'intera riga per aprire la fattura.

### ALTA-18 · `src/pages/Fornitori.tsx:31` — PdfViewer (pdfjs-dist) importato staticamente: ~350KB gzip pagati all'apertura pagina

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Fornitori.tsx:31 e ContoEconomico.tsx:35 importano `PdfViewer` staticamente. PdfViewer importa pdfjs-dist a livello modulo (src/components/PdfViewer.tsx:4), quindi il chunk `vendor-pdf` (~1MB min, ~350KB gzip, piu' il worker) viene scaricato appena si apre la pagina Fornitori o Conto Economico su mobile, anche se l'utente non apre mai un allegato PDF. Il pattern corretto esiste gia' nello stesso repo: Outlet.tsx:19 e Dipendenti.tsx:54 fanno `const PdfViewer = lazy(() => import('../components/PdfViewer'))`.

**Fix proposto:** Uniformare Fornitori.tsx e ContoEconomico.tsx al pattern lazy gia' usato in Outlet.tsx:19: `const PdfViewer = lazy(() => import('../components/PdfViewer'))` con Suspense attorno al render nel modal (righe 1607 in Fornitori, 1854 in ContoEconomico).

### ALTA-19 · `src/pages/Fornitori.tsx:849` — Tabella fornitori min-w-[920px]: 2,5 schermate di scroll senza colonna sticky

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella ha `min-w-[920px]` e 9 colonne (Fornitore, P.IVA, Cat., Divisione, Metodo, Fatturato, Da pagare, Banca, Azioni). A 360px servono 2,5 schermate di scroll orizzontale e la prima colonna (nome fornitore) NON è sticky: scorrendo per leggere "Da pagare" o usare "Azioni" si perde completamente il riferimento a quale fornitore appartiene la riga. L'header è sticky solo verticalmente (top-0, riga 850). Nessuna alternativa mobile.

**Fix proposto:** Rendere sticky la prima colonna (pattern già usato in MarginiOutlet.tsx:420 con `sticky left-0 z-10 bg-slate-50`) e nascondere su mobile le colonne secondarie con `hidden md:table-cell` (P.IVA, Cat., Divisione, Metodo), riducendo il min-w sotto md. Oppure card view mobile con nome, da pagare e azioni.

### ALTA-20 · `src/pages/Login.tsx:149` — Tutti gli input hanno font 14px (text-sm): zoom automatico iOS a ogni focus

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** L'input email del Login (riga 149) e l'input password (riga 162) usano `text-sm` (14px). iOS Safari fa zoom automatico su qualsiasi campo con font-size < 16px: a ogni tap su un campo la pagina si ingrandisce e l'utente deve ri-zoomare fuori. Il pattern e' ripetuto su TUTTO il repo: grep conferma 0 input con `text-base` in src/. Casi rappresentativi: src/pages/Onboarding.tsx:438 (inputClass con text-sm), src/pages/TesoreriaManuale.tsx:862, src/pages/AcubeFatturaForm.tsx:119, src/components/OutletWizard.tsx:84, src/pages/Dipendenti.tsx:1742 e src/components/FinanziamentiTab.tsx:690 (classi locali .inp/.form-inp con font-size:0.875rem), fino a `text-xs` (12px) su input di ricerca in src/pages/ScadenzarioSmart.tsx:2711. src/index.css non contiene alcuna regola di font-size per input/select/textarea che mitighi il problema.

**Fix proposto:** Fix centralizzato in src/index.css (una sola modifica per tutto il repo): aggiungere `@media (max-width: 767px) { input, select, textarea { font-size: 16px !important; } }` (oppure senza !important, dopo verifica che vinca sulle utility Tailwind, es. `input:where(.text-sm,.text-xs)`). In alternativa, sostituire `text-sm` con `text-base sm:text-sm` sugli input dei form principali. Aggiornare anche le classi inline .inp (Dipendenti.tsx) e .form-inp (FinanziamentiTab.tsx) portando font-size a 1rem su mobile.

### ALTA-21 · `src/pages/Scadenzario.tsx:1154` — Tabella scadenze 8 colonne con azioni Salda/Rateizza fuori viewport, nessuna vista mobile

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella principale dello scadenzario ha 8 colonne (Fornitore, Fattura, Outlet, Importo, Scadenza, Stato, Metodo, Azioni — righe 1157-1164). A 360px si vedono ~3 colonne; i pulsanti operativi Salda/Rateizza/Modifica (righe 1194-1201) stanno nell'ultima colonna a destra, raggiungibili solo con scroll orizzontale cieco (nessun indicatore, scrollbar invisibile su iOS). Chi usa lo smartphone (Lilian, Sabrina, Veronica) non vede né lo stato né le azioni sulla scadenza senza sapere di dover scorrere. Nessuna card view mobile in tutta la pagina (zero occorrenze di sm:hidden).

**Fix proposto:** Replicare il pattern già esistente in Dashboard.tsx (righe 861 `hidden sm:block` per la tabella + 929 `sm:hidden` per le card): sotto sm mostrare card con Fornitore, Importo, Scadenza, StatusPill e pulsanti Salda/Rateizza a piena larghezza. In alternativa minima: `hidden md:table-cell` su Fattura, Outlet e Metodo.

### ALTA-22 · `src/pages/ScadenzarioSmart.tsx:201` — Nessun blocco dello scroll del body quando i modali sono aperti (scroll bleed)

*Area: Modali/drawer/dropdown, Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Su ~35 overlay `fixed inset-0` nel progetto, solo AccountDetail.tsx (righe 416-423) imposta `document.body.style.overflow = 'hidden'`. Tutti gli altri — il Modal generico di ScadenzarioSmart (riga 201), Fornitori.tsx:1425, Fatturazione.tsx:805 (drawer), InvoiceViewer.tsx:489, OutletWizard.tsx:649, ContractUploader.tsx:334, Scadenzario.tsx:94, TesoreriaManuale.tsx:449, CashflowProspettico.tsx:1625, Contratti.tsx:198 ecc. — non lo fanno: su iOS/Android lo swipe dentro il modale fa scorrere anche la pagina sottostante, e a modale chiuso l'utente si ritrova in un punto diverso della lista.

**Fix proposto:** Estrarre un hook condiviso `useBodyScrollLock(open)` (stessa logica di AccountDetail.tsx:416-423) e applicarlo a tutti i componenti modale/drawer; in alternativa creare un componente Modal condiviso in src/components/ui/ che lo includa.

### ALTA-23 · `src/pages/ScadenzarioSmart.tsx:2543` — Top bar Scadenze non responsive: overflow orizzontale dell'intera pagina

*Area: Layout responsive · Verifica: avversariale*

**Problema (mobile):** La riga 2543 e' `<div className="max-w-[1600px] mx-auto px-6 py-3 flex items-center justify-between">`: a sinistra un `flex items-center gap-8` con titolo + 3 tab pill (Situazione/Scadenzario/Ricorrenze, ciascuna px-4 py-2 text-sm, larghezza complessiva ~380px) e a destra ExportMenu + bottone "Aggiungi scadenza" (~180px). Nessun flex-wrap, nessuna classe sm:/md:. Su viewport 360-430px il contenuto supera i 500px: il <main> di Layout.tsx ha overflow-y-auto (quindi overflow-x calcolato auto) e tutta la pagina scorre in orizzontale, con tab e bottone Aggiungi fuori schermo. E' la pagina '/scadenzario' linkata nella BottomNav mobile ('Scadenze'), usata ogni giorno da Lilian/Sabrina/Veronica da smartphone.

**Fix proposto:** Rendere la barra impilabile: `flex flex-wrap gap-y-2` sul contenitore, `px-4 sm:px-6`, ridurre `gap-8` a `gap-3 sm:gap-8`, mettere le 3 tab in un contenitore `overflow-x-auto` con `shrink-0` sulle pill, e su mobile ridurre "Aggiungi scadenza" a icona (`<span className="hidden sm:inline">Aggiungi scadenza</span>`).

### ALTA-24 · `src/pages/ScadenzarioSmart.tsx:2670` — KPI 'Riepilogo banche' in grid-cols-5 fissa: colonne da ~55px su mobile

*Area: Layout responsive, Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** Riga 2670 `<div className="grid grid-cols-5 gap-4 text-center">` senza varianti responsive: 5 KPI (Saldo oggi, Da pagare, Scaduto, Prossimi 7gg, Saldo proiettato) con importi `text-lg font-bold` tipo `12.345 €` in colonne da ~50-55px su 360px — le cifre vanno a capo carattere per carattere o si sovrappongono, rendendo il riepilogo illeggibile nella tab Situazione dello Scadenzario. Stesso pattern senza breakpoint mobile: src/pages/CashflowProspettico.tsx:2023 (`grid grid-cols-5 gap-4 text-center`, riga summary Totale entrate/uscite/flusso/saldi), src/pages/BudgetControl.tsx:2168 (`grid grid-cols-4 gap-1`), src/pages/ScenarioPlanning.tsx:469 (`grid grid-cols-3 gap-6`), src/pages/Produttivita.tsx:732 (`grid grid-cols-3 gap-4`).

**Fix proposto:** Usare griglie progressive: `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4` (e analogo `grid-cols-1 sm:grid-cols-3` per i casi a 3 colonne), come gia' fatto in Dashboard.tsx:686.

### ALTA-25 · `src/pages/ScadenzarioSmart.tsx:2672` — text-slate-400 (contrasto ~3:1) usato massicciamente per testo informativo

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** text-slate-400 (#94a3b8 su sfondo bianco/slate-50 = contrasto ~2.9-3.0:1, sotto il minimo WCAG AA di 4.5:1 per testo normale) e' usato 692 volte nel codice, spesso non per icone ma per testo che porta informazione. Caso rappresentativo: le etichette dei KPI finanziari 'Saldo oggi', 'Da pagare', 'Scaduto', 'Prossimi 7gg', 'Saldo proiettato' sono text-[10px] text-slate-400 uppercase (righe 2672-2688) — 10px + contrasto insufficiente per le label dei numeri piu' importanti della pagina, illeggibili all'aperto su smartphone. Altri file con uso pesante: Dipendenti.tsx (64 occorrenze), TesoreriaManuale.tsx (54), Outlet.tsx (37), Impostazioni.tsx (37), BudgetControl.tsx (33), ContoEconomico.tsx (30), Fornitori.tsx (28), Fatturazione.tsx (28).

**Fix proposto:** Regola di sistema: text-slate-400 riservato a icone decorative e placeholder di input; per qualsiasi testo leggibile usare almeno text-slate-500 (#64748b, 4.76:1, AA-compliant). Per le label KPI di riga 2672-2688: text-[11px] o text-xs + text-slate-500.

### ALTA-26 · `src/pages/ScadenzarioSmart.tsx:3603` — Badge informativi a 10px nella tabella principale dello scadenzario

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** Nella tabella scadenze (la piu' usata dell'app) le informazioni operative sono rese a 10px: badge banca di pagamento 'Pagato su ...' e 'Off-system' con text-[10px] (righe 3603 e 3607), bottone categoria con text-[10px] (riga 3620), e placeholder stato in text-[11px] text-slate-300 (riga 3611, contrasto ~1.9:1). Su viewport 360-430px 10px e' sotto la soglia di leggibilita' comoda: Lilian/Sabrina/Veronica devono zoomare per capire su quale banca e' stata saldata una fattura. Lo stesso pattern text-[10px] su badge/pillole di contenuto si ripete in TesoreriaManuale.tsx (1554, 2769), SchedaContabileFornitore.tsx (984-999), StoricoDistinte.tsx (198), BudgetControl.tsx (502, 548).

**Fix proposto:** Portare i badge informativi a text-xs (12px) come minimo e i placeholder a text-slate-500. Per le pillole nelle tabelle usare text-[11px] solo come floor su desktop e text-xs su mobile (es. 'text-xs' fisso: la differenza di 2px non rompe il layout perche' le pillole sono inline-flex con padding).

### ALTA-27 · `src/pages/ScadenzarioSmart.tsx:3627` — Dropdown stato/categoria clippati dal contenitore overflow-x-auto della tabella

*Area: Modali/drawer/dropdown · Verifica: avversariale*

**Problema (mobile):** I dropdown di cambio stato (riga 3579) e categoria (riga 3627, `absolute z-50 top-full left-1/2 -translate-x-1/2 ... max-h-[280px]`) sono posizionati dentro `<td className="relative">` all'interno del wrapper tabella `overflow-x-auto` (riga 3362). Con `overflow-x: auto` il browser forza anche `overflow-y: auto`: il menu che si apre sulle righe in fondo viene tagliato o costringe a scrollare dentro la tabella. Su mobile, dove la tabella è scrollata orizzontalmente, il menu centrato sulla cella può inoltre finire fuori dall'area visibile. La categorizzazione scadenze è un flusso chiave da telefono.

**Fix proposto:** Renderizzare i dropdown in un portal (`createPortal` su document.body) con posizione calcolata da `getBoundingClientRect()` del trigger e clamp ai bordi viewport, oppure su mobile aprirli come bottom-sheet `fixed inset-x-0 bottom-0`.

### ALTA-28 · `src/pages/ScadenzarioSmart.tsx:4035` — Barra azioni bulk pagamenti fixed bottom-6 finisce sotto la bottom nav mobile e copre le ultime righe

*Area: Fixed/sticky e safe-area, Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** La Floating Action Bar dei pagamenti multipli (`<div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,880px)]">`) è a 24px dal fondo. Su mobile la bottom nav (Layout.tsx:97, alta 56px, stessa z-40 ma renderizzata DOPO nel DOM quindi dipinta sopra) copre i ~32px inferiori della barra: proprio la riga con i pulsanti "Annulla" e il CTA di pagamento (righe 4060-4079), che diventano non tappabili. In più non esiste alcun padding compensativo sulla lista quando la barra appare: la barra copre le ultime righe della tabella scadenze e i loro checkbox (anche su desktop), impedendo di selezionare le ultime fatture.

**Fix proposto:** Su mobile alzare la barra sopra la nav: `bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6`. Quando `selectedIds.size > 0` aggiungere un padding-bottom al contenitore della lista (es. `pb-40`) così le ultime righe restano raggiungibili scrollando.

### ALTA-29 · `src/pages/ScadenzeFiscali.tsx:107` — Input con font 14px (text-sm): iOS Safari fa auto-zoom al focus su tutti i form

*Area: Fixed/sticky e safe-area · Verifica: avversariale*

**Problema (mobile):** Praticamente tutti i campi form dell'app usano `text-sm` (14px), es. l'input Titolo del modal Nuova Scadenza Fiscale (`className="w-full px-3 py-2 border ... text-sm ..."`). iOS Safari esegue lo zoom automatico della pagina quando riceve il focus un input con font-size < 16px: la pagina 'salta', resta zoomata dopo la chiusura della tastiera e l'utente deve fare pinch-out per tornare a vedere il layout. Il pattern è ovunque: GlobalSearch.tsx:173 (input ricerca text-sm), HelpPanel.tsx:176 (textarea chat), Scadenzario.tsx, ScadenzarioSmart.tsx, Fornitori.tsx, TesoreriaManuale.tsx, BudgetControl.tsx e tutti i modal con form. Impatto quotidiano per le store manager che inseriscono dati da smartphone.

**Fix proposto:** Regola globale in src/index.css: `@media (max-width: 767px) { input, select, textarea { font-size: 16px; } }` — evita lo zoom su tutta l'app senza toccare i singoli componenti (le classi text-sm continuano a valere su desktop dove la media query non si applica).

### ALTA-30 · `src/pages/ScadenzeFiscali.tsx:340` — Azioni di scrittura che falliscono in totale silenzio (nessun toast, nessun alert)

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** Il catch di 'Mark paid' (riga 339-341) e di 'Delete' (riga 350-352) contiene SOLO console.error: se la chiamata fallisce, l'utente su smartphone tocca 'segna pagata' su una scadenza fiscale, non succede nulla a schermo e non riceve alcun feedback — puo' credere di aver pagato/registrato quando non e' vero. Stesso pattern: src/pages/Scadenzario.tsx:975 (handleDeleteSupplier: solo console.error, il modal di conferma resta aperto senza spiegazione), src/pages/ScadenzarioSmart.tsx:986 (aggiornamento categoria: `if (err1) { console.error(...); return; }`) e ScadenzarioSmart.tsx:1598 (creazione fornitore). Su touch, dove non c'e' hover ne' devtools, il silenzio equivale a 'tap non funzionante'.

**Fix proposto:** In ogni catch/branch di errore delle azioni di scrittura chiamare il toast gia' disponibile nella pagina (useToast e' gia' importato in ScadenzeFiscali e ScadenzarioSmart): `toast({ type: 'error', message: 'Errore: operazione non salvata. Riprova.' })` e ripristinare lo stato UI precedente (es. richiamare loadData()).

### ALTA-31 · `src/pages/StoreManager.tsx:189` — Dropdown selezione outlet apribile solo con hover

*Area: Modali/drawer/dropdown, Interazioni hover-only · Verifica: avversariale*

**Problema (mobile):** Il menu di cambio outlet usa `hidden group-hover:block` (riga 189) e il bottone trigger ha un onClick no-op (`setSelectedOutlet((current) => current)`, riga 182). Su touch non esiste hover: l'apertura dipende dall'emulazione hover del browser mobile (inaffidabile, su alcuni Android non si apre affatto) e il menu resta 'appiccicato' finché non si tocca altrove. È l'unico modo per cambiare punto vendita nella dashboard Store Manager, usata proprio da Sabrina/Veronica da smartphone.

**Fix proposto:** Gestire l'apertura con stato React: `const [menuOpen, setMenuOpen] = useState(false)`, onClick sul trigger che fa toggle, chiusura su selezione e su click-outside (useRef + listener), sostituendo `hidden group-hover:block` con `{menuOpen && (...)}`. Trigger e voci con `min-h-[44px]`.

### ALTA-32 · `src/pages/StoreManager.tsx:209` — StoreManager: grid-cols-12 e KPI grid-cols-4 senza alcun breakpoint

*Area: Layout responsive · Verifica: avversariale*

**Problema (mobile):** Riga 209 `<div className="grid grid-cols-12 gap-6">` con figli `col-span-8` (riga 211) e `col-span-4` (riga 402), senza varianti responsive: su 360px la colonna destra resta ~110px. Dentro, riga 213 `<div className="grid grid-cols-4 gap-4">` crea 4 card KPI da ~45px l'una con valori `text-2xl` (es. €{todayData.incasso.toFixed(2)}) che sbordano; riga 372 `grid grid-cols-3 gap-4` idem. Nel file non esiste alcuna classe sm:/md:/lg: se non sul padding del container (riga 175). E' la pagina pensata proprio per gli store manager che usano lo smartphone (oggi raggiungibile solo via URL /store-manager, non in sidebar).

**Fix proposto:** Riga 209: `grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6`; righe 211/402: `lg:col-span-8` / `lg:col-span-4`; riga 213: `grid grid-cols-2 lg:grid-cols-4 gap-3`; riga 372: `grid grid-cols-1 sm:grid-cols-3 gap-4`.

### ALTA-33 · `src/pages/TesoreriaManuale.tsx:450` — Modali con max-h-[90vh]/[92vh] in unità vh: footer e bottoni tagliati dietro la barra browser (pattern in ~18 file)

*Area: Orientamento e viewport · Verifica: avversariale*

**Problema (mobile):** Il modale generico usa `max-h-[90vh] overflow-y-auto` dentro un overlay `fixed inset-0`. L'overlay è alto quanto il viewport VISIBILE, ma 90vh è calcolato sul viewport 'grande': con barra URL visibile 90vh supera l'altezza disponibile e il fondo del modale (dove stanno i bottoni Salva/Annulla) esce dallo schermo senza poter scrollare la parte tagliata; con la tastiera aperta su un form il problema raddoppia perché vh non si riduce. Stesso pattern in: ScadenzeFiscali.tsx:98, Scadenzario.tsx:95, ScadenzarioSmart.tsx:202, Dipendenti.tsx:244, Fornitori.tsx:1426 e 1588 (h-[85vh]), Contratti.tsx:199 e 458, ImportHub.tsx:1561 e 1657, ArchivioDocumenti.tsx:1060, TicketAdmin.tsx:564 (85vh), TesoreriaManuale.tsx:3562 (85vh), ExportBilancioDialog.tsx:358, ContractUploader.tsx:335, OutletWizard.tsx:650, InvoiceViewer.tsx:490, AccountDetail.tsx:175 (70vh), FinanziamentiTab.tsx:515 (92vh, il caso peggiore).

**Fix proposto:** Sostituire ovunque `max-h-[90vh]` con `max-h-[85dvh]` (o `max-h-[calc(100dvh-2rem)]` dove l'overlay ha p-4). Idealmente estrarre un componente Modal condiviso invece di 18 copie del pattern, così il fix è in un punto solo.

### ALTA-34 · `src/pages/TesoreriaManuale.tsx:875` — Griglie form fisse (grid-cols-2/3) dentro le modali: campi ~75px su smartphone

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Nella modale Nuovo Conto Bancario la riga Tipo/Saldo attuale/Fido usa `grid grid-cols-3 gap-4` senza breakpoint (riga 875); la modale (Modal riga 449-450, overlay p-4 + body p-6) lascia ~280px di contenuto su un viewport 360px: ogni campo scende a ~72-75px, e gli importi a 6 cifre non sono ne' leggibili ne' editabili. Pattern identico (grid-cols-2/3/4 senza `sm:`) verificato in molte altre modali di form: src/pages/Fornitori.tsx:1437/1464/1481/1497/1529, src/pages/Fatturazione.tsx:824/847/866, src/pages/Contratti.tsx:215/242/254, src/pages/Scadenzario.tsx:211/232/401/503/523, src/components/OutletWizard.tsx:105/113, src/pages/Dipendenti.tsx:1684, src/pages/Impostazioni.tsx:1540, src/pages/OpenToBuy.tsx:257/278.

**Fix proposto:** Sostituire sistematicamente `grid grid-cols-N` con `grid grid-cols-1 sm:grid-cols-N` (o `grid-cols-2 sm:grid-cols-3` per coppie corte tipo Provincia/CAP) in tutti i form dentro modali e wizard. Su mobile i campi vanno impilati a colonna singola piena larghezza.

### ALTA-35 · `src/pages/TesoreriaManuale.tsx:885` — Campi importo type=number + parseFloat: la virgola decimale italiana produce 0 silenzioso

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Il campo Saldo attuale (riga 885) e Fido (riga 890) usano `type="number" step="0.01"` con `onChange={... parseFloat(e.target.value) || 0}`. Su tastiera mobile italiana l'utente digita la virgola come separatore decimale ("1234,50"): in un input type=number il valore diventa non valido, `e.target.value` torna stringa vuota e lo state viene riscritto a 0 senza alcun avviso. Stesso pattern su: src/pages/ScadenzarioSmart.tsx:4532 e 4825 (importo scadenza e rate, `Number(e.target.value)`), src/components/SupplierAllocationEditor.tsx:518 e 557 (percentuali e importi split), src/pages/AcubeFatturaForm.tsx:190 e 196 (quantita' e prezzo unitario fattura SDI, dove uno 0 silenzioso finisce in fattura). Il repo ha gia' il pattern corretto altrove: `type="text" inputMode="decimal"` in src/pages/BudgetControl.tsx:2310, src/components/OutletValutazione.tsx:75, src/components/FinanziamentiTab.tsx:548.

**Fix proposto:** Allineare tutti i campi importo/percentuale al pattern gia' usato in BudgetControl/OutletValutazione: `type="text" inputMode="decimal"` (tastierino numerico con virgola su mobile) + parsing che normalizza la virgola (`value.replace(',', '.')`) prima di parseFloat, senza fallback `|| 0` distruttivo (tenere lo state come stringa e validare al salvataggio).

### ALTA-36 · `src/pages/Ticket.tsx:1135` — URL Edge Function ticket-resolve-now letto da VITE_SUPABASE_URL senza resolver tenant

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** `const supabaseUrl = import.meta.env.VITE_SUPABASE_URL` senza fallback a getCurrentTenant(): sui site Made/Zago che definiscono solo le var suffissate (design di tenants.ts) il valore e' undefined e la fetch diventa `undefined/functions/v1/ticket-resolve-now` → il bottone AutoFix AI dei ticket fallisce sempre su Made/Zago. La pagina Segnalazioni e' proprio quella usata da Sabrina/Veronica da smartphone su tutti e 3 i tenant: il bottone funziona su NZ e si rompe sugli altri due, divergenza silenziosa (errore di rete generico).

**Fix proposto:** Usare `const { supabaseUrl } = getCurrentTenant()` (import da ../lib/tenants), come in Fatturazione.tsx e Impostazioni.tsx:1372. Valutare un lint/grep in CI che vieti `import.meta.env.VITE_SUPABASE_URL` fuori da src/lib/tenants.ts.

---

## 🟡 MEDIA — 50 finding

### MEDIA-1 · `src/components/ExportBilancioDialog.tsx:23` — jsPDF + jspdf-autotable + xlsx caricati con la pagina Budget anche senza export

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** ExportBilancioDialog importa staticamente xlsx (riga 23), jspdf (riga 24) e jspdf-autotable (riga 25), ed e' a sua volta importato staticamente da BudgetControl.tsx:25. Il chunk della pagina Budget si porta quindi dietro ~800KB min (~250KB gzip) di librerie di export che servono solo quando l'utente clicca 'Esporta' — su mobile e' puro peso morto a ogni visita della pagina Budget.

**Fix proposto:** In BudgetControl: `const ExportBilancioDialog = lazy(() => import('../components/ExportBilancioDialog'))` renderizzato sotto Suspense solo quando il dialog e' aperto (riga 1938); oppure dynamic import di xlsx/jspdf dentro le funzioni di export del dialog.

### MEDIA-2 · `src/components/FinancialTooltip.tsx:63` — Popover glossario largo 256px centrato sull'icona: esce dallo schermo ai bordi

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** Il tooltip usa classi fisse "absolute bottom-full left-1/2 -translate-x-1/2 w-64": è sempre centrato sull'icona ? senza clamping al viewport. Nelle KpiCard della Dashboard (grid a 2 colonne su mobile, Dashboard.tsx:686) l'icona "Margine netto" sta nella colonna destra a ~90px dal bordo: metà dei 256px del popover finisce fuori schermo e il testo del glossario è tagliato (o causa overflow orizzontale della pagina). Il pattern tocca ogni pagina che usa FinancialTooltip vicino ai bordi.

**Fix proposto:** Clampare la posizione: max-w-[calc(100vw-16px)] e riposizionamento dinamico (misurare getBoundingClientRect e applicare left-0/right-0 invece di left-1/2 quando trabocca), oppure usare position: fixed centrato nel viewport su schermi < 480px.

### MEDIA-3 · `src/components/GlobalSearch.tsx:65` — Ricerca globale: ESC non chiude in modalita' controllata e mancano le semantiche dialog

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** L'handler che chiude con Escape (riga 71) e' registrato solo se `openProp === undefined` (early return riga 65). Layout.tsx:363 passa sempre `open={searchOpen}`, quindi in produzione Escape NON chiude mai l'overlay, mentre l'UI mostra il tasto `<kbd>ESC</kbd>` (riga 175) come suggerimento. L'overlay inoltre non ha role="dialog"/aria-modal e non restituisce il focus al bottone di ricerca alla chiusura.

**Fix proposto:** Registrare l'handler Escape anche in modalita' controllata (chiamando onClose), aggiungere role="dialog" aria-modal="true" aria-label="Ricerca globale" al contenitore e ripristinare il focus sul trigger alla chiusura.

### MEDIA-4 · `src/components/HelpPanel.tsx:211` — Elenchi puntati delle guide collassati in un unico blocco (manca whitespace-pre-line)

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** Il body delle sezioni guida è renderizzato in `<p className="text-sm text-slate-600 leading-relaxed">{s.body}</p>` senza `whitespace-pre-line`. Ma in src/data/pageGuides.ts almeno 3 body usano `\n\n•` per elenchi puntati: riga 1375 (/import-hub, 'Le fonti di importazione disponibili'), riga 2102 e riga 2110 (/report-sincronizzazioni). In HTML i \n collassano in spazi: l'utente vede un unico paragrafo con i pallini '•' incollati nel testo, illeggibile soprattutto nel pannello largo ~312px su un telefono da 360px. Nota: la chat AI ha già `whitespace-pre-wrap` (riga 147), la tab Guida no.

**Fix proposto:** Aggiungere `whitespace-pre-line` alla classe del <p> del body (riga 211 di HelpPanel.tsx); in alternativa convertire quei body in `steps[]`, che GuideView renderizza già come lista puntata.

### MEDIA-5 · `src/components/InvoiceViewer.tsx:213` — Tabelle del viewer fattura (6 colonne) senza scroll orizzontale nel modale

*Area: Layout responsive, Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** Riga 213 `<table className="w-full text-xs border-collapse">` con 6 colonne (#, Descrizione, Qta', Prezzo un., Totale, IVA %) sta nel modale riga 490 (`max-w-3xl ... mx-4`): su 360px l'area utile e' ~330px e le colonne numeriche si riducono a ~40px con importi spezzati. Stesso problema per le tabelle alle righe 244 (Riepilogo IVA) e 289 (Dati pagamento, che include la colonna IBAN, lunga per natura). Anche la riga 184 `grid grid-cols-2 gap-6` (Cedente/Cessionario) comprime le due anagrafiche a ~140px l'una. Il viewer si apre dallo smartphone quando si consulta una fattura elettronica.

**Fix proposto:** Avvolgere le tre tabelle in `<div className="overflow-x-auto">` con `min-w-[480px]` sulla tabella; riga 184: `grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6`.

### MEDIA-6 · `src/components/Layout.tsx:34` — Istruzioni per cambiare tenant invisibili su touch (solo title hover + hidden md:inline)

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Il TenantBadge esiste apposta per Sabrina/Veronica che alternano i 3 tenant (commento righe 19-22), ma l'unica spiegazione su COME cambiare tenant ('apri una nuova tab con un altro subdomain') sta nell'attributo `title` (riga 29, hover-only, inesistente su touch) e nello span `hidden md:inline` (righe 34-36, nascosto sotto 768px). Proprio sugli smartphone delle store manager multi-tenant il badge mostra solo colore e nome, senza nessun modo per scoprire come passare a Made/Zago.

**Fix proposto:** Rendere il badge tappabile su mobile: onClick apre un piccolo popover/bottom sheet con il testo 'Per cambiare tenant apri una nuova tab' ed eventualmente i link diretti ai 3 subdomain (derivabili staticamente dagli hostname in tenants.ts:86-99).

### MEDIA-7 · `src/components/Layout.tsx:86` — Breadcrumb nascosto su mobile: nessuna indicazione di posizione nell'header

*Area: Navigazione · Verifica: avversariale*

**Problema (mobile):** Il breadcrumb dell'header e' `hidden sm:flex`: sotto 640px sparisce del tutto e la top bar mobile mostra solo hamburger + select anno + icone, senza alcun titolo di pagina o sezione. L'orientamento resta affidato al solo PageHeader dentro il contenuto, che pero' scrolla via con la pagina (non e' sticky): dopo due swipe l'utente su smartphone non ha piu' alcun riferimento su quale delle ~25 pagine sta guardando, in un'app con 7 sezioni di menu.

**Fix proposto:** Su mobile mostrare almeno il nome pagina corrente al posto del breadcrumb completo: es. `<nav className="flex sm:hidden ..."><span className="text-slate-700 font-medium truncate">{crumb.page}</span></nav>` accanto all'hamburger, con truncate per i titoli lunghi (gia' disponibile crumb dal buildBreadcrumbMap).

### MEDIA-8 · `src/components/Layout.tsx:101` — Bottom nav ignora ruoli e terminologia tenant

*Area: Navigazione, Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Le 4 voci della BottomNav (righe 100-103) sono hardcoded per tutti gli utenti, mentre la Sidebar filtra per ruolo: '/outlet' e' negato a cfo/contabile e '/scadenzario' a coo (Sidebar.tsx righe 80 e 91), ma da mobile chiunque li vede e li apre perche' le route in App.tsx non hanno guard di ruolo (App.tsx righe 111-116). Risultato: da telefono un utente raggiunge pagine che da desktop gli sono nascoste (incoerenza di autorizzazione UI, i dati restano protetti da RLS ma la pagina si carica). Inoltre la label 'Outlet' e' fissa e non usa useCompanyLabels(): sui tenant Made/Zago la sidebar dice 'Negozi' ma la bottom nav continua a dire 'Outlet'.

**Fix proposto:** Costruire le voci della BottomNav filtrando con gli stessi `roles` di buildSections (o esportando una whitelist condivisa da Sidebar.tsx) e usare useCompanyLabels() per la label del punto vendita, come gia' fa la Sidebar.

### MEDIA-9 · `src/components/NotificationBell.tsx:208` — Target touch minuscoli annidati in righe cliccabili (X da ~17px)

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Il bottone 'Elimina notifica' e' `p-0.5` con icona X size={12}: area di tocco ~17x17px, molto sotto i 44px raccomandati (WCAG 2.5.8 minimo 24px), e per giunta annidato dentro una riga con onClick di navigazione (riga 195-198): su smartphone mancare la X di pochi px naviga altrove e chiude il pannello. Idem il bottone 'Letta' (riga 230, testo 10px) e, stesso pattern, la X dei modali `p-1` (es. ScadenzarioSmart.tsx:205).

**Fix proposto:** Portare i bottoni icona ad almeno 40x40px (`p-2.5` con icona 16-18, o `min-w-[44px] min-h-[44px]` su mobile) e distanziarli dall'area cliccabile della riga.

### MEDIA-10 · `src/components/OutletWizard.tsx:656` — Bottoni di chiusura X con touch target 26-33px (< 44px raccomandati)

*Area: Modali/drawer/dropdown · Verifica: avversariale*

**Problema (mobile):** Pattern diffuso: la X di chiusura è `p-1` o `p-1.5` con icona 16-20px, quindi area toccabile ~26-33px, sotto il minimo touch di 44px. Occorrenze verificate: OutletWizard.tsx:656 (`p-1` + X 20), ScadenzarioSmart.tsx:205 (`p-1`), Ticket.tsx:466 (`p-1`), InvoiceViewer.tsx:505 (`p-1.5` + X 18), Fatturazione.tsx:815 (`p-1.5`), Fornitori.tsx:1431 e 1603 (`p-1.5`), AccountDetail.tsx:184 (`p-1.5` + X 16). Su smartphone chiudere un modale richiede più tentativi o tap accidentali sui bottoni adiacenti (es. 'Stampa/PDF' in InvoiceViewer).

**Fix proposto:** Portare tutti i bottoni di chiusura a `p-2.5`/`p-3` o aggiungere `min-w-[44px] min-h-[44px] flex items-center justify-center`; idealmente standardizzare un componente CloseButton condiviso.

### MEDIA-11 · `src/components/PdfViewer.tsx:218` — PDF zoomato: lato sinistro irraggiungibile (overflow-auto + justify-center) e nessun pinch-to-zoom

*Area: Gesti e scroll · Verifica: avversariale*

**Problema (mobile):** Il canvas del PDF sta in `<div className="flex-1 overflow-auto flex justify-center p-4">`. Con flexbox, quando il contenuto e' piu' largo del contenitore, `justify-center` fa sbordare il contenuto simmetricamente ma l'overflow a SINISTRA dell'origine non e' raggiungibile con lo scroll: su uno schermo da 360px, appena si zooma oltre il 100% (bottoni riga 197-211, scala fino a 3x) la meta' sinistra della fattura/contratto diventa fisicamente invisibile. Inoltre lo zoom e' gestito solo da due bottoncini `p-1.5` nella toolbar: nessun supporto pinch o doppio tap, i gesti touch naturali zoomano l'intera pagina del browser.

**Fix proposto:** Sul wrapper del canvas usare `block` con canvas `mx-auto` e `min-w-max` su un inner wrapper (es. `<div className="min-w-max mx-auto">`) cosi' l'overflow parte da sinistra ed e' tutto scrollabile; aggiungere gestione pinch con `onTouchStart/onTouchMove` (due dita -> setScale) o almeno doppio tap per alternare 1x/2x, con `touch-action: pan-x pan-y` sul contenitore.

### MEDIA-12 · `src/components/Sidebar.tsx:519` — Drawer mobile della sidebar senza semantica dialog ne' gestione focus

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** Il drawer mobile (righe 518-525) e' un div `fixed inset-0 z-50` con overlay `<div onClick={...}>` (riga 520): l'overlay di chiusura non e' un bottone (invisibile a screen reader e tastiera), il drawer non ha role="dialog"/aria-modal, il focus resta sul contenuto sottostante (che non viene reso inert) e non c'e' chiusura con Escape. L'hamburger che lo apre (Layout.tsx:318) non ha aria-expanded/aria-controls.

**Fix proposto:** Marcare il drawer role="dialog" aria-modal="true" aria-label="Menu", spostare il focus sul primo elemento all'apertura e restituirlo all'hamburger alla chiusura, aggiungere handler Escape, e sostituire l'overlay con un <button aria-label="Chiudi menu"> o aggiungere l'attributo inert al main.

### MEDIA-13 · `src/components/Toast.tsx:178` — Toast largo 384px fisso: deborda dal viewport a 360px e taglia il pulsante di chiusura

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** Il toast usa `rounded-lg p-4 w-96 max-w-sm`: w-96 = 384px e max-w-sm = 384px, quindi larghezza effettiva sempre 384px. Il container (riga 101) e' `fixed top-6 left-1/2 -translate-x-1/2` senza alcun padding laterale ne' vincolo sul viewport: su schermi 360-375px il toast sborda di 5-12px per lato, il bordo colorato da 3px e la X di chiusura (riga 206-212) finiscono parzialmente fuori schermo e possono generare overflow orizzontale della pagina proprio mentre l'utente legge un errore.

**Fix proposto:** Sostituire `w-96 max-w-sm` con `w-[calc(100vw-2rem)] max-w-sm` (o `w-full max-w-sm` + `px-4 w-full` sul container di riga 101), cosi' su mobile il toast resta dentro il viewport con 16px di margine e su desktop mantiene i 384px attuali.

### MEDIA-14 · `src/components/ui/KpiCard.tsx:91` — Testo troncato con solo attributo title nativo: informazione persa su touch

*Area: Interazioni hover-only · Verifica: avversariale*

**Problema (mobile):** Il valore della KPI card e' '<p class="text-2xl font-bold truncate" title={String(value)}>' (riga 91, idem riga 90 per il titolo): se su viewport 360px il numero viene troncato, il valore completo esiste SOLO nel title nativo, che su touch non viene mai mostrato — l'utente vede un importo mutilato senza modo di leggerlo. Stesso pattern (truncate + solo title, elemento non interattivo) in: src/components/OpenBankingAcube.tsx:340 (IBAN troncato), src/pages/Impostazioni.tsx:1031 (note categoria, max-w-[150px]), src/pages/Impostazioni.tsx:1511 (endpoint URL), src/pages/Dashboard.tsx:939 (nome outlet). Nota: il design system del progetto stesso vieta i title nativi (commento in Tooltip.tsx righe 8-10), ma qui sono rimasti come unico veicolo.

**Fix proposto:** Per i valori numerici KPI: evitare il truncate riducendo il font responsivamente (es. 'text-xl sm:text-2xl' + tabular-nums) o formattando in notazione compatta su mobile. Per gli altri casi: sostituire il title nativo con il componente condiviso Tooltip (una volta reso touch-friendly, vedi finding su Tooltip.tsx) o mostrare il testo completo con 'break-all'/wrap su mobile.

### MEDIA-15 · `src/components/ui/SortableTh.tsx:50` — Header ordinabili: th cliccabile senza aria-sort ne' tastiera, hint solo su hover

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** L'ordinamento e' un `onClick` direttamente sul `<th>` (righe 49-55): non focusabile, non attivabile da tastiera, nessun `aria-sort` sullo stato corrente (lo stato e' comunicato solo dal colore blu dell'icona). L'istruzione d'uso e' nel `title` (riga 54) — invisibile su touch — e prescrive 'Shift+Click per ordinamento multiplo', impossibile su smartphone. Componente condiviso da tutte le tabelle dell'app.

**Fix proposto:** Inserire un <button> dentro il th con aria-label descrittivo, aggiungere `aria-sort={active ? (dir==='asc'?'ascending':'descending') : 'none'}` sul th, e prevedere un'alternativa touch al multi-sort (es. tap lungo o menu ordinamento).

### MEDIA-16 · `src/data/pageGuides.ts:115` — Guide utente e assistente AI usano 'Outlet' fisso, divergendo dai nomi pagina di Made/Zago

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Le guide hardcodano la terminologia NZ in 12 occorrenze ('Outlet operativi' riga 115, 'Confronto Outlet' riga 234, 'Analisi Margini per Outlet' riga 280, FAQ righe 214-223, 356-357), mentre i nomi visibili in sidebar/breadcrumb sono terminology-driven (Sidebar.tsx:81 `Confronto ${posPlural}`). Su Made/Zago il pannello '?' e l'assistente AI help-chat (che riceve la guida come contesto) dicono all'utente di aprire pagine chiamate 'Confronto Outlet' che nel suo menu si chiamano 'Confronto Punti vendita': il canale di auto-aiuto, il piu' usato da mobile dove non c'e' nessuno accanto, da' istruzioni con nomi che non corrispondono.

**Fix proposto:** Introdurre placeholder nelle guide (es. {pos}/{posPlural}) e risolverli a runtime con useCompanyLabels sia nel HelpPanel sia nel payload inviato a help-chat; in alternativa una funzione `localizeGuide(guide, labels)` che fa replace dei termini prima del render.

### MEDIA-17 · `src/data/pageGuides.ts:385` — Guida Scadenzario: paragrafo monolitico da ~1800 caratteri illeggibile da telefono

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** La prima sezione della guida '/scadenzario' (la pagina più usata da Sabrina) ha un body di un solo paragrafo di ~1800 caratteri che mescola 8+ argomenti (tab, stati colorati, filtri, viste Mese/Lista/Calendario, ordinamenti, note di credito) senza `steps`. Nel pannello largo ~312px su smartphone diventa un muro di ~40 righe di testo. Stesso pattern in altre voci: riga 389 (Scadenzario, 1105 car.), righe 575 e 585 (/banche, 1206 e 1290 car.), riga 1375 (/import-hub, 1343 car.), riga 2110 (/report-sincronizzazioni, 1390 car.).

**Fix proposto:** Spezzare i body oltre ~600 caratteri in più sezioni con heading propri e spostare le sequenze operative nel campo `steps` (che GuideView rende come lista puntata compatta, molto più leggibile su mobile).

### MEDIA-18 · `src/pages/AcubeFatturaForm.tsx:148` — Form a colonne fisse (grid-cols-3/2) senza breakpoint: input da ~90px

*Area: Layout responsive · Verifica: avversariale*

**Problema (mobile):** Riga 148 `<div className="grid grid-cols-3 gap-4">` mette Numero/Data/Tipo su 3 colonne fisse: su 360px (meno padding card p-5) ogni input e' ~85-90px, il date-picker nativo iOS non mostra nemmeno la data completa. Anche riga 115 `grid grid-cols-2 gap-4` con dentro (riga 131) un ulteriore `grid grid-cols-2 gap-2` per Provincia/CAP. Stesso pattern nei form/modali: src/components/OutletWizard.tsx (righe 105-304, numerosi `grid grid-cols-2 gap-4` e riga 154 `grid grid-cols-3 gap-4`), src/pages/TesoreriaManuale.tsx:875 (`grid grid-cols-3 gap-4`), src/pages/Fatturazione.tsx:847 (`grid grid-cols-3 gap-3`).

**Fix proposto:** Usare `grid grid-cols-1 sm:grid-cols-3 gap-4` (e `grid-cols-1 sm:grid-cols-2`) per i campi form, lasciando eventualmente su 2 colonne fisse solo coppie corte come Provincia/CAP.

### MEDIA-19 · `src/pages/AnalyticsPOS.tsx:526` — BarChart raggruppato 12 mesi x N outlet: barre da ~2px illeggibili su smartphone

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** Il grafico "Numero Scontrini per outlet - Trend Mensile" renderizza una <Bar> per ogni outlet (outletData.map, riga 526) affiancate per ciascuno dei 12 mesi: con i 7 outlet NZ sono 84 barre in un plot che su 360px è ~270px utili, cioè ~2-3px per barra. Le barre diventano trattini indistinguibili e il tap per il tooltip è impreciso. In più la <Legend /> default (riga 525) con 7 nomi outlet va a capo su più righe rubando spazio all'altezza fissa di 400px.

**Fix proposto:** Su mobile passare a barre impilate (stackId comune) oppure aggiungere un selettore outlet (singolo o "tutti aggregati") già usato in altre pagine; in alternativa ridurre il periodo mostrato (ultimi 6 mesi) sotto una media query e usare ModernLegend.

### MEDIA-20 · `src/pages/ArchivioDocumenti.tsx:1353` — Azioni 'Estendi'/'Archivia' conservazione visibili solo su hover della riga

*Area: Interazioni hover-only · Verifica: avversariale*

**Problema (mobile):** Nella tabella conservazione documenti i bottoni 'Estendi' (riga 1355) e 'Archivia' (riga 1363) — le uniche azioni per gestire un documento con retention scaduta — sono dentro un div 'opacity-0 group-hover:opacity-100' (riga 1353). Su touch i bottoni restano invisibili (opacity-0 li lascia tappabili ma nessuno sa che ci sono): da smartphone e' impossibile scoprire come estendere o archiviare la conservazione di un documento scaduto. Non esiste percorso alternativo per queste azioni.

**Fix proposto:** Rendere i bottoni sempre visibili (rimuovere 'opacity-0 group-hover:opacity-100', eventualmente attenuandoli con 'opacity-60 group-hover:opacity-100'), oppure applicare l'occultamento solo dove esiste l'hover: classi 'opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'.

### MEDIA-21 · `src/pages/BudgetControl.tsx:1932` — Toast di pagina fixed bottom-6 right-6 z-50: su mobile coprono la bottom nav e spariscono dietro la tastiera

*Area: Fixed/sticky e safe-area · Verifica: avversariale*

**Problema (mobile):** Molte pagine hanno un toast locale in basso a destra (`fixed bottom-6 right-6 z-50 px-4 py-3 ...`). Su mobile z-50 > z-40 della bottom nav: il toast si sovrappone ai tab 'Scadenze'/'Profilo' rendendoli non tappabili per la sua durata. Inoltre, essendo fixed ancorato al layout viewport, con la tastiera virtuale aperta (scenario tipico: si salva un form e appare la conferma) il toast resta dietro la tastiera e il feedback 'Salvato'/'Errore' non viene mai visto. Stesso pattern in: src/pages/Fornitori.tsx:1615, src/pages/ArchivioDocumenti.tsx:233, src/pages/Impostazioni.tsx:28, src/pages/ImportHub.tsx:1547, src/components/OutletValutazione.tsx:484.

**Fix proposto:** Unificare sul Toast globale top-center già esistente (src/components/Toast.tsx, useToast) che non collide con nav né tastiera; in alternativa, come minimo, spostare questi toast su mobile con `bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6`.

### MEDIA-22 · `src/pages/BudgetControl.tsx:2337` — Trigger popover 'Copia mese' di ~16px e popover con controlli minuscoli

*Area: Modali/drawer/dropdown · Verifica: avversariale*

**Problema (mobile):** Il bottone che apre CopyMonthPopover è `p-0.5` con icona `Copy size={11}` (righe 2335-2338): area toccabile ~16px, praticamente impossibile da centrare col dito. Il popover stesso (riga 2163, `absolute right-0 ... w-56`) ha bottoni mese `px-1.5 py-1 text-[10px]` e azioni `text-[10px]` (righe 2170-2188), tutti ben sotto i 30px di altezza: selezionare i mesi su smartphone è frustrante e soggetto a tap errati su un'operazione che scrive dati di budget.

**Fix proposto:** Aumentare il trigger a `p-2` con icona 16px; nel popover portare i bottoni mese a `py-2 text-xs` e le azioni a `py-2`; su viewport < 640px valutare l'apertura come modale centrato invece che popover ancorato alla cella.

### MEDIA-23 · `src/pages/BudgetControl.tsx:3234` — Matrice corrispettivi: una colonna di input numerici per ogni outlet, inserimento touch difficile

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella corrispettivi genera una colonna per ciascun outlet (7 outlet reali = 9 colonne totali con Tipologia e Totale mese, righe 3238-3244) e ogni cella contiene un `NumberInputIt` editabile (riga 3258). A 360px l'inserimento dei corrispettivi richiede scroll orizzontale tra input; il focus su un input con tastiera aperta rende quasi impossibile capire su quale outlet si sta scrivendo, perché l'intestazione di colonna esce dal viewport.

**Fix proposto:** Su mobile ruotare la matrice: una card per outlet con i due input Preventivo/Consuntivo impilati, oppure un layout verticale outlet-per-riga (outlet in prima colonna sticky e sole 2 colonne di input).

### MEDIA-24 · `src/pages/CashFlow.tsx:436` — Titoli h1 text-4xl/3xl non responsivi che sprecano il viewport mobile

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** h1 'text-4xl font-bold' fisso (36px) + sottotitolo + mb-8 (riga 436): su un viewport 360px il blocco header consuma ~120px prima di qualsiasi dato, e 'Cash Flow Forecast' a 36px puo' andare a capo. Stesso pattern non responsivo in OpenToBuy.tsx:145 (text-4xl), AnalyticsPOS.tsx:293, StockSellthrough.tsx:249, StoreManager.tsx:158 e Onboarding.tsx:317 (text-3xl). Incoerente con lo standard del progetto PageHeader.tsx (text-2xl, riga 26) usato dalle altre pagine — StoreManager e' proprio la pagina pensata per le store manager da smartphone.

**Fix proposto:** Sostituire con il componente PageHeader esistente, oppure rendere responsivo il titolo: 'text-2xl md:text-4xl' e ridurre mb-8 a mb-4 su mobile ('mb-4 md:mb-8').

### MEDIA-25 · `src/pages/CashFlow.tsx:572` — Soglia critica 50.000 EUR disegnata con <line> SVG grezzo: non viene mai visualizzata

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** Dentro l'AreaChart c'è <line x1="0" y1="50000" x2="100%" y2="50000" stroke="#f43f5e"/>: le coordinate di un elemento SVG grezzo sono pixel, non valori dati, quindi la linea viene disegnata a y=50000px, fuori dal canvas (alto 350px). La didascalia alla riga 575 promette "Linea rossa: soglia critica 50.000€" ma la linea non appare mai, su nessun device — su mobile l'utente cerca un riferimento visivo che non esiste. ReferenceLine è importata alla riga 4 ma mai usata.

**Fix proposto:** Sostituire con <ReferenceLine y={50000} stroke="#f43f5e" strokeDasharray="5 5" /> (componente già importato), che mappa il valore 50000 sulla scala dell'asse Y.

### MEDIA-26 · `src/pages/CashflowProspettico.tsx:1797` — interval={0} forza tutte le etichette dell'asse X: sovrapposizione su 360px

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** XAxis usa interval={viewMode === 'giornaliero' ? 2 : 0}: in vista mensile forza tutte e 12 le etichette orizzontali (angle=0) a fontSize 12 — su plot mobile ~270px ogni categoria ha ~22px mentre "Gen"/"Mag" a 12px ne occupano ~24-28, quindi le etichette si toccano/sovrappongono. In vista settimanale forza 13 etichette ruotate a -45 e in giornaliera ~10: leggibili a fatica ma la mensile è la peggiore perché non ruotata.

**Fix proposto:** Non forzare interval={0} sulla vista mensile: usare interval="preserveStartEnd" o minTickGap={20} sotto i 480px (media query), oppure applicare anche alla mensile angle=-45 con height=60 e fontSize 10 come già fatto per le altre viste.

### MEDIA-27 · `src/pages/ConfrontoOutlet.tsx:1294` — Asse X con 7 nomi outlet: tick auto-nascosti e barre non identificabili senza legenda

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** XAxis dataKey="name" con i nomi outlet (shortOutletName, es. "Valdichiana", "Franciacorta", ~10-12 caratteri a fontSize 11 ≈ 60-70px l'uno). Su plot mobile ~270px recharts (interval auto) nasconde i tick sovrapposti: si vedono solo 2-3 nomi su 7 e le altre barre restano anonime — non c'è Legend e il colore è per-outlet (Cell riga 1298), quindi senza etichetta la barra non è attribuibile se non tappandola. Identico problema nel grafico gemello "Margine per outlet" (riga 1321) e nei BarChart per outlet di src/pages/Produttivita.tsx (righe 623 e 649, dataKey "nome").

**Fix proposto:** Su mobile usare layout="vertical" (nomi outlet sull'asse Y leggibili per esteso, come già fatto in Fornitori.tsx) oppure tick ruotati (angle=-35, textAnchor="end", height maggiore) con interval={0} e font 10.

### MEDIA-28 · `src/pages/ContoEconomico.tsx:3101` — Confronto YoY: importi anno precedente a 10px e delta % a 9px

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** Nel conto economico con confronto anno precedente, gli importi YoY delle righe non-macro sono 'text-[10px] text-slate-400' (riga 3101) — doppia penalita': 10px + contrasto ~3:1 — e il badge delta percentuale scende a 'text-[9px]' (riga 3108) per le righe di dettaglio. Sono dati finanziari primari (il motivo per cui si attiva il confronto YoY), non metadati: su smartphone risultano illeggibili e i numeri tabellari a 9-10px si confondono tra loro (3/8, 5/6).

**Fix proposto:** Minimo text-[11px] per gli importi YoY con text-slate-500, e text-[10px] come floor assoluto per il badge delta (mai 9px). In alternativa su mobile nascondere la colonna YoY e mostrare solo il delta % a dimensione leggibile.

### MEDIA-29 · `src/pages/Dipendenti.tsx:42` — Import statico di lib/pdfText vanifica il lazy loading di PdfViewer in Dipendenti

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Dipendenti.tsx:42 importa staticamente `extractPdfLines/extractPdfItems` da ../lib/pdfText, che alla riga 1 fa `import * as pdfjsLib from 'pdfjs-dist'` e alle righe 4-7 configura subito il worker. Risultato: pdfjs-dist finisce comunque nel chunk della pagina Dipendenti e il `lazy()` di PdfViewer alla riga 54 non risparmia nulla — il costo (~350KB gzip) viene pagato all'apertura della pagina su mobile, non al primo upload di un cedolino PDF.

**Fix proposto:** Caricare pdfText on-demand nell'handler di upload: `const { extractPdfLines, extractPdfItems } = await import('../lib/pdfText')`. Le funzioni sono gia' async quindi il call-site cambia pochissimo.

### MEDIA-30 · `src/pages/Fatturazione.tsx:761` — Righe tabella e card cliccabili senza role/tabIndex/tastiera (pattern diffuso)

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** La `<tr onClick={() => openFormatted(inv)} className="...cursor-pointer">` apre il dettaglio fattura ma non e' focusabile ne' attivabile da tastiera o da screen reader touch (TalkBack non la espone come elemento attivabile: doppio tap non fa nulla). Stesso pattern alla riga 761 e in ~80 occorrenze di div/tr cliccabili in 22 file: NotificationBell.tsx:195-198 (riga notifica che naviga), Scadenzario.tsx, TesoreriaManuale.tsx, ContoEconomico.tsx, Outlet.tsx, Contratti.tsx, Fornitori.tsx, GlobalSearch.tsx (backdrop), ecc.

**Fix proposto:** Aggiungere `role="button" tabIndex={0}` e onKeyDown (Enter/Spazio) alle righe cliccabili, come gia' fatto correttamente in ui/KpiCard.tsx:69-70, oppure inserire nella prima cella un vero <button>/<a> che copre la riga (pattern stretched-link).

### MEDIA-31 · `src/pages/Impostazioni.tsx:266` — Form soci: label solo come placeholder e riga a larghezze fisse che sborda su 360px

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Nella sezione soci gli input Nome/Ruolo/Quota % (righe 266-271) non hanno label visibile ne' aria-label: solo placeholder, che scompare appena si digita — su schermo piccolo, con tre campi stretti affiancati, l'utente non sa piu' quale campo sta compilando. Inoltre la riga e' `flex items-center gap-2` con larghezze fisse `w-32` + `w-24` + pulsante: ~240px fissi su ~280px disponibili a 360px, quindi il campo Nome (flex-1) si riduce a ~40px.

**Fix proposto:** Su mobile impilare i campi (`flex-col sm:flex-row` o `grid grid-cols-1 sm:grid-cols-[1fr_8rem_6rem_auto]`) e aggiungere label visibili (o almeno `aria-label`) a ciascun input; `inputMode="decimal"` sulla quota.

### MEDIA-32 · `src/pages/Impostazioni.tsx:629` — Bottoni Modifica/Elimina (utenti, categorie, centri di costo) invisibili senza hover

*Area: Interazioni hover-only · Verifica: avversariale*

**Problema (mobile):** Pattern ripetuto 5 volte nella pagina Impostazioni: bottoni icona Pencil/Trash2 con 'opacity-0 group-hover:opacity-100'. Occorrenze verificate: riga 629 (modifica ruolo utente) e riga 643 (elimina utente) nella gestione utenti; righe 1035 e 1047 (modifica/elimina categoria, variante group-hover/row); riga 1273 (modifica/elimina centro di costo). Su smartphone questi controlli sono invisibili: la gestione utenti/categorie/centri diventa impossibile da mobile perche' l'utente non vede alcuna azione sulla riga (i bottoni sono tappabili ma con opacita' zero, quindi non scopribili).

**Fix proposto:** Stesso rimedio per tutte e 5 le occorrenze: bottoni sempre visibili in tonalita' tenue (es. 'text-slate-300' che diventa colorata su hover), oppure limitare l'occultamento ai dispositivi con hover reale via variante Tailwind arbitraria '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100'.

### MEDIA-33 · `src/pages/MarginiCategoria.tsx:563` — Pie con raggio fisso 120px ed etichette esterne clippate su mobile

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** La torta "Distribuzione Costi per Macro-Gruppo" usa outerRadius={120} fisso (diametro 240px) con label={ModernPieLabel} che disegna il testo a outerRadius+20 (ChartTheme.tsx:262). Su viewport 360px il container utile è ~290px (card p-5 + padding pagina): la torta occupa quasi tutta la larghezza e le etichette esterne (nome macro-gruppo + percentuale) finiscono oltre il bordo dell'SVG e vengono tagliate o rese illeggibili. I nomi dei macro-gruppi (es. "generali_amministrative") sono lunghi e peggiorano il clipping.

**Fix proposto:** Usare outerRadius percentuale (es. outerRadius="65%") così il raggio si adatta al container; su schermi stretti disattivare le etichette esterne (label={undefined} sotto una soglia rilevata con matchMedia/useMediaQuery) e affidarsi alla legenda/tabella sottostante, oppure spostare nome+percentuale in una ModernLegend sotto il grafico.

### MEDIA-34 · `src/pages/Onboarding.tsx:524` — Campi numerici senza inputMode/type dedicato: tastiera completa al posto del tastierino

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Il campo Partita IVA (riga 524) accetta solo cifre (`replace(/\D/g,'')`) ma e' un input testo senza `inputMode="numeric"`: su smartphone si apre la tastiera alfabetica completa per digitare 11 cifre. Stesso problema: Telefono riga 593 senza `type="tel"` (grep conferma 0 occorrenze di type="tel" in tutto src/), Codice SDI riga 578 senza inputMode, e in src/pages/AcubeFatturaForm.tsx la P.IVA cliente (riga 118) e il CAP (riga 139, maxLength 5) senza inputMode="numeric"; in src/pages/Impostazioni.tsx:270 il campo Quota % dei soci e' testo puro senza inputMode="decimal".

**Fix proposto:** Aggiungere `inputMode="numeric"` (P.IVA, SDI numerico, CAP, quota), `type="tel"` sul telefono e `inputMode="decimal"` sui campi percentuale. Modifica a costo zero sul desktop, beneficio immediato per chi inserisce dati da smartphone.

### MEDIA-35 · `src/pages/PrimaNota.tsx:306` — Prima Nota: 8 colonne, a 360px visibili solo Data/Conto/Tipo

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella movimenti ha 8 colonne (Data, Conto Banca, Tipo, Importo, Contropartita, P.IVA, Causale, Categoria — righe 309-316). Il wrapper `overflow-auto max-h-[70vh]` (riga 305) permette lo scroll e l'header sticky funziona, ma a 360px l'utente vede solo le prime 3 colonne: l'Importo e la Contropartita — i dati chiave di un movimento — restano fuori schermo senza alcun indicatore di contenuto nascosto.

**Fix proposto:** Nascondere P.IVA e Causale su mobile (`hidden lg:table-cell`), spostare l'Importo come seconda colonna, e accorpare Contropartita sotto la descrizione del conto. In alternativa card view a due righe per movimento sotto sm.

### MEDIA-36 · `src/pages/Produttivita.tsx:587` — Legend default di recharts con 7 serie outlet dentro altezza fissa del grafico

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** Il LineChart "Trend Mensile Fatturato/Dipendente" crea una Line per ogni outlet (riga 588) e usa <Legend /> default: su 360px i 7 nomi outlet vanno a capo su 3-4 righe che vengono sottratte all'altezza fissa (350px) del ResponsiveContainer, schiacciando l'area dati; gli item della legenda default sono inoltre piccoli e non pensati per il touch. Il progetto ha già ModernLegend (ChartTheme.tsx:228) con flex-wrap e spaziatura corretta, ma il default è usato anche in: AnalyticsPOS.tsx:419 e :525, CashflowProspettico.tsx:1802, Produttivita.tsx:626 e :652, MarginiOutlet.tsx:396, ScenarioPlanning.tsx:657, OpenToBuy.tsx:365, Fornitori.tsx:1364, ContoEconomico.tsx:1969 e :2730.

**Fix proposto:** Uniformare tutte le occorrenze a <Legend content={<ModernLegend />} /> (pattern già adottato in CashFlow.tsx:604 e MarginiCategoria.tsx:453) e, per i grafici con una serie per outlet, valutare verticalAlign="top" così l'area dati non viene erosa dal wrapping.

### MEDIA-37 · `src/pages/RevisionePagamenti.tsx:311` — Griglia di editing min-w-[820px] con select nelle celle: modifica impraticabile da touch

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** La tabella di revisione ha `min-w-[820px]` e 5 colonne contenenti controlli interattivi (select Tipologia w-40, Modalità scadenze w-56, Banca w-48 — righe 315-317). A 360px l'editing richiede scroll orizzontale continuo tra un select e l'altro della stessa riga, con perdita del riferimento alla ragione sociale; toccare i select mentre il contenitore è scrollabile causa facilmente scroll accidentali.

**Fix proposto:** Sotto md sostituire la griglia con una lista di card: una card per fornitore con i 3 select impilati verticalmente a piena larghezza (touch target più ampi) e badge giallo per le righe modificate.

### MEDIA-38 · `src/pages/RevisionePagamenti.tsx:323` — Spinner e stato vuoto centrati dentro tabelle piu' larghe del viewport: invisibili a 360px

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** La riga di caricamento `<td colSpan={5} className="px-4 py-10 text-center">` sta dentro `<table className="w-full text-sm min-w-[820px]">` (riga 311) avvolta da overflow-x-auto: il contenuto centrato cade a x~410px, quindi su viewport 360px l'utente vede solo una banda bianca vuota e deve scrollare orizzontalmente per scoprire lo spinner 'Caricamento...'. Stesso pattern in src/pages/Fatturazione.tsx:515 e 517 (loading + 'Nessuna fattura trovata' con colSpan={8} in tabella con min-w di colonna 120+200+100x3px), Fatturazione.tsx:754, 1126, 1186, e in generale in tutte le tabelle con min-w + stato centrato in cella.

**Fix proposto:** Renderizzare loading ed empty state FUORI dal wrapper overflow-x-auto (es. `{loading ? <div className="py-10 text-center">...</div> : <div className="overflow-x-auto"><table>...`), oppure applicare alla cella `sticky left-0 w-screen max-w-[100vw]` cosi' il messaggio resta centrato rispetto al viewport.

### MEDIA-39 · `src/pages/ScadenzarioSmart.tsx:202` — Nessun overscroll-behavior in tutta l'app: scroll chaining dai modali alla pagina sottostante

*Area: Gesti e scroll · Verifica: avversariale*

**Problema (mobile):** In tutta `src/` non esiste una sola occorrenza di `overscroll` (grep: 0 match). Tutti i modali `fixed inset-0` con contenuto `overflow-y-auto` — rappresentativo il Modal base di Scadenzario.tsx:94-95 (`max-h-[90vh] overflow-y-auto`) — sono renderizzati DENTRO l'albero DOM di `<main>` (il contenitore di scroll reale, Layout.tsx:346): quando su touch lo scroll interno del modale arriva a fine corsa, il gesto si incatena a `<main>` e la pagina dietro l'overlay scorre, facendo perdere la posizione all'utente. Stesso pattern in Fornitori.tsx:1426, InvoiceViewer.tsx:512, GlobalSearch.tsx:179, Sidebar.tsx:446 (drawer mobile riga 519), HelpPanel.tsx (GuideView/chat), TesoreriaManuale, Outlet, Ticket, TicketAdmin, BudgetControl, CashflowProspettico, ContoEconomico, ImportHub, Contratti, Dipendenti, ScadenzeFiscali, ArchivioDocumenti, componenti OutletWizard/ExportBilancioDialog/CostiRicorrenti/FinanziamentiTab/OpenBankingAcube. [Arbitrato: Ri-ancorato: Scadenzario.tsx è dead code, ma il problema è confermato a livello app (zero overscroll-behavior in src/) e lo stesso componente Modal vive identico in ScadenzarioSmart.tsx:202.]

**Fix proposto:** Aggiungere la classe Tailwind `overscroll-contain` a ogni contenitore scrollabile interno a overlay/modali/drawer (e `overscroll-none` sul backdrop `fixed inset-0`). Intervento solo di classi, zero logica; partire dal Modal base di Scadenzario e dal drawer della Sidebar che sono i piu' usati da mobile.

### MEDIA-40 · `src/pages/ScadenzarioSmart.tsx:1467` — Toast di errore che concatenano error.message tecnico grezzo (spesso in inglese)

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** Molti toast d'errore appendono il messaggio tecnico: riga 1467 `'Errore registrazione pagamento: ' + error.message`, e cosi' 1574, 1646, 1706, 1838, 1938, 2153; anche src/pages/Fornitori.tsx:668 e src/components/OpenBankingAcube.tsx:164 e 199 (dove err.message SOSTITUISCE del tutto il messaggio italiano). L'utente mobile vede stringhe come 'TypeError: Failed to fetch' o errori Postgres ('duplicate key value violates unique constraint...'): incomprensibili, in inglese, e con `whitespace-pre-line` + toast largo 384px (Toast.tsx:201) un messaggio lungo puo' occupare mezzo schermo a 360px.

**Fix proposto:** Mostrare nel toast solo il messaggio italiano breve ('Errore registrazione pagamento. Riprova.') e loggare error.message in console.error; se serve il dettaglio, mapparlo a messaggi noti (offline, permessi, duplicato) prima di mostrarlo.

### MEDIA-41 · `src/pages/ScadenzarioSmart.tsx:2614` — Card KPI tab Situazione in grid-cols-2 gap-6: importi text-2xl tagliati

*Area: Layout responsive · Verifica: avversariale*

**Problema (mobile):** Riga 2614 `<div className="grid grid-cols-2 gap-6">` senza variante mobile: su 360px ogni card (p-6) ha ~120px interni, ma dentro (righe 2616-2619 e simili) c'e' un `flex items-baseline justify-between` senza wrap con importo `text-2xl font-bold` (es. `{fmt(kpis.totalToPay)} €`) affiancato a una label uppercase ("Da pagare", "Incassi scaduti"): importo e label si sovrappongono o escono dalla card. Stessa struttura ripetuta alla riga 2652 (`grid grid-cols-2 gap-6`).

**Fix proposto:** Righe 2614 e 2652: `grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6`; nelle card sostituire `flex items-baseline justify-between` con `flex flex-wrap items-baseline justify-between gap-x-2`.

### MEDIA-42 · `src/pages/ScadenzarioSmart.tsx:2711` — Barra filtri scadenzario: controlli text-xs py-1.5 (~30px) e nessuna priorita' mobile

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** La barra filtri unificata (righe 2706-2752) ha input di ricerca `py-1.5 text-xs` (riga 2711), select Tipo/Stato `px-2.5 py-1.5 text-xs` (righe 2715, 2724) e due input date `text-xs` (righe 2750-2752): testo 12px e altezza ~30px, sotto il minimo touch, e con font <16px scatta anche lo zoom iOS. Su 360px il `flex-wrap` produce una pila verticale di 6+ controlli che spinge la lista scadenze fuori dallo schermo. Gli input date hanno solo `title` come etichetta: su mobile (dove il tooltip non esiste) due campi data identici senza indicazione Da/A.

**Fix proposto:** Su mobile: portare i controlli a `py-2 text-sm` (con fix globale 16px), aggiungere label visibili 'Dal/Al' sopra i campi data, e raggruppare i filtri secondari (date, metodo pagamento) in un bottone 'Filtri' che apre un drawer/bottom-sheet, lasciando in vista solo ricerca e stato.

### MEDIA-43 · `src/pages/ScadenzarioSmart.tsx:3869` — Tabelle Scadenzario senza paginazione + componente monolitico da 4.951 righe

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Le tabelle scadenze mappano integralmente `displayPayables` (memo a riga 2275) senza slice/paginazione: righe 3870 e 3939 (`.map((p, idx) => <tr...)`), e la vista timeline/mese fa lo stesso (3393-3445). Con 211 payables oggi e in crescita, piu' le stime da ricorrenza, su smartphone la tabella (gia' dentro overflow-x-auto) diventa pesante. Aggravante: la pagina e' un unico componente da 4.951 righe con decine di useState — ogni battitura in searchTerm ri-renderizza l'intero albero, tabelle incluse, con lag percepibile in digitazione su dispositivi mid-range.

**Fix proposto:** Paginare o virtualizzare le liste (slice + 'Mostra altri', o mesi collassati di default in vista mobile), estrarre le righe tabella in componenti memoizzati (React.memo) e fare debounce del searchTerm come gia' fatto in GlobalSearch.tsx:94.

### MEDIA-44 · `src/pages/ScadenzarioSmart.tsx:4830` — Pulsanti icona con touch target 26-30px (minimo raccomandato 44x44px)

*Area: Form e input · Verifica: avversariale*

**Problema (mobile):** Il pulsante Rimuovi rata (riga 4829-4831) e' `p-1.5` con icona Trash2 da 15px: target effettivo ~27x27px, molto sotto i 44px raccomandati — su smartphone si rischia di mancarlo o di toccare l'input importo adiacente. Stesso pattern su molti controlli distruttivi o frequenti: src/pages/AcubeFatturaForm.tsx:211 (rimuovi linea fattura, p-1.5 + icona 16), src/pages/Impostazioni.tsx:272 (rimuovi socio, p-1.5 + icona 14 = ~26px), chiusura modali in src/pages/ScadenzarioSmart.tsx:205 (p-1 + X 20 = ~28px) e src/pages/TesoreriaManuale.tsx:453 (p-1.5 + X 18 = ~30px), checkbox di selezione batch pagamenti in src/pages/TesoreriaManuale.tsx:2176 (~16px). Su azioni come 'elimina rata' un tap impreciso ha conseguenze sui dati inseriti.

**Fix proposto:** Portare i pulsanti icona ad almeno `p-2.5` con icona 18-20px, o aggiungere `min-w-11 min-h-11 flex items-center justify-center` (44px). Per le checkbox nelle liste, aumentare a `w-5 h-5` e rendere cliccabile l'intera riga/label. Prioritizzare i pulsanti di eliminazione e chiusura modale.

### MEDIA-45 · `src/pages/ScadenzeFiscali.tsx:97` — Modal scadenza fiscale non chiudibile con tap sull'overlay né con Esc

*Area: Modali/drawer/dropdown, Fixed/sticky e safe-area · Verifica: avversariale*

**Problema (mobile):** L'overlay (riga 97) non ha onClick di chiusura né handler Escape: l'unico modo per uscire è il bottone 'Annulla' in fondo al form (riga 195), che su 360px richiede di scrollare tutto il modal (`max-h-[90vh] overflow-y-auto`). Stesso pattern in ImportHub.tsx riga 1560 (modal riconciliazione post-import). Quasi tutti gli altri modali del progetto invece chiudono su tap-overlay: comportamento incoerente per l'utente mobile.

**Fix proposto:** Aggiungere `onClick={onClose}` sull'overlay con `onClick={e => e.stopPropagation()}` sul pannello bianco (pattern già usato in ScadenzarioSmart.tsx:201) e un listener keydown per Escape.

### MEDIA-46 · `src/pages/ScadenzeFiscali.tsx:466` — Scadenze fiscali: 8 colonne con colonna Azioni w-36 irraggiungibile senza scroll cieco

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** Tabella a 8 colonne (Scadenza, Tipo, Titolo, Periodo, Importo, Stato, Giorni, Azioni w-36 — righe 469-476) dentro overflow-x-auto. A 360px le colonne Stato/Giorni/Azioni (con il pulsante per segnare pagata la scadenza) sono fuori viewport; l'indicazione dei giorni mancanti — l'informazione più urgente su mobile — è invisibile senza scroll orizzontale non segnalato.

**Fix proposto:** Portare Giorni/urgenza dentro la prima colonna Scadenza (badge sotto la data) e nascondere Tipo e Periodo con `hidden md:table-cell`; oppure card view mobile ordinata per urgenza con azione 'Segna pagata' visibile.

### MEDIA-47 · `src/pages/ScadenzeFiscali.tsx:531` — Bottone azione 'Pagato' con testo 10px e touch target ~26px

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** Il bottone principale di riga per marcare una scadenza fiscale come pagata usa 'px-2 py-1 text-[10px]' con icona size={10} (riga 531): altezza totale ~26px e testo 10px, molto sotto il minimo touch di 44x44px (Apple HIG) / 48px (Material). Su smartphone e' facile mancarlo o premere la riga sbagliata; il testo del bottone e' inoltre illeggibile. La stessa pagina ha tutti i badge tipo/stato a text-[10px] (righe 496, 512) e il codice F24 a text-[10px] text-slate-400 (riga 503), rendendo la tabella fiscale la piu' densa e piccola dell'app.

**Fix proposto:** Bottone: 'px-3 py-2 text-xs min-h-[40px]' (o min-h-[44px] su mobile con media query); badge di riga a text-xs; codice F24 a text-[11px] text-slate-500.

### MEDIA-48 · `src/pages/TesoreriaManuale.tsx:140` — xlsx (~140KB gzip) importato staticamente in 7 file, incluso Banche (pagina quotidiana)

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** `import * as XLSX from 'xlsx'` e' statico in TesoreriaManuale.tsx:140, PrimaNota.tsx:8, Dipendenti.tsx:3, TicketAdmin.tsx:28, ConvertitoreFattureXML.tsx:11, src/lib/parsers/importEngine.ts:16 e src/components/ExportBilancioDialog.tsx:23. In TesoreriaManuale la libreria serve solo per l'export Excel (XLSX.writeFile a riga 1789) e per l'import estratto conto, ma viene scaricata a ogni apertura della pagina Banche — una delle piu' usate da smartphone. xlsx non ha nemmeno un manualChunk in vite.config.ts, quindi viene duplicata/condivisa tra i chunk delle pagine.

**Fix proposto:** Sostituire con dynamic import nei soli handler che la usano: `const XLSX = await import('xlsx')` dentro le funzioni di export/import. In alternativa aggiungere 'vendor-xlsx' ai manualChunks e comunque spostare l'import nei handler.

### MEDIA-49 · `src/pages/TesoreriaManuale.tsx:3236` — Tab Riconciliazione renderizza tutti i movimenti senza paginazione (fetch fino a 10.000 righe)

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Il fetch a riga 3692 carica bank_transactions con select('*') e limit(10000). La tab riconciliazione poi mappa TUTTE le righe filtrate senza slice ne' paginazione: `reconciledMovements.map(...)` a riga 3236 (memo a 3093, nessun limite) e `unreconciledMovements.map(...)` a riga 3368 (memo a 2862, nessun limite). Con lo storico che cresce (gia' 500+ movimenti, import mensili continui) su smartphone si crea un DOM di centinaia/migliaia di card: scroll janky, memoria alta, filtri di ricerca che ricalcolano e ri-renderizzano tutto a ogni keystroke. La tab Movimenti invece e' gia' paginata (Pagination riga 490, pageItems riga 1704).

**Fix proposto:** Riusare il componente Pagination esistente (riga 490) anche per le due liste di riconciliazione, o applicare uno slice con bottone 'Mostra altri'. Ridurre inoltre il select('*') ai soli campi usati per alleggerire il payload su rete mobile.

### MEDIA-50 · `src/pages/Ticket.tsx:459` — Modal 'Nuova segnalazione': items-center + overflow-y-auto rende la testata irraggiungibile

*Area: Modali/drawer/dropdown · Verifica: avversariale*

**Problema (mobile):** L'overlay è `fixed inset-0 flex items-center justify-center p-4 overflow-y-auto` e il form (tipo, pagina, descrizione, dropzone allegati) su 360x640 con tastiera aperta è più alto del viewport. Con `items-center`, il contenuto che sfora verso l'alto finisce nella zona non scrollabile del flex container: il titolo e il bottone X (riga 463) restano tagliati sopra il bordo e non si raggiungono nemmeno scrollando.

**Fix proposto:** Cambiare l'overlay in `flex items-start justify-center` (il child ha già `my-8` che centra visivamente i contenuti corti), oppure spostare lo scroll dentro il pannello con `max-h-[90vh] overflow-y-auto`.

---

## 🟢 BASSA — 21 finding

### BASSA-1 · `index.html:8` — Manca preconnect a fonts.gstatic.com per i file font

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** C'e' il preconnect a fonts.googleapis.com (riga 8) e il CSS di Inter ha display=swap (ok), ma i file .woff2 vengono serviti da fonts.gstatic.com, dominio senza preconnect: su mobile costa un round trip extra DNS+TCP+TLS prima del download del font, allungando il tempo in cui il testo e' in fallback. Inoltre il <link> CSS dei font e' render-blocking.

**Fix proposto:** Aggiungere `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` dopo la riga 8. Meglio ancora: self-hostare Inter (woff2 in src/assets con @font-face) eliminando i due domini terzi — piu' veloce e piu' affidabile su reti mobili.

### BASSA-2 · `src/components/EmptyState.tsx:14` — EmptyState e LoadingSkeleton condivisi sono dead code: ogni pagina reimplementa gli stati ad hoc

*Area: Stati vuoti/loading/errori · Verifica: avversariale*

**Problema (mobile):** Grep su tutta src/: nessun file importa src/components/EmptyState.tsx ne' src/components/ui/LoadingSkeleton.tsx (0 import). Le ~42 pagine reimplementano spinner e stati vuoti in modi diversi (Loader2, RefreshCw, div con border animato in CashFlow.tsx:411 e ContoEconomico.tsx:2972...), e src/pages/TesoreriaManuale.tsx:433 ridefinisce localmente un proprio componente EmptyState quasi identico a quello condiviso. Risultato su mobile: dimensioni, padding e comportamenti incoerenti e non verificati (vedi finding sulle tabelle), e ogni fix mobile va ripetuto N volte.

**Fix proposto:** Adottare i componenti condivisi: sostituire gli stati ad hoc con <EmptyState> e <LoadingSkeleton variant="table-row|card|kpi"> (gia' responsive perche' a larghezze percentuali), aggiungendo una variante <ErrorState onRetry>. In alternativa, se si sceglie di non usarli, rimuoverli per evitare che restino come falsa referenza.

### BASSA-3 · `src/components/GlobalSearch.tsx:160` — Ricerca globale: risultati coperti dalla tastiera su mobile (unità vh statiche)

*Area: Modali/drawer/dropdown, Fixed/sticky e safe-area, Orientamento e viewport · Verifica: avversariale*

**Problema (mobile):** Il pannello parte da `pt-[15vh]` (riga 160) e la lista risultati è `max-h-[50vh]` (riga 179): su iOS Safari le unità vh non si riducono quando la tastiera è aperta, quindi su 360x640 il pannello occupa fino a ~65vh (~416px) mentre la tastiera copre i ~300px inferiori — circa metà dei risultati resta nascosta dietro la tastiera e, essendo l'overlay `fixed`, non c'è modo di scrollare la pagina per recuperarli.

**Fix proposto:** Usare unità dinamiche: `pt-[10dvh]` e `max-h-[50dvh]` (o `max-h-[calc(100dvh-160px)]`), così l'altezza si adatta al visual viewport con tastiera aperta; Tailwind 4 supporta dvh nativamente.

### BASSA-4 · `src/components/HelpPanel.tsx:180` — Chat AI: Invio invia sempre (niente a capo da mobile) e tap-target dei suggerimenti sotto soglia

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** L'handler `onKeyDown` della textarea invia il messaggio su ogni `Enter` senza Shift: sulle tastiere mobili il tasto Invio è l'unico modo di andare a capo, quindi da telefono è impossibile scrivere domande su più righe (Shift+Invio non esiste). Inoltre i chip dei suggerimenti a riga 135 (`text-xs px-2.5 py-1.5`) sono alti ~29px, sotto la soglia raccomandata di 44px per i touch target, e sono il primo elemento con cui l'utente interagisce nella chat.

**Fix proposto:** Limitare l'invio-con-Invio ai dispositivi con puntatore fine (es. controllare `matchMedia('(pointer: fine)')` o inviare solo dal bottone su touch) e portare i chip ad almeno `py-2.5` con `text-sm`.

### BASSA-5 · `src/components/Layout.tsx:273` — Tre polling paralleli ogni 60s senza pausa quando la tab non è visibile

*Area: Performance mobile · Verifica: avversariale*

**Problema (mobile):** Tre setInterval da 60s girano in parallelo per ogni sessione: Layout.tsx:273 (fetchUnseen), Layout.tsx:302 (fetchAnomalie) e NotificationBell.tsx:68 (loadNotifications). Nessuno controlla document.visibilityState: su smartphone, con l'app aperta in foreground per ore (uso tipico delle store manager), sono 3 richieste Supabase al minuto continue = consumo dati e batteria, e richieste inutili quando l'utente non guarda lo schermo.

**Fix proposto:** Unificare i tre poller in uno solo e sospenderlo quando la pagina non e' visibile: listener su visibilitychange che fa clearInterval quando hidden e refetch immediato + restart al ritorno visibile. In alternativa, canale Supabase Realtime sulle tabelle notifiche al posto del polling.

### BASSA-6 · `src/components/Layout.tsx:320` — Touch target sotto i 44px per hamburger e X di chiusura drawer

*Area: Navigazione · Verifica: avversariale*

**Problema (mobile):** Il bottone hamburger e' `p-1.5` con icona 20px = ~32x32px (Layout.tsx riga 320), sotto il minimo raccomandato di 44px per il touch. Stesso problema per la X di chiusura del drawer (`p-1.5` + icona 18px = ~30px, Sidebar.tsx riga 439), che oltretutto sta nell'angolo in alto del drawer, la zona meno raggiungibile col pollice. Pattern analogo sulle voci di menu del drawer: `px-3 py-2` con text-sm = ~36px di altezza (Sidebar.tsx riga 340), tollerabile ma sotto soglia.

**Fix proposto:** Portare i due bottoni a `p-2.5`/`p-3` (o `min-w-11 min-h-11` con contenuto centrato) e le voci di menu del drawer a `py-2.5` almeno su mobile (es. classi condizionali nel drawer). L'area cliccabile puo' crescere senza cambiare la resa visiva usando padding trasparente.

### BASSA-7 · `src/components/Sidebar.tsx:453` — Disclosure e menu senza aria-expanded; bottoni icona con solo title

*Area: Accessibilità mobile · Verifica: avversariale*

**Problema (mobile):** I bottoni che espandono/comprimono le sezioni della sidebar (riga 453) non hanno aria-expanded: lo stato aperto/chiuso e' comunicato solo dall'icona chevron. Stesso difetto su: dropdown azienda (Sidebar.tsx:399), FAQ del pannello aiuto (HelpPanel.tsx:233), campanella notifiche (NotificationBell.tsx:144), bottone Aiuto (HelpPanel.tsx:279). Nell'intero repo aria-expanded compare una sola volta (Layout.tsx:169, ProfileMenu). Inoltre molti bottoni solo-icona affidano il nome accessibile al solo `title` (Layout.tsx:318 hamburger, Layout.tsx:333 cerca, HelpPanel.tsx:190 invia): funziona come fallback ma e' fragile e invisibile su touch.

**Fix proposto:** Aggiungere `aria-expanded={isOpen}` (e aria-controls dove utile) a tutti i toggle di disclosure/menu e affiancare `aria-label` esplicito ai bottoni solo-icona, seguendo il pattern gia' corretto di ProfileMenu in Layout.tsx:168-169.

### BASSA-8 · `src/components/Sidebar.tsx:518` — Drawer mobile: il tasto back di Android non lo chiude e manca Escape

*Area: Navigazione · Verifica: avversariale*

**Problema (mobile):** Il drawer mobile (righe 518-525) si chiude solo via overlay, X o navigazione (effetto righe 283-285, corretto). Non c'e' nessuna gestione della history: con il menu aperto, il tasto back di Android/gesture back di iOS esegue una navigate(-1) verso la pagina precedente con il drawer ancora aperto sopra la nuova pagina, invece di chiudere il menu (pattern atteso su mobile). Manca anche il listener Escape (presente invece in ProfileMenu, Layout.tsx riga 136) e non c'e' focus trap. Nota: l'overlay tappabile e' largo solo 72px su viewport 360 (drawer w-72 = 288px, riga 521), quindi il back hardware e' la chiusura piu' naturale ed e' proprio quella che manca.

**Fix proposto:** All'apertura fare `history.pushState({drawer:true}, '')` e chiudere il drawer su evento `popstate` (o usare useSearchParams/useBlocker di react-router 7); aggiungere listener keydown Escape che chiama setMobileOpen(false).

### BASSA-9 · `src/data/pageGuides.ts:68` — Guida Dashboard: 'Passando il mouse sul grafico' — istruzione impossibile su touch

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** La sezione 'Entrate e uscite ultimi 30 giorni' della guida '/' dice 'Passando il mouse sul grafico puoi vedere il dettaglio giorno per giorno'. Su smartphone non c'è mouse: il tooltip di recharts si apre toccando/tenendo premuto il grafico, ma la guida non lo dice. Per le utenti mobile l'istruzione è un vicolo cieco. È l'unico riferimento esplicito al mouse nelle guide, quindi facilmente sanabile.

**Fix proposto:** Sostituire con formula device-neutrale: 'Tocca (o passa il mouse su) un punto del grafico per vedere il dettaglio del singolo giorno'.

### BASSA-10 · `src/data/pageGuides.ts:758` — Guide con 'trascina il file / selezionalo dal tuo computer' ripetuto: fuorviante da telefono

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** Diversi passaggi di caricamento file assumono il PC: riga 758 (/dipendenti: 'Trascina il file oppure selezionalo dal tuo computer'), riga 170 (FAQ /outlet/operativi: 'trascinare più file contemporaneamente'), riga 1384 (/import-hub: 'Trascinare il file nell'area tratteggiata oppure cliccare "Seleziona File" e sceglierlo dal computer'), righe 1791 e 1794 (/fatturazione/converti-xml: 'trascinalo nel riquadro... selezionarlo dal computer', 'incollare da Excel... negli appunti'). Il fallback tap esiste sempre nel software, ma il testo 'dal computer' disorienta chi carica una foto o un PDF dal telefono (dove il picker apre galleria/File).

**Fix proposto:** Uniformare il wording in tutte le voci elencate: 'Tocca l'area di caricamento per scegliere il file dal dispositivo (da computer puoi anche trascinarlo)'.

### BASSA-11 · `src/data/pageGuides.ts:2224` — Guida Ticket: allegati spiegati solo con Ctrl+V/Cmd+V, nessuna alternativa da telefono

*Area: Guide e testi utente · Verifica: avversariale*

**Problema (mobile):** La guida '/ticket' (pagina pensata proprio per segnalazioni delle operatrici) istruisce: 'incollare direttamente uno screenshot con Ctrl+V (o Cmd+V su Mac)' (riga 2224) e ripete 'Puoi incollare uno screenshot direttamente con Ctrl+V oppure trascinare un file' nella FAQ a riga 2266. Su smartphone non esistono né Ctrl+V né il drag&drop: Sabrina e Veronica, che segnalano problemi proprio dal telefono in negozio, non trovano nella guida il percorso reale (tocca l'area allegati e scegli una foto dalla galleria o scatta con la fotocamera).

**Fix proposto:** Riscrivere i due passaggi in forma neutra: 'Tocca l'area allegati per scegliere una foto o un PDF (da telefono puoi scattare o scegliere dalla galleria); da computer puoi anche trascinare il file o incollare uno screenshot con Ctrl+V'.

### BASSA-12 · `src/hooks/useCompanyLabels.ts:71` — Fallback terminologia divergente: 'Outlet' in useCompanyLabels vs 'Punto vendita' in useCompany

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** useCompanyLabels.ts:71 usa fallback 'Outlet' quando company non e' ancora caricata, mentre useCompany.tsx:67 normalizza point_of_sale_label null a 'Punto vendita'. Su rete mobile lenta, su Made/Zago la sidebar/drawer renderizza prima 'Outlet & Performance' / voce 'Outlet' (terminologia di un altro tenant) e poi flippa a 'Punti vendita & Performance' quando la query companies risponde: flash di label incoerente per-tenant, visibile a ogni cold start da smartphone.

**Fix proposto:** Unificare il fallback (una costante condivisa, es. DEFAULT_POS_LABEL = 'Punto vendita', usata in entrambi i file) oppure non renderizzare le label terminology-driven finche' `loading` di useCompany e' true (skeleton sulle 3 voci interessate).

### BASSA-13 · `src/lib/tenants.ts:95` — Contrasto del TenantBadge insufficiente e diverso per tenant (peggiore su Zago)

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Il TenantBadge (Layout.tsx:27-28) scrive testo bianco text-xs (12px) su `accentBg`: #10b981 (NZ, contrasto ~2.3:1), #3b82f6 (Made, ~3.1:1), #f97316 (Zago, riga 95, ~2.8:1) — tutti sotto il minimo WCAG AA 4.5:1 per testo piccolo. La leggibilita' dell'UNICO indicatore di tenant varia quindi da tenant a tenant ed e' peggiore proprio all'aperto su smartphone sotto luce solare, lo scenario d'uso delle store manager che devono distinguere a colpo d'occhio su quale tenant stanno operando.

**Fix proposto:** Usare come sfondo del badge i colori scuri gia' definiti in `accentColor` (#047857 / #1d4ed8 / #c2410c, contrasto con bianco >= 4.6:1) e riservare accentBg ad accenti decorativi, oppure passare a testo scuro su sfondo chiaro. Modifica solo in tenants.ts/Layout.tsx, deploy automatico sui 3 tenant.

### BASSA-14 · `src/pages/CashflowProspettico.tsx:1449` — Stati di loading centrati con h-screen/min-h-screen dentro il main scrollabile

*Area: Orientamento e viewport · Verifica: avversariale*

**Problema (mobile):** `<div className="flex items-center justify-center h-screen">` per lo spinner di caricamento: il div sta DENTRO `main` (già alto 100vh - header - tenant badge), quindi crea ~100-150px di scroll extra e lo spinner appare sotto il centro visibile su mobile. Stesso pattern: ScadenzarioSmart.tsx:2530 (min-h-screen), MarginiCategoria.tsx:308, CashFlow.tsx:398/408/421, StockSellthrough.tsx:240/247, AnalyticsPOS.tsx:284/291, OpenToBuy.tsx:136/143, StoreManager.tsx:149/156, App.tsx:62/83. NB: i `min-h-screen bg-white` come wrapper di sfondo delle ~30 pagine (es. Dashboard.tsx:677) sono invece sostanzialmente innocui — aggiungono solo un po' di scroll vuoto in fondo — e non richiedono intervento urgente.

**Fix proposto:** Per i centraggi di loading dentro il layout usare un'altezza relativa al contenitore, es. `min-h-[60dvh]` o `h-full` sul flex, come già fatto in Dashboard.tsx:607 (`min-h-[60vh]`, da portare a dvh).

### BASSA-15 · `src/pages/Dashboard.tsx:82` — Affordance "Dettaglio" delle KpiCard visibile solo su hover: invisibile al touch

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** Il link "Dettaglio ›" in fondo a ogni KpiCard usa "opacity-0 group-hover:opacity-100": su smartphone l'hover non esiste, quindi l'indicazione che la card è cliccabile e porta al drill-down non compare mai (la card resta comunque cliccabile, ma senza alcun indizio visivo). Stesso pattern per il chevron del ranking outlet alla riga 904 (tabella però nascosta su mobile).

**Fix proposto:** Rendere l'affordance sempre visibile sotto il breakpoint sm (es. "opacity-100 sm:opacity-0 sm:group-hover:opacity-100") o mostrare stabilmente un ChevronRight nell'angolo della card su mobile.

### BASSA-16 · `src/pages/Login.tsx:203` — Footer login 'Gestionale NZ v1.0' hardcoded su tutti i tenant

*Area: Coerenza multi-tenant · Verifica: avversariale*

**Problema (mobile):** Il footer della pagina Login mostra `Gestionale NZ v1.0 · {tenant.alias}`: su made-gestionale-nz e zago-gestionale-nz gli utenti vedono il brand 'NZ' di un altro tenant accanto al proprio alias ('Gestionale NZ v1.0 · made-retail'), in contraddizione con l'h1 tenant-aware della riga 70 ('Gestionale Made Retail Srl'). Su smartphone il login e' la prima schermata vista ogni giorno dalle store manager e il doppio brand confonde su quale tenant si sta entrando (proprio il rischio che il TenantBadge vuole mitigare).

**Fix proposto:** Sostituire con un brand neutro o tenant-aware: `Gestionale · v1.0 · {tenant.alias}` oppure `{tenant.displayName} · v1.0`.

### BASSA-17 · `src/pages/Scadenzario.tsx:1153` — Nessun indicatore visivo di scroll orizzontale in tutto il progetto

*Area: Tabelle dati · Verifica: avversariale*

**Problema (mobile):** Tutti i ~45 contenitori `overflow-x-auto` del progetto (es. Scadenzario.tsx:1153, Fornitori.tsx:848, Fatturazione.tsx:499, CashFlow.tsx:661, ConfrontoOutlet.tsx:464) sono semplici div senza alcuna affordance: niente ombra/gradiente sul bordo destro, niente hint "scorri per vedere altro". Su iOS/Android la scrollbar è invisibile finché non si scrolla, quindi l'utente mobile non ha alcun segnale che esistano colonne nascoste — le colonne Stato e Azioni di fatto "non esistono" per chi non lo sa.

**Fix proposto:** Creare un componente condiviso `TableScroll` (div overflow-x-auto con pseudo-elementi gradiente laterali attivati via scroll listener o CSS scroll-driven, es. mask-image) e sostituirlo ai div nudi nelle pagine dati principali.

### BASSA-18 · `src/pages/ScadenzarioSmart.tsx:3990` — Torta "Categoria" senza etichette né legenda: colori non decodificabili senza tap

*Area: Grafici e dashboard · Verifica: avversariale*

**Problema (mobile):** La Pie usa 5 colori ciclici (riga 3992) ma non ha né label né <Legend />: su mobile l'unico modo per sapere quale categoria rappresenta ogni fetta è tappare ciascuna fetta e leggere il tooltip default (riga 3995, peraltro con stile recharts di default invece del GlassTooltip usato nel grafico accanto). Il grafico da solo non comunica nulla.

**Fix proposto:** Aggiungere <Legend content={<ModernLegend />} /> sotto la torta e usare il GlassTooltip come negli altri due grafici della stessa vista per coerenza.

### BASSA-19 · `src/pages/SchedaContabileFornitore.tsx:914` — Note esplicative critiche a 11px slate-400

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** La nota 'Segno contabile: negativo = debito ... positivo = credito' — indispensabile per interpretare correttamente il saldo di apertura del fornitore — e' 'text-[11px] text-slate-400' (riga 914): 11px con contrasto ~3:1 per l'unica frase che spiega il segno dei numeri. Stesso pattern (help text operativo a text-[11px] text-slate-400/500) in Impostazioni.tsx:929 e 955, StoricoDistinte.tsx:227 e 231, ScadenzarioSmart.tsx:4488 e 4886. Anche le label dei campi 'Importo (− = debito)' e 'Data' sono text-[10px] (righe 902 e 906).

**Fix proposto:** Help text che condiziona l'interpretazione dei dati: 'text-xs text-slate-500'; label di campo: 'text-[11px] text-slate-600'. Riservare text-[11px] slate-400 a metadati puri (timestamp, dimensioni file).

### BASSA-20 · `src/pages/TesoreriaManuale.tsx:3530` — Testo a 9px: 'match importo' nella riconciliazione manuale e '+N' nel calendario

*Area: Tipografia e densità · Verifica: avversariale*

**Problema (mobile):** L'etichetta 'match importo' — informazione decisionale che segnala all'utente quale fattura corrisponde all'importo del movimento durante la riconciliazione manuale — e' resa a 'text-[9px] text-emerald-600 font-semibold uppercase' (riga 3530). 9px uppercase e' sotto qualsiasi soglia di leggibilita' mobile: proprio il suggerimento che dovrebbe guidare la scelta e' quello piu' difficile da vedere. Stesso 9px in ScadenzarioSmart.tsx:3075 per il contatore '+N' delle scadenze extra nel calendario (unico indizio che ci sono altre scadenze quel giorno) e ContoEconomico.tsx:3108 (delta %).

**Fix proposto:** Minimo assoluto 11px per testo con funzione informativa: 'text-[11px]' per 'match importo' (lo spazio c'e', e' in una colonna text-right) e per il '+N' del calendario.

### BASSA-21 · `src/pages/TesoreriaManuale.tsx:3741` — Container pagina Banche con p-6 fisso invece dello standard p-4 sm:p-6

*Area: Layout responsive · Verifica: avversariale*

**Problema (mobile):** Riga 3741 `<div className="p-6 space-y-6 max-w-[1600px] mx-auto">`: quasi tutte le altre pagine live usano `p-4 sm:p-6` (Dashboard.tsx:678, Fornitori.tsx:723, ecc.), qui invece il padding resta 24px per lato anche su 360px, sprecando 16px orizzontali su una pagina piena di tabelle larghe. Stesso pattern nella pagina Scadenze: src/pages/ScadenzarioSmart.tsx:2609 (`px-6 py-5`) e 2543 (`px-6 py-3`).

**Fix proposto:** Allineare allo standard del repo: `p-4 sm:p-6` (e `px-4 sm:px-6` nei due punti di ScadenzarioSmart).

---

## Finding scartati dalla verifica avversariale (11)

Riportati per trasparenza: segnalati da un auditor ma respinti alla verifica sul codice.

- `src/pages/TesoreriaManuale.tsx:1923` — *Tabella movimenti bancari 7 colonne con celle whitespace-nowrap che allargano la riga* → **scartato**: Il finding è in gran parte già mitigato nel codice: la cella Descrizione HA max-width e truncate (td con max-w-[300px] a riga 1953, div truncate + CellTooltip a righe 1954-1955), quindi la premessa centrale "la Descrizione non ha max-width/truncate" è falsa e il fix proposto è di fatto già implementato. Anche Conto (max-w-[160px] truncate, riga 1950) e Categoria (max-w-[180px], riga 1970) sono limitate; il whitespace-nowrap resta solo su Data/Importo/Saldo, dove è corretto (date e valute non devono andare a capo) e produce colonne strette. Le tabelle a 2154 e 2751 hanno 5-6 colonne compatte con fornitore già truncato (max-w-[180px]/[220px]) e nowrap solo sugli importi. Tutte le tabelle sono dentro overflow-x-auto (1922, 2153, 2750), la mitigazione standard: su 360px serve uno scroll orizzontale moderato ma i dati restano accessibili. Le richieste residue (indicatore di scroll, colonna sticky, card view, hidden md:table-cell) sono miglioramenti di design, non un difetto riproducibile di usabilità.
- `src/components/SupplierAllocationEditor.tsx:509` — *Righe split percentuale/valore: label fissa w-40 schiaccia l'input a ~50px su mobile* → **scartato**: Il codice citato esiste (span w-40 riga 509, input max-w-[140px] riga 511, identico righe 549-551), ma la compressione ipotizzata non si verifica: l'editor e' renderizzato solo in Fornitori.tsx riga 1159, dentro un td colSpan=9 di una tabella con min-w-[920px] avvolta in overflow-x-auto (righe 848-849). Su viewport 360px la tabella mantiene 920px e scorre orizzontalmente, quindi la riga flex del form dispone di ~880px: l'input resta a piena larghezza 140px e non viene mai schiacciato a ~50px. Il problema descritto non e' riproducibile; il costo reale su mobile e' lo scroll orizzontale dell'intera tabella, gia' gestito dal wrapper overflow-x-auto (pattern diverso da quello contestato).
- `src/components/ui/Breadcrumb.tsx:20` — *Componente ui/Breadcrumb mai usato e comunque non responsive* → **scartato**: Fatti verificati: il componente src/components/ui/Breadcrumb.tsx e' effettivamente codice morto (solo esportato da ui/index.ts, mai importato da alcuna pagina; il breadcrumb reale e' quello inline in Layout.tsx riga 76) e, se usato, il nav riga 20 senza flex-wrap con item max-w-[200px] potrebbe andare in overflow. Ma proprio perche' non viene mai renderizzato, il problema non e' riproducibile su alcun viewport 360-430px nell'app reale: nessun utente mobile puo' incontrarlo. E' igiene del codice (rimozione dead code), fuori scope per un audit di usabilita' mobile.
- `src/pages/Fornitori.tsx:1312` — *YAxis categoria con width fissa 120px: 40% dello schermo per etichette troncate* → **scartato**: Il claim principale (nomi >18 caratteri clippati dall'SVG senza gestione) è già mitigato a monte: topSuppliersBySpend tronca i nomi con substring(0,20) (riga 556), che a fontSize 11 rientra nei 120px; il fix proposto (nome completo nel tooltip) non funzionerebbe perché anche il tooltip riceve il nome già troncato nei dati. Resta solo la proporzione 40% etichette su mobile, ma le barre (~140-160px su viewport 360px) restano leggibili e comparabili con valori via ticks e tooltip: preferenza di layout, non problema di usabilità riproducibile.
- `src/pages/Dashboard.tsx:904` — *Link 'Vedi dettaglio' outlet in classifica visibile solo su hover, riga non cliccabile* → **scartato**: Il finding non regge su mobile: la tabella classifica con il chevron 'opacity-0 group-hover:opacity-100' (riga 904) sta dentro un wrapper 'hidden sm:block' (riga 861), quindi su viewport 360-430px non viene mai renderizzata. Per mobile esiste una vista dedicata 'sm:hidden' (righe 929-950) dove ogni riga outlet e' interamente un Link verso outletHref(o) con chevron sempre visibile (riga 948, 'text-slate-300', nessuna opacity-0). La navigazione al dettaglio dalla classifica su smartphone e' quindi pienamente scopribile e funzionante. Il punto secondario sulla KPI card (riga 82) e' marginale: la card intera e' gia' un Link e l'hint mancante su mobile e' una preferenza stilistica, non un blocco di usabilita'.
- `src/components/AccountDetail.tsx:418` — *Scroll-lock su document.body inefficace: il vero scroller e' <main>* → **scartato**: Il codice citato esiste ed effettivamente il lock su document.body sarebbe inefficace (lo scroller reale è <main> in Layout.tsx:346), ma AccountDetail non è importato né renderizzato da nessun file in src/ (grep su tutto il repo: nessun import, nessun uso in route o pagine). È dead code: il drawer non viene mai montato, quindi il problema non è riproducibile su nessun viewport mobile reale. Semmai il finding utile è segnalare il componente come codice morto, non il suo scroll-lock.
- `src/pages/PrimaNota.tsx:305` — *Scroll trap: tabella con max-h-[70vh] e scroll proprio dentro la pagina scrollabile* → **scartato**: Lo scenario descritto non esiste: la tabella è l'ultimo elemento della pagina (nessun contenuto sotto da raggiungere) e lo scroll chaining di default propaga il gesto a <main> ai bordi dello scroller interno, quindi nessun trap reale. Il fix overscroll-contain creerebbe il trap invece di risolverlo, e md:overflow-auto romperebbe lo scroll orizzontale obbligatorio delle 8 colonne su 360px. Pattern max-h+sticky header deliberato e ragionevole su mobile: preferenza stilistica, non difetto riproducibile.
- `src/components/Sidebar.tsx:511` — *Sidebar desktop h-screen attiva in landscape su smartphone: bottone 'Esci' fuori schermo* → **scartato**: Il codice citato esiste ma il danno dichiarato è mitigato: in landscape (md attivo) l'header mostra ProfileMenu (Layout.tsx:162-219, hidden sm:block) con voce "Esci" sempre raggiungibile in alto, quindi il logout non è irraggiungibile. Inoltre la premessa del fix è falsa: Layout.tsx:307 usa ancora h-screen e non esiste alcun h-dvh nel repo, e l'intera shell ha lo stesso h-screen (problema di tutta la pagina, non della sidebar). Il delta reale 100vh vs viewport visibile in landscape è ~50px (barra browser), non ~100px: al più resta parzialmente coperto il bottone "Comprimi sidebar", edge case marginale. Sul viewport di audit 360-430px portrait la sidebar desktop è hidden e non riproduce nulla.
- `src/components/HelpPanel.tsx:291` — *Pannello aiuto h-[70vh] + bottom-20: header tagliato in landscape e input chat sotto la tastiera* → **scartato**: Il codice a riga 291 esiste ma il finding non regge ai calcoli. Landscape: il pannello (70vh + bottom 80px) sfora solo con viewport alto meno di ~267px (0.7h+80>h), mentre in landscape reale su smartphone l'altezza CSS visibile e' ~300-330px: con h=320, 70vh=224+80=304 e il pannello sta interamente nello schermo, header e tab compresi (il finding stima "70vh ~270-300px" su un viewport di 300px, ma il 70% di 300 e' 210). Inoltre l'audit e' su portrait 360-430px, dove max-h-[560px] non sfora mai. Tastiera: la premessa "vh statico" e' errata (vh segue il layout viewport); su iOS e Chrome Android moderno la tastiera non ridimensiona il layout viewport, quindi ne' vh ne' dvh reagiscono e il fix proposto h-[70dvh] non risolverebbe il problema dichiarato (dvh compensa solo le barre del browser). Resta solo la preferenza stilistica bottom-sheet vs popover, non un problema di usabilita' riproducibile.
- `src/pages/Scadenzario.tsx:951` — *Errori mostrati con alert() nativo del browser invece del sistema toast* → **scartato**: Il verificatore ha confermato gli alert() senza controllare la raggiungibilità: Scadenzario.tsx e Contratti.tsx sono dead code (nessun import, nessuna route in App.tsx — /scadenzario carica ScadenzarioSmart). Nessun alert() nelle pagine effettivamente raggiungibili. [arbitrato sessione principale]
- `src/pages/CashFlow.tsx:400` — *Stati loading/errore/login di CashFlow in inglese con errore tecnico grezzo a schermo* → **scartato**: Il verificatore ha confermato i testi inglesi senza controllare la raggiungibilità: CashFlow.tsx è dead code (nessun import, la route /cash-flow carica CashflowProspettico). [arbitrato sessione principale]

---

*Report generato dall'audit multi-agente del 2026-07-19 (verifica avversariale completa). Nessuna modifica applicata al codice o ai dati: i fix sono proposte da implementare in PR separate.*
