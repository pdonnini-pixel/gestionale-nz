// ─────────────────────────────────────────────────────────────────────────────
// FONTE UNICA DELLE GUIDE PAGINA — usata da HelpPanel (tab "Guida") e
// dall'assistente AI (edge function help-chat, che riceve la guida come contesto).
//
// ⚠️ REGOLA (CLAUDE.md): ogni volta che modifichi/aggiungi una funzione di una
// pagina, aggiorna QUI la voce corrispondente nello stesso commit. La CI
// (tools/check-guide-alignment.mjs) blocca la PR se dimentichi di farlo.
// Le voci sono state generate leggendo il codice reale, ma da ora si aggiornano
// a mano insieme al codice.
// ─────────────────────────────────────────────────────────────────────────────

export interface GuideSection {
  heading: string
  body: string
  steps?: string[]
}

export interface GuideFaq {
  q: string
  a: string
}

export interface PageGuide {
  /** Rotta canonica della pagina (chiave di matching). */
  path: string
  /** Nome icona lucide (mappato in HelpPanel). */
  icon: string
  title: string
  description: string
  sections: GuideSection[]
  faq: GuideFaq[]
}

export const PAGE_GUIDES: PageGuide[] = [
  {
    "path": "/",
    "icon": "LayoutDashboard",
    "title": "Dashboard",
    "description": "La Dashboard è la pagina che vedi appena entri nel gestionale: un cruscotto riassuntivo con i numeri chiave dell'azienda, gli avvisi da gestire e il confronto tra i punti vendita. Da qui puoi capire in pochi secondi come sta andando l'attività e cliccare per approfondire.",
    "sections": [
      {
        "heading": "Il saluto e il periodo di riferimento",
        "body": "In alto trovi il saluto con il tuo nome e, subito sotto, il periodo a cui si riferiscono i dati mostrati (ad esempio l'anno o il trimestre selezionato). Se i dati arrivano da un bilancio già importato, vedrai anche la scritta 'Dati da bilancio importato'. In alto a destra c'è anche l'indicazione di quando i dati sono stati aggiornati l'ultima volta."
      },
      {
        "heading": "I 4 indicatori principali",
        "body": "Subito sotto il saluto trovi quattro riquadri con i numeri più importanti: Ricavi, Margine netto (o Costi, se i dati arrivano dalle fatture), Liquidità e Scadenze aperte. Ogni riquadro è cliccabile e ti porta alla pagina di dettaglio corrispondente.",
        "steps": [
          "Ricavi: mostra il totale incassato nel periodo. Se sotto compare l'etichetta 'Consuntivo' significa che il dato è già consolidato per i mesi chiusi, mentre 'previsionale' indica una stima di chiusura anno. Se vedi '—' vuol dire che non ci sono ancora dati per l'anno selezionato: in questo caso vai su Budget e Controllo per inserirli.",
          "Margine netto: indica quanto rimane dei ricavi dopo i costi, in percentuale. Se non è ancora disponibile (perché i costi non sono stati inseriti) vedrai '—' con la nota 'Margine disponibile dopo l'inserimento dei costi'.",
          "Liquidità: è il saldo totale dei conti correnti collegati, con la data e l'ora dell'ultimo aggiornamento. Se il saldo è negativo il riquadro si evidenzia in rosso.",
          "Scadenze aperte: somma le fatture scadute e quelle in scadenza nei prossimi 7 giorni. Clicca per andare allo Scadenzario e gestirle."
        ]
      },
      {
        "heading": "Alert & Azioni",
        "body": "Questo riquadro raccoglie tutte le segnalazioni che richiedono la tua attenzione, con un pulsante per andare direttamente a risolverle. Se non ci sono segnalazioni, vedrai il messaggio 'Nessuna segnalazione — tutto sotto controllo'.",
        "steps": [
          "Fatture scadute: pagamenti non ancora effettuati oltre la data di scadenza. Clicca 'Gestisci' per andare allo Scadenzario.",
          "PFN negativa: significa che i debiti superano la liquidità disponibile. Clicca 'Banche' per approfondire.",
          "Esercizio in perdita o in utile: ti mostra se l'anno si sta chiudendo in negativo o positivo, con il margine percentuale.",
          "Scadenze nei prossimi 7 giorni: ti avvisa delle prossime scadenze in arrivo.",
          "Movimenti bancari senza categoria contabile: ti segnala quanti movimenti importati dalle banche non hanno ancora una categoria assegnata. Clicca 'Vai ai movimenti' per assegnarla dalla lista movimenti bancari."
        ]
      },
      {
        "heading": "Cashflow ultimi 30 giorni",
        "body": "A fianco degli Alert trovi un grafico con l'andamento di entrate e uscite bancarie degli ultimi 30 giorni, con il totale di entrate, uscite e il saldo netto. Passando il mouse sul grafico puoi vedere il dettaglio giorno per giorno. Se non ci sono ancora estratti conto importati, il riquadro ti suggerisce di importarli da ImportHub."
      },
      {
        "heading": "Performance dei punti vendita",
        "body": "In basso trovi la classifica dei punti vendita, ordinati dal ricavo più alto al più basso. Per ogni punto vendita vedi i ricavi da inizio anno, la percentuale sul totale del gruppo, il confronto con il budget (vs Budget) e il budget dell'intero anno. In fondo alla tabella c'è sempre una riga con il totale del gruppo.",
        "steps": [
          "Il colore del numero 'vs Budget' ti aiuta a capire a colpo d'occhio la situazione: nero se il punto vendita è in linea o sopra il budget, rosso se è sotto.",
          "Clicca su un punto vendita (o sulla freccia a destra della riga) per aprire la scheda di dettaglio di quel punto vendita.",
          "Clicca su 'Confronto completo' in alto a destra della sezione per vedere l'analisi comparativa completa tra tutti i punti vendita.",
          "Se non ci sono ancora dati sufficienti, il riquadro ti suggerisce di importare il bilancio oppure di assegnare i fornitori ai punti vendita."
        ]
      },
      {
        "heading": "Da dove arrivano i numeri",
        "body": "I dati della Dashboard vengono presi automaticamente, in ordine di priorità, dalle fonti disponibili: prima i riepiloghi ufficiali, poi il bilancio importato, poi (se l'anno è ancora in corso e il bilancio non è ancora disponibile) i dati di consuntivo e previsione inseriti in Budget e Controllo, e infine le fatture elettroniche. Non devi fare nulla per scegliere la fonte: il sistema mostra sempre il dato più affidabile disponibile per il periodo selezionato."
      }
    ],
    "faq": [
      {
        "q": "Perché in alcuni riquadri vedo il simbolo '—' invece di un numero?",
        "a": "Il simbolo '—' indica che per il periodo selezionato non ci sono ancora dati sufficienti (ad esempio i costi non sono stati inseriti, oppure non è stato importato nulla per quell'anno). Segui il suggerimento indicato nel riquadro stesso per capire dove inserire i dati mancanti."
      },
      {
        "q": "Cosa significa l'etichetta 'Consuntivo ... mesi chiusi · granitico' vicino ai Ricavi?",
        "a": "Indica che il valore mostrato è un dato consolidato e definitivo per i mesi già chiusi dell'anno in corso, mentre il valore 'previsionale' accanto è una stima di come potrebbe chiudere l'intero anno."
      },
      {
        "q": "Cosa vuol dire il colore rosso nella colonna 'vs Budget' della classifica punti vendita?",
        "a": "Il rosso indica che il punto vendita è sotto l'obiettivo di budget previsto per quel periodo. Il colore nero (non verde) indica invece che è in linea o sopra il budget."
      },
      {
        "q": "Non vedo il grafico del Cashflow: perché?",
        "a": "Il grafico compare solo se sono stati importati movimenti bancari degli ultimi 30 giorni. Se è vuoto, il riquadro ti suggerisce di importare gli estratti conto da ImportHub."
      },
      {
        "q": "Come faccio ad aprire la scheda di un singolo punto vendita dalla Dashboard?",
        "a": "Clicca sulla riga del punto vendita nella tabella 'Performance' (o sulla freccia a destra): si apre direttamente la pagina di dettaglio di quel punto vendita."
      },
      {
        "q": "Cosa devo fare se vedo l'avviso 'movimenti bancari senza categoria contabile'?",
        "a": "Clicca su 'Vai ai movimenti' nell'avviso: ti porta direttamente all'elenco dei movimenti bancari senza categoria, dove puoi assegnarla."
      }
    ]
  },
  {
    "path": "/outlet/operativi",
    "icon": "Store",
    "title": "Outlet operativi",
    "description": "Questa pagina raccoglie tutti i punti vendita già aperti: da qui puoi vedere i ricavi dell'anno, aprire la scheda di dettaglio di ciascun outlet, creare un nuovo outlet e gestirne i documenti e le scadenze contrattuali.",
    "sections": [
      {
        "heading": "La griglia degli outlet",
        "body": "All'apertura della pagina vedi una card per ogni punto vendita, con nome, codice, centro commerciale, data di apertura, un'etichetta di stato (Attivo, Programmato oppure Chiuso, calcolata automaticamente dalle date di apertura/chiusura) e i ricavi dell'anno selezionato. In alto trovi una barra di ricerca per filtrare per nome, codice o centro commerciale, e il pulsante 'Aggiorna' per ricaricare i dati. Cliccando su una card si apre la scheda di dettaglio dell'outlet. L'anno mostrato è quello scelto con il selettore periodo in alto nel gestionale."
      },
      {
        "heading": "Creare un nuovo outlet manualmente",
        "body": "Se hai i permessi necessari vedi il pulsante 'Nuovo outlet', che apre una procedura guidata a più passaggi. Ogni passaggio raccoglie un gruppo di informazioni; puoi tornare indietro con 'Indietro' e proseguire con 'Avanti'. Nell'ultimo passaggio trovi il riepilogo di tutti i dati inseriti, da controllare prima di salvare.",
        "steps": [
          "Anagrafica: nome outlet, codice, insegna/brand, tipo (Outlet, Retail, Corner), superficie lorda e di vendita, codice unità nel centro.",
          "Ubicazione: centro commerciale, società concedente, indirizzo, città, provincia, regione.",
          "Contratto: data consegna immobile, data apertura (obbligatoria), conferma apertura, date di inizio/fine contratto, durata, giorni gratuiti iniziali, mese della clausola di recesso.",
          "Canone e Costi: canone annuo garantito (il canone mensile si calcola da solo), canone al metro quadro, percentuale di canone variabile, eventuali canoni diversi per anno 2 e anno 3, spese condominiali e marketing mensili, budget personale mensile.",
          "Garanzie e Target: fideiussione/deposito cauzionale, anticipo canone, costi di allestimento, target di margine e di costo merce, soglia di fatturato minimo per il recesso, note libere.",
          "Riepilogo: controlla tutti i dati inseriti e conferma con 'Crea outlet'."
        ]
      },
      {
        "heading": "Creare un outlet a partire da un contratto",
        "body": "In alternativa al form manuale, il pulsante 'Crea da contratto' permette di caricare il file del contratto di affitto: il sistema ne estrae automaticamente i dati principali (date, canoni, garanzie...) e apre la stessa procedura guidata già pre-compilata, con un passaggio in più dedicato agli allegati del contratto (planimetrie, condizioni generali, fideiussioni, ecc.), dove puoi caricare subito i file oppure farlo in un secondo momento dalla scheda dell'outlet. Verifica sempre i dati pre-compilati prima di salvare, perché provengono da un'estrazione automatica."
      },
      {
        "heading": "Scheda di dettaglio outlet — Overview",
        "body": "Aprendo un outlet vedi quattro numeri chiave (ricavi dell'anno, media mensile, mese migliore, incidenza della locazione sui ricavi), il grafico degli incassi degli ultimi 7 giorni, eventuali avvisi di scadenza contrattuale (contratto in scadenza, clausola di recesso, fideiussione in scadenza, fine periodo contrattuale), il confronto mese per mese tra preventivo e consuntivo, l'anagrafica sintetica dell'outlet e, se disponibili, i dati estratti dal contratto (date chiave, importi, condizioni)."
      },
      {
        "heading": "Scheda di dettaglio outlet — Corrispettivi, Budget, Staff",
        "body": "La scheda dell'outlet ha altre tre schede interne. 'Corrispettivi' mostra gli incassi giornalieri (con selettore 7/30/90 giorni), il totale del periodo, la media giornaliera, lo scontrino medio, il giorno migliore, un grafico e la tabella giorno per giorno. 'Budget' rimanda alla pagina Budget & Controllo per il dettaglio completo, mostrando intanto un grafico dei ricavi a budget. 'Staff' elenca i dipendenti assegnati all'outlet con ruolo, tipo di contratto, retribuzione annua lorda e stato (Attivo/Cessato), oltre al numero di dipendenti attivi e al costo medio per dipendente."
      },
      {
        "heading": "Scheda di dettaglio outlet — Documenti",
        "body": "In questa scheda trovi due archivi. 'Archivio documenti' permette di caricare (anche trascinando i file, fino a 50 MB ciascuno), cercare, filtrare per categoria (Contratto, Allegato, Rinnovo, Comunicazione), anteprima, scaricare, eliminare i documenti e consultarne lo storico versioni quando un file viene sostituito. 'Documenti e allegati' è invece una lista di allegati richiesti (ad esempio quelli citati nel contratto): ogni voce mostra se è già stata caricata, permette di caricare il file cliccandoci sopra, visualizzarlo o eliminarlo, e puoi aggiungere nuovi tipi di allegato con 'Aggiungi tipo allegato'."
      },
      {
        "heading": "Modificare o eliminare un outlet",
        "body": "Dalla scheda di dettaglio, se hai i permessi, trovi i pulsanti 'Modifica' (riapre la stessa procedura guidata con i dati già inseriti, da correggere) e 'Elimina' (chiede conferma prima di procedere e avverte che verranno eliminati anche tutti gli allegati collegati a quell'outlet)."
      }
    ],
    "faq": [
      {
        "q": "Perché non vedo i pulsanti 'Nuovo outlet' o 'Modifica/Elimina'?",
        "a": "Questi pulsanti sono visibili solo agli utenti con i permessi adeguati. Se ti servono, contatta chi gestisce gli accessi del gestionale."
      },
      {
        "q": "Cosa significa l'etichetta Attivo, Programmato o Chiuso su una card?",
        "a": "Non è un dato inserito a mano: viene calcolato dalle date di apertura e chiusura dell'outlet. 'Programmato' significa che la data di apertura è nel futuro, 'Chiuso' che la data di chiusura è già passata, 'Attivo' negli altri casi."
      },
      {
        "q": "Come cambio l'anno di cui vedo i ricavi?",
        "a": "Usa il selettore del periodo/anno che si trova in alto nel gestionale: è lo stesso selettore usato anche nella pagina Budget & Controllo, quindi i numeri restano coerenti tra le due pagine."
      },
      {
        "q": "Posso caricare più documenti insieme nell'Archivio documenti?",
        "a": "Sì, puoi trascinare più file contemporaneamente nella zona di caricamento oppure selezionarne più di uno dal pulsante 'Carica documenti'. Ogni file può arrivare al massimo a 50 MB."
      },
      {
        "q": "Cosa succede se carico di nuovo un file con lo stesso nome?",
        "a": "Il sistema conserva la versione precedente nello storico versioni (icona con l'orologio), così puoi sempre risalire ai file caricati in passato per quel documento."
      }
    ]
  },
  {
    "path": "/outlet/valutazione",
    "icon": "Store",
    "title": "Outlet in valutazione",
    "description": "In questa pagina puoi costruire delle simulazioni di conto economico per ipotesi di nuovi outlet non ancora aperti, per valutare in anticipo se convengono, senza toccare i dati reali degli outlet già operativi.",
    "sections": [
      {
        "heading": "Simulazioni salvate",
        "body": "In alto trovi l'elenco delle simulazioni già create, ciascuna con nome, totale costi e totale ricavi inseriti, data di creazione e un'etichetta di stato (Bozza, Approvato o Archiviato). Clicca su una simulazione per aprirla e modificarla. Il pulsante '+ Nuova simulazione' apre una bozza vuota."
      },
      {
        "heading": "Creare una nuova simulazione",
        "body": "Dopo aver cliccato su 'Nuova simulazione', dai un nome alla simulazione (ad esempio il nome del possibile nuovo outlet) e compila i due elenchi affiancati: 'Componenti Negative' per i costi e 'Componenti Positive' per i ricavi. Ogni elenco è organizzato per macro-voce (aprendo/chiudendo le voci con la freccetta) fino ad arrivare ai singoli conti, dove puoi digitare l'importo previsto. Tutti gli importi partono da zero: nella nuova simulazione non c'è nessun dato precompilato dagli outlet reali.",
        "steps": [
          "Clicca '+ Nuova simulazione'.",
          "Scrivi un nome che identifichi l'ipotesi di outlet.",
          "Compila gli importi previsti nei costi (Componenti Negative) e nei ricavi (Componenti Positive), voce per voce.",
          "Controlla il riquadro in basso con l'utile o la perdita prevista e il margine percentuale.",
          "Clicca 'Salva' per registrare la simulazione."
        ]
      },
      {
        "heading": "Il risultato della simulazione",
        "body": "In fondo alla pagina trovi il totale costi, il totale ricavi e il risultato ('Utile previsto' o 'Perdita prevista') calcolato automaticamente man mano che inserisci gli importi, insieme al margine percentuale sui ricavi previsti."
      },
      {
        "heading": "Gestire una simulazione esistente",
        "body": "Aprendo una simulazione salvata puoi modificarne gli importi e salvare di nuovo. Il menu a tendina 'Copia da simulazione...' permette di riprendere costi e ricavi da un'altra simulazione già creata, come punto di partenza. Il pulsante 'Cancella dati' azzera tutti gli importi inseriti (utile per ripartire da zero). 'Chiudi' esce dalla simulazione senza perdere quanto già salvato."
      },
      {
        "heading": "Stato ed eliminazione di una simulazione",
        "body": "Ogni simulazione nasce come 'Bozza'. Dall'elenco puoi farla avanzare di stato con le icone a fianco: la stella la porta ad 'Approvato', l'icona archivio la porta ad 'Archiviato'. L'icona del cestino elimina la simulazione, con una richiesta di conferma perché l'operazione non è reversibile."
      }
    ],
    "faq": [
      {
        "q": "Che differenza c'è tra 'Outlet operativi' e 'Outlet in valutazione'?",
        "a": "'Outlet operativi' mostra i punti vendita già aperti con i loro dati reali. 'Outlet in valutazione' serve invece a simulare, con numeri ipotetici, come potrebbe andare un outlet non ancora esistente, prima di decidere se aprirlo."
      },
      {
        "q": "Da dove partono gli importi di una nuova simulazione?",
        "a": "Partono sempre da zero: nessun valore viene copiato automaticamente dagli outlet reali. Puoi però usare 'Copia da simulazione...' per riprendere i numeri di un'altra ipotesi già inserita."
      },
      {
        "q": "Se approvo una simulazione, l'outlet viene creato automaticamente?",
        "a": "No. La simulazione resta uno strumento di valutazione. Se poi si decide di aprire davvero il nuovo punto vendita, l'outlet operativo va creato a parte dalla pagina 'Outlet operativi', con il pulsante 'Nuovo outlet'."
      },
      {
        "q": "Posso avere più simulazioni per la stessa ipotesi di outlet?",
        "a": "Sì, puoi creare tutte le simulazioni che vuoi, ad esempio per confrontare scenari diversi (canone più alto, meno personale, ecc.) usando anche la funzione 'Copia da simulazione...' per non ripartire da zero ogni volta."
      }
    ]
  },
  {
    "path": "/confronto-outlet",
    "icon": "GitCompare",
    "title": "Confronto Outlet",
    "description": "Questa pagina mette a confronto, fianco a fianco, il conto economico di tutti gli outlet: puoi vedere chi fattura di più, chi ha il margine migliore e come si scostano i risultati reali rispetto al preventivo.",
    "sections": [
      {
        "heading": "Filtri: periodo e vista",
        "body": "In alto vedi l'anno e il periodo attivi (impostati dal selettore periodo generale del gestionale) e tre pulsanti per scegliere la vista: 'Preventivo' mostra i dati a budget, 'Consuntivo' mostra i dati reali registrati, 'Scostamento' mostra la differenza tra consuntivo e preventivo. In alto a destra trovi il pulsante per esportare i dati mostrati."
      },
      {
        "heading": "KPI di sintesi",
        "body": "Quattro riquadri riassumono la situazione della catena: quanti outlet hanno dati disponibili, i ricavi totali (con lo scostamento complessivo rispetto al preventivo, quando ci sono mesi consuntivati), il numero totale di dipendenti assegnati agli outlet, e il ricavo medio per dipendente."
      },
      {
        "heading": "Grafici comparativi",
        "body": "Due grafici a barre mostrano, per ogni outlet, i ricavi e il margine, con colori diversi per outlet e (nel grafico del margine) rosso quando il margine è negativo."
      },
      {
        "heading": "Tabella di benchmark",
        "body": "Una tabella riassuntiva mette a confronto tutti gli outlet su una serie di indicatori (ricavi, margine in euro e in percentuale, numero dipendenti, ricavo per dipendente, costo personale, affitto, incidenza del personale e dell'affitto sui ricavi). Il valore migliore di ogni riga è evidenziato in verde; in vista 'Scostamento' i colori seguono invece il significato del cambiamento (verde se il numero è andato nella direzione giusta, rosso se in quella sbagliata)."
      },
      {
        "heading": "Schede outlet — confronto dettagliato",
        "body": "Sotto la tabella trovi una scheda per ogni outlet, con i ricavi (o lo scostamento, in vista Scostamento), un'etichetta che indica quanto è affidabile il dato mostrato ('Granitico' = dato reale confermato, 'X reali + Y previsti' = dato misto, 'Preventivo' = solo stima), il numero di dipendenti assegnati, lo scostamento rispetto al preventivo, un link 'Apri in Budget & Controllo' per andare al dettaglio di quell'outlet, quattro riquadri di costo (acquisto merci, costo personale, costo locazioni, costo per servizi), il margine dell'outlet e, quando disponibile, la quota di costi di sede attribuita e il margine dopo la sede (ed eventualmente dopo le imposte). Il pulsante 'Mostra dettaglio' apre l'elenco completo delle voci di costo e ricavo di quell'outlet."
      }
    ],
    "faq": [
      {
        "q": "Cosa vuol dire l'etichetta 'Scostamento' su una scheda outlet?",
        "a": "È la differenza tra il dato consuntivo (reale) e il preventivo, calcolata solo sui mesi già chiusi. Il segno meno in rosso indica che il risultato è sotto il preventivo, un valore senza segno (nero) indica che è pari o sopra."
      },
      {
        "q": "Cosa significa l'etichetta 'Granitico' su una scheda?",
        "a": "Indica che il dato mostrato è un consuntivo reale e confermato, non una stima. Se vedi invece 'X reali + Y previsti' significa che alcuni mesi hanno un dato reale e altri sono ancora stimati."
      },
      {
        "q": "Perché un outlet mostra 'Nessun dato'?",
        "a": "Significa che per quell'outlet non ci sono ancora dati caricati dal Budget o dal Bilancio per il periodo selezionato. Puoi caricarli dalla pagina Budget & Controllo."
      },
      {
        "q": "Cosa vuol dire 'Quota sede'?",
        "a": "È la parte dei costi generali di sede e magazzino attribuita a ciascun outlet, ripartita in proporzione al suo fatturato. Sottraendola al margine dell'outlet si ottiene il 'Margine dopo sede'."
      }
    ]
  },
  {
    "path": "/margini",
    "icon": "BarChart3",
    "title": "Analisi Margini per Outlet",
    "description": "Questa pagina calcola, a partire dai dati di budget, il margine di ciascun outlet mese per mese, evidenziando con colori chi sta andando bene e chi ha margini bassi o negativi.",
    "sections": [
      {
        "heading": "Selezione dell'anno",
        "body": "In alto puoi scegliere l'anno da analizzare da un menu a tendina: l'elenco degli anni disponibili viene costruito automaticamente in base a quelli presenti nei dati di budget."
      },
      {
        "heading": "Avviso margini critici",
        "body": "Se uno o più outlet hanno un margine inferiore al 5%, compare in alto un banner rosso che li elenca, per farteli notare subito senza dover scorrere tutta la pagina."
      },
      {
        "heading": "Riepilogo numerico",
        "body": "Quattro riquadri mostrano il numero di outlet analizzati, i ricavi totali, i costi totali e il margine medio della catena per l'anno selezionato."
      },
      {
        "heading": "Grafico ricavi, costi e margine",
        "body": "Un grafico a barre confronta, outlet per outlet, ricavi, costi e margine in euro; sopra la barra del margine è indicata anche la percentuale di margine."
      },
      {
        "heading": "Mappa colorata dei margini mensili",
        "body": "Una tabella mostra, per ogni outlet (righe) e per ogni mese (colonne), il margine percentuale di quel mese, colorato dal verde (margine alto) al rosso (margine basso o negativo). La legenda con le fasce di colore è riportata sotto la tabella."
      },
      {
        "heading": "Tabella di dettaglio con approfondimento per conto",
        "body": "In fondo trovi la tabella con ricavi, costi, margine e margine percentuale di ogni outlet, ordinabile cliccando sulle intestazioni delle colonne. Cliccando su una riga si apre il dettaglio con l'elenco dei conti di ricavo e di costo che compongono quel totale. In fondo alla tabella c'è la riga con i totali della catena."
      }
    ],
    "faq": [
      {
        "q": "Da dove arrivano i dati di ricavi e costi mostrati in questa pagina?",
        "a": "Vengono dai dati di budget (budget_entries): i conti che iniziano per 5 sono considerati ricavi, quelli che iniziano per 6 o 7 sono considerati costi."
      },
      {
        "q": "Cosa significa il colore rosso nella mappa mensile?",
        "a": "Indica un mese con margine basso o negativo per quell'outlet. Il verde indica invece un margine alto: la legenda sotto la tabella spiega le fasce percentuali associate a ciascun colore."
      },
      {
        "q": "Come vedo il dettaglio dei singoli conti di un outlet?",
        "a": "Clicca sulla riga dell'outlet nella tabella in fondo alla pagina: si apre un pannello con l'elenco dei conti di ricavo e di costo che compongono il totale mostrato."
      },
      {
        "q": "Perché non vedo nessun anno nel menu a tendina?",
        "a": "L'elenco degli anni si costruisce solo dai dati effettivamente presenti nel budget: se non è stato ancora caricato nessun dato, il menu resterà vuoto o mostrerà solo l'anno corrente."
      }
    ]
  },
  {
    "path": "/margini-categoria",
    "icon": "BarChart3",
    "title": "Margini per Categoria",
    "description": "Questa pagina calcola i margini reali degli outlet a partire dagli incassi giornalieri e dai costi effettivamente registrati (fatture fornitori e movimenti bancari), e permette di guardare la struttura dei costi e l'andamento nel tempo.",
    "sections": [
      {
        "heading": "Filtri periodo ed esportazione",
        "body": "In alto puoi scegliere il periodo di analisi tra 'YTD' (da inizio anno corrente a oggi) e 'Ultimi 12 mesi'. Il pulsante di esportazione accanto ti permette di scaricare i dati mostrati."
      },
      {
        "heading": "Riepilogo numerico",
        "body": "Una riga di riquadri mostra ricavi totali, costi totali, margine (in euro e percentuale), numero di outlet attivi, l'outlet con il margine migliore e quello con il margine peggiore, con relativa percentuale."
      },
      {
        "heading": "Scheda Per Outlet",
        "body": "Mostra un grafico a barre con ricavi, costi e margine di ciascun outlet, seguito da una tabella ordinabile (clicca sulle intestazioni delle colonne) con ricavi, costi, margine, margine percentuale, numero di scontrini, scontrino medio, budget assegnato con lo scostamento percentuale, e un pallino colorato che indica se l'outlet ha raggiunto il proprio margine obiettivo (verde) o no (ambra); il pallino è grigio se l'outlet non ha ancora ricavi nel periodo."
      },
      {
        "heading": "Scheda Struttura Costi",
        "body": "Mostra un grafico a torta con la distribuzione dei costi per macro-categoria (ad esempio Locazione & Affitti, Personale, Generali & Amministrative, Oneri Finanziari, Oneri Diversi) e, a fianco, un elenco dettagliato con l'importo e la percentuale di ogni categoria, con una barra di avanzamento e le singole voci di costo che la compongono."
      },
      {
        "heading": "Scheda Trend Mensile",
        "body": "Mostra due grafici: il confronto mese per mese tra ricavi e costi, e l'andamento del margine percentuale nel tempo."
      }
    ],
    "faq": [
      {
        "q": "Che differenza c'è tra questa pagina e 'Analisi Margini per Outlet'?",
        "a": "Questa pagina calcola i margini sui dati realmente registrati (incassi giornalieri e fatture/costi bancari nel periodo scelto), mentre 'Analisi Margini per Outlet' li calcola sui dati inseriti a budget. Possono quindi mostrare numeri diversi."
      },
      {
        "q": "Perché vedo il messaggio 'Nessun dato nel periodo selezionato'?",
        "a": "Significa che per il periodo scelto non risultano ancora importati i corrispettivi (incassi giornalieri) o le fatture dei fornitori. Puoi importarli dalla pagina Import Hub."
      },
      {
        "q": "Cosa indica il pallino colorato nella tabella 'Per Outlet'?",
        "a": "Indica se l'outlet ha raggiunto o superato il margine percentuale obiettivo impostato per quel punto vendita: verde se raggiunto, ambra se sotto obiettivo, grigio se l'outlet non ha ancora ricavi nel periodo."
      },
      {
        "q": "Come cambio il periodo analizzato?",
        "a": "Usa i due pulsanti in alto: 'YTD' mostra l'anno corrente da gennaio a oggi, 'Ultimi 12 mesi' mostra invece i dodici mesi precedenti alla data odierna."
      }
    ]
  },
  {
    "path": "/scadenzario",
    "icon": "Receipt",
    "title": "Scadenzario e Distinta pagamenti",
    "description": "Da qui vedi tutte le fatture dei fornitori da pagare, prepari la distinta dei bonifici da mandare a chi esegue i pagamenti e, quando torna confermata, la registri nel gestionale. Una fattura risulta davvero \"pagata\" solo quando il bonifico arriva in banca e viene abbinato a lei: fino ad allora resta \"in sospeso\".",
    "sections": [
      {
        "heading": "A cosa serve questa pagina e come leggere l'elenco",
        "body": "Lo Scadenzario raccoglie tutte le scadenze di pagamento verso i fornitori (e, se attive, le scadenze fiscali come F24). In alto trovi tre schede: \"Situazione\" mostra un riepilogo generale (quanto c'è da pagare, quanto è scaduto, la liquidità disponibile), \"Scadenzario\" è la lista operativa delle fatture con cui lavori ogni giorno, \"Ricorrenze\" mostra i costi che si ripetono nel tempo (affitti, utenze, abbonamenti). Nella scheda \"Scadenzario\" ogni riga è una scadenza: fornitore, numero fattura, importo, data di scadenza e stato colorato (Scaduto in rosso, In scadenza in arancio, Da pagare in blu, Parziale in arancio scuro, Pagato in verde, In sospeso con un'etichetta a orologio). Puoi filtrare per outlet, per stato, per metodo di pagamento (Bonifici, RiBa, Addebito diretto, Altro) e cercare per nome fornitore o numero fattura. Con il pulsante di vista in alto a destra scegli come vedere l'elenco: \"Mese\" (predefinita) raggruppa le scadenze in sezioni mensili collassabili, \"Lista piatta\" mostra tutte le righe di seguito, \"Calendario\" le dispone sul calendario. Nella vista Mese, dentro ogni mese le scadenze sono ordinate per fornitore in ordine alfabetico (le righe dello stesso fornitore restano vicine, aggregate); a parità di fornitore compaiono dalla fattura più vecchia, ordinate prima per data di emissione fattura e poi per numero fattura. Se clicchi le intestazioni di colonna per un ordinamento personalizzato, quello ha la precedenza (con il pulsante \"Reset\" torni all'ordine predefinito). Le note di credito compaiono con l'importo in rosso col segno meno: non si pagano, ma si possono usare per abbassare l'importo di una fattura dello stesso fornitore (vedi più sotto). È questa la scheda che usi per selezionare le fatture e creare la distinta dei bonifici."
      },
      {
        "heading": "Aggiungere una scadenza a mano (es. un proforma)",
        "body": "Per una scadenza che non arriva dalle fatture elettroniche (per esempio un proforma o un pagamento concordato) usa il pulsante \"Aggiungi scadenza\". Scegli il nominativo (un fornitore già a sistema oppure aggiungine uno nuovo al volo), il tipo, il numero documento, la data documento e l'importo totale. La data di scadenza NON si scrive a mano: viene calcolata in automatico dalle REGOLE INTERNE, cioè dal piano di pagamento del fornitore (base a data fattura o fine mese, giorni, numero di rate) oppure, se quel fornitore non ha un piano impostato, dalla regola predefinita \"a vista\" = 30 giorni data fattura a fine mese, in un'unica rata. Le scadenze così proposte restano correggibili: puoi modificare date e importi, aggiungere o togliere rate, e il pulsante \"Ricalcola dalle regole\" rimette il calcolo automatico. La somma delle rate deve sempre coincidere con l'importo totale (un avviso te lo segnala se non torna). Gli importi (totale e singole rate) si inseriscono digitando: i campi non hanno più le frecce su/giù e non cambiano con la rotella del mouse, così non si modificano per errore.",
        "steps": [
          "Premi \"Aggiungi scadenza\" in alto nella scheda Scadenzario.",
          "Scegli il nominativo, imposta data documento e importo: le scadenze si calcolano da sole con le regole del fornitore (o \"a vista\" 30 gg fine mese di default).",
          "Se serve, correggi le date/importi delle rate a mano, oppure premi \"Ricalcola dalle regole\" per ripristinare il calcolo automatico.",
          "Lascia \"Una tantum\" per inserire solo questa scadenza; scegli una periodicità (mensile, trimestrale…) solo se il costo va registrato anche tra le Ricorrenze.",
          "Premi \"Crea scadenza\": vengono create tante righe quante sono le rate."
        ]
      },
      {
        "heading": "Passo 1 — Selezionare le fatture da pagare",
        "body": "Ogni volta che selezioni una fattura, il gestionale apre sotto la riga un piccolo pannello per impostare come pagarla; in fondo alla pagina compare una barra con il totale selezionato e, per ogni banca coinvolta, il saldo attuale e il saldo che resterebbe dopo il pagamento — così controlli sempre a colpo d'occhio di non andare in rosso.",
        "steps": [
          "Vai sulla scheda \"Scadenzario\" (in alto) e, se vuoi, filtra per stato \"Da pagare\", \"Scaduto\" o simili per vedere solo ciò che ti interessa.",
          "Spunta la casella a sinistra di ogni fattura che vuoi mettere in pagamento.",
          "Se una fattura risulta già \"in distinta\" da prima, il gestionale ti avvisa con un messaggio: non verrà aggiunta due volte.",
          "Controlla in basso il totale selezionato e i saldi delle banche coinvolte."
        ]
      },
      {
        "heading": "Passo 2 — Assegnare banca e tipo di pagamento",
        "body": "Nel pannello che si apre sotto ogni fattura selezionata scegli da quale conto bancario pagare e se si tratta di un pagamento a Saldo o Parziale. \"Saldo\" significa che paghi tutto il residuo della fattura ed è quindi un pagamento di tipo SALDO. \"Parziale\" significa che versi solo un acconto: scrivi l'importo che vuoi pagare ed è un pagamento di tipo ACCONTO. Se la fattura fa parte di un piano a rate (per esempio 1 di 3, 2 di 3), il gestionale calcola da solo se è un ACCONTO (rata intermedia) o un SALDO (ultima rata) e lo scrive accanto all'importo, insieme al numero della rata. Se non assegni una banca a una fattura selezionata, il pulsante per creare la distinta resta bloccato e compare un avviso."
      },
      {
        "heading": "Passo 3 — Compensare le note di credito (facoltativo)",
        "body": "Se il fornitore della fattura selezionata ha anche delle note di credito ancora aperte, nel pannello compaiono dei pulsanti \"Scala note di credito\" con l'importo di ciascuna nota. Selezionandone una o più, l'importo del bonifico si riduce automaticamente di quel valore (il \"netto bonifico\" si aggiorna subito) e la causale del pagamento riporta il riferimento alle note usate, per esempio \"al netto NC n.123 e NC n.456\", pronta da copiare nel bonifico vero e proprio. Le note di credito NON vengono chiuse in questo momento: restano collegate alla fattura e si chiuderanno insieme a lei solo quando il pagamento verrà davvero riconosciuto in banca."
      },
      {
        "heading": "Passo 4 — Creare la distinta",
        "body": "Quando hai selezionato tutte le fatture della giornata e impostato banca/tipo per ciascuna, premi il pulsante \"Crea distinta\" nella barra in basso. Si apre un'anteprima con il riepilogo per ogni banca (IBAN, saldo attuale, elenco pagamenti, totale e saldo stimato dopo i pagamenti) e il testo di una email già pronta da inviare. In questo momento non viene ancora scritto nulla nel gestionale: puoi rileggere con calma, correggere qualcosa tornando indietro e rigenerare la distinta quante volte vuoi.",
        "steps": [
          "Premi \"Crea distinta\": si apre l'anteprima con il dettaglio per ogni banca coinvolta.",
          "Controlla fornitori, importi, IBAN beneficiario e causali (comprese le eventuali note di credito).",
          "Se qualcosa non torna, chiudi l'anteprima, correggi la selezione o il pannello di banca/tipo e ricrea la distinta.",
          "Quando è tutto corretto, apri la mail predisposta con il pulsante dedicato (si apre Gmail con oggetto e testo già compilati) oppure copia il testo per incollarlo altrove, e inviala a chi esegue materialmente i bonifici."
        ]
      },
      {
        "heading": "Passo 5 — Confermare la distinta",
        "body": "Solo quando premi \"Conferma distinta\" nella finestra di anteprima, il gestionale registra davvero le fatture selezionate: passano allo stato \"in sospeso\" e spariscono dall'elenco delle scadenze attive. Attenzione: la conferma NON segna le fatture come pagate. Significa solo che è stata predisposta e inviata la disposizione di pagamento; restano in attesa finché il bonifico non arriva davvero in banca. Se chiudi la finestra di anteprima senza premere \"Conferma distinta\", non viene salvato nulla e le fatture restano normalmente selezionabili.",
        "steps": [
          "Nella finestra di anteprima, premi \"Conferma distinta\".",
          "Le fatture incluse passano allo stato \"in sospeso\" ed escono dall'elenco principale delle scadenze da pagare.",
          "Se torni sulla pagina in un altro momento, ritrovi il lavoro non ancora confermato: il gestionale salva da solo una bozza nel browser (visibile con il messaggio \"Bozza distinta ripristinata\"); si azzera solo dopo la conferma o se premi \"Annulla\"."
        ]
      },
      {
        "heading": "Dopo la conferma: stato \"In sospeso\" e riconciliazione",
        "body": "Le fatture disposte in distinta si trovano usando il filtro di stato \"In sospeso\" (o il riquadro rapido in alto con conteggio e totale). Restano lì finché non succede una di queste due cose: il movimento bancario in uscita arriva sull'estratto conto e viene riconosciuto automaticamente (allora la fattura, e le eventuali note di credito collegate, si chiudono da sole), oppure il bonifico non viene riconosciuto in automatico (per esempio perché la causale non è chiara, o perché l'importo è al netto di una nota di credito) e va abbinato a mano dalla pagina Banche, sezione Riconciliazione, senza creare doppioni. Se ti accorgi di aver sbagliato qualcosa dopo la conferma (per esempio la banca), usa \"Rimuovi dalla distinta\" sulla singola fattura: torna attiva e puoi ricrearla con i dati giusti."
      },
      {
        "heading": "Chiudere una scadenza a mano",
        "body": "Se un pagamento non passerà mai da un movimento bancario tracciato nel gestionale (per esempio pagamento in contanti, compensazione, o un vecchio pagamento fatto fuori sistema), puoi chiuderlo a mano invece di aspettare la riconciliazione. Dal menu di stato di una fattura scegli \"Chiudi a mano\": indichi la data, un importo (puoi chiudere anche solo una parte del residuo, lasciando la fattura \"parziale\" per il resto) e, se vuoi, una motivazione. L'operazione viene registrata nel partitario del fornitore con la dicitura \"Chiusa a mano\" ma non crea nessun movimento bancario: i movimenti reali restano solo quelli davvero importati dall'estratto conto. Per una nota di credito, la chiusura a mano è sempre totale e viene registrata in Avere."
      }
    ],
    "faq": [
      {
        "q": "Quando aggiungo una scadenza a mano, perché non posso scrivere io la data di scadenza?",
        "a": "Perché la scadenza segue le regole interne, non una data personalizzata: il gestionale la calcola dal piano del fornitore (base data fattura o fine mese, giorni, numero rate) o, se il fornitore non ha un piano, dalla regola predefinita \"a vista\" = 30 giorni data fattura a fine mese. Esempio: un documento del 30/06 a vista scade il 31/07. Se un caso particolare lo richiede puoi comunque correggere date e importi a mano dopo il calcolo; \"Ricalcola dalle regole\" ripristina i valori automatici."
      },
      {
        "q": "Come inserisco un pagamento a più rate?",
        "a": "Se il fornitore ha un piano con più rate, aggiungendo la scadenza le rate vengono già proposte tutte, con date e importi calcolati (parti uguali, l'ultima quadra il totale). Puoi anche costruirle a mano con \"Aggiungi rata\" e il cestino per toglierne: l'importante è che la somma delle rate coincida con l'importo totale. Alla creazione ogni rata diventa una riga dello scadenzario, numerata (rata 1/3, 2/3…)."
      },
      {
        "q": "\"Una tantum\" vuol dire che quel costo non si ripeterà mai?",
        "a": "No. \"Una tantum\" significa solo che in questa occasione stai inserendo una singola scadenza; lo stesso costo potrà ripresentarsi in futuro e lo reinserirai allo stesso modo. Se invece vuoi registrarlo come costo che si ripete automaticamente, scegli una periodicità (mensile, trimestrale, ecc.): oltre alla prima scadenza verrà creata anche una Ricorrenza."
      },
      {
        "q": "Quando una fattura risulta davvero pagata?",
        "a": "Mai al momento della conferma della distinta. Una fattura diventa \"pagata\" solo quando il movimento bancario in uscita viene riconosciuto e abbinato a lei (in automatico o a mano in Riconciliazione), oppure se la chiudi tu manualmente. Fino ad allora resta \"in sospeso\"."
      },
      {
        "q": "Ho confermato la distinta ma avevo scelto la banca sbagliata: come rimedio?",
        "a": "Vai sul filtro \"In sospeso\", trova la fattura e usa il pulsante \"Rimuovi dalla distinta\": torna attiva come prima e puoi rifare la selezione con la banca corretta. Se non hai ancora confermato, basta cambiare la banca nel pannello sotto la riga e ricreare l'anteprima."
      },
      {
        "q": "Che differenza c'è tra ACCONTO e SALDO nella distinta?",
        "a": "È ACCONTO quando scegli \"Parziale\" (paghi solo una parte) oppure quando la fattura è una rata intermedia di un piano a più rate. È SALDO quando paghi tutto il residuo, oppure quando è l'ultima rata del piano. L'etichetta mostra anche il numero di rata, ad esempio \"SALDO (rata 3/3)\"."
      },
      {
        "q": "Una fattura da 8.000 euro ha due note di credito da 1.000 euro ciascuna: come procedo?",
        "a": "Seleziona la fattura, poi nel pannello sotto la riga usa \"Scala note di credito\" e spunta le due note: il bonifico da fare diventa 6.000 euro e la causale suggerita cita entrambe le note. Esegui il bonifico per 6.000; quando viene riconciliato, la fattura e le due note di credito si chiudono insieme, in automatico."
      },
      {
        "q": "Se chiudo una fattura a mano e poi il bonifico arriva comunque sull'estratto conto, si conta due volte?",
        "a": "No. La chiusura a mano non genera nessun movimento bancario nel gestionale: i movimenti reali sono solo quelli importati dall'estratto conto. Se il bonifico arriva davvero, lo abbini alla fattura (anche se già chiusa a mano) dalla pagina Banche → Riconciliazione, così non resta un movimento senza abbinamento."
      },
      {
        "q": "Perdo il lavoro se cambio pagina o chiudo il browser prima di confermare la distinta?",
        "a": "No, il gestionale salva automaticamente una bozza nel tuo browser mentre selezioni le fatture. Quando torni sulla pagina la ritrovi già pronta con un messaggio di conferma. Attenzione: la bozza è legata al tuo browser/computer, non è condivisa con le colleghe che usano un altro postazione."
      },
      {
        "q": "Come sposto in avanti la scadenza di una fattura?",
        "a": "Usa l'icona calendario \"Rimanda\" sulla riga della fattura: si apre una finestra con un tasto rapido \"Fine mese successivo\" (imposta come nuova scadenza l'ultimo giorno del mese successivo a quello corrente) e l'opzione \"Scegli data\" per indicare una data qualsiasi. La fattura prende la nuova scadenza e, se era scaduta, torna tra quelle da pagare."
      }
    ]
  },
  {
    "path": "/storico-distinte",
    "icon": "Receipt",
    "title": "Storico Distinte",
    "description": "Questa pagina raccoglie tutte le distinte di pagamento create dallo Scadenzario, una per ogni giorno in cui hai confermato dei pagamenti verso i fornitori. Serve per ritrovare rapidamente cosa è stato disposto in un certo giorno, quanto è già stato pagato e quanto è ancora in attesa.",
    "sections": [
      {
        "heading": "A cosa serve questa pagina",
        "body": "Ogni volta che nello Scadenzario premi \"Conferma distinta\", il gestionale registra un gruppo di fatture da pagare. Lo Storico Distinte raggruppa automaticamente queste registrazioni per giorno di creazione: ogni giorno diventa una \"distinta\" con l'elenco delle fatture incluse, il totale complessivo e il totale suddiviso per ciascuna banca usata. È una pagina di sola consultazione: qui non si crea né si modifica nulla, si trova solo lo storico di quello che è stato disposto."
      },
      {
        "heading": "Il riepilogo generale in alto",
        "body": "Appena entri nella pagina vedi quattro numeri riassuntivi: quante distinte esistono in totale, quante scadenze sono state disposte complessivamente, il totale disposto in euro e il totale già effettivamente pagato in euro. Questi numeri considerano tutte le distinte, non solo quelle aperte in quel momento."
      },
      {
        "heading": "Come sono organizzate le distinte",
        "body": "Le distinte sono elencate dalla più recente alla più vecchia, una riga per ogni giorno (per esempio \"Distinta del lunedì 14 luglio 2026\"). Su ogni riga, senza bisogno di aprirla, vedi già: quante scadenze contiene, un'etichetta per ogni banca coinvolta con il relativo totale, il totale complessivo della distinta e quanto di quel totale risulta già pagato.",
        "steps": [
          "Scorri l'elenco per trovare il giorno che ti interessa (le più recenti sono in alto).",
          "Clicca sulla riga della distinta per aprirla ed espandere il dettaglio.",
          "Clicca di nuovo per richiuderla."
        ]
      },
      {
        "heading": "Il dettaglio di una distinta aperta",
        "body": "Aprendo una distinta trovi prima un riquadro per ciascuna banca usata quel giorno, con il totale disposto su quella banca e quanto di quel totale è già stato pagato (con il conteggio, per esempio \"3/5\" fatture pagate su 5). Sotto trovi la tabella con ogni singola scadenza inclusa nella distinta: fornitore, numero fattura, banca, importo e stato. Lo stato di ogni riga è \"Pagato\" (etichetta verde) se il pagamento è stato riconosciuto, oppure \"In distinta\" (etichetta arancione) se è ancora in attesa di riscontro bancario."
      },
      {
        "heading": "Cosa fare se una distinta non compare",
        "body": "Se l'elenco è vuoto, significa che non è ancora stata confermata nessuna distinta dallo Scadenzario: la pagina mostra un messaggio che rimanda proprio a quel passaggio. Ricorda che una distinta appare qui solo dopo aver premuto \"Conferma distinta\" nello Scadenzario: la semplice anteprima non basta."
      }
    ],
    "faq": [
      {
        "q": "Posso modificare o cancellare una distinta da questa pagina?",
        "a": "No, questa pagina serve solo per consultare lo storico. Per correggere una fattura ancora in sospeso (per esempio se hai sbagliato banca), torna nello Scadenzario, filtra per stato \"In sospeso\" e usa \"Rimuovi dalla distinta\" sulla singola fattura."
      },
      {
        "q": "Perché una fattura risulta ancora \"In distinta\" invece di \"Pagato\"?",
        "a": "Perché il bonifico non è ancora stato riconosciuto sull'estratto conto e abbinato a quella fattura. Appena la riconciliazione avviene (in automatico o a mano dalla pagina Banche), lo stato passa a \"Pagato\" anche qui."
      },
      {
        "q": "Come sono raggruppate le distinte, per data di scadenza della fattura?",
        "a": "No, il raggruppamento è per il giorno in cui hai confermato la distinta nello Scadenzario, non per la data di scadenza delle singole fatture: fatture con scadenze diverse possono comparire nella stessa distinta se sono state disposte insieme lo stesso giorno."
      },
      {
        "q": "Il totale \"pagato\" di una banca considera solo quella distinta?",
        "a": "Sì: i totali per banca mostrati aprendo una distinta si riferiscono solo alle fatture incluse in quella specifica distinta, non a tutti i pagamenti mai fatti su quel conto."
      }
    ]
  },
  {
    "path": "/banche",
    "icon": "Landmark",
    "title": "Banche",
    "description": "La pagina Banche è il punto in cui vedi tutta la liquidità dell'azienda: saldi dei conti, movimenti in entrata e uscita, abbinamento dei pagamenti alle fatture fornitori e i finanziamenti in corso. I dati bancari arrivano automaticamente dalle banche collegate, non servono più caricamenti manuali di file.",
    "sections": [
      {
        "heading": "Panoramica",
        "body": "È la prima schermata che vedi aprendo Banche: un riepilogo veloce della situazione di cassa. In alto trovi quattro numeri: quanto c'è disponibile in banca in questo momento, quanto è entrato e quanto è uscito negli ultimi 30 giorni, e quanti movimenti sono ancora da riconciliare con le fatture fornitori. Sotto trovi un grafico con l'andamento di entrate e uscite, i saldi per singola banca, le scadenze fornitori dei prossimi 30 giorni e gli ultimi movimenti registrati.",
        "steps": [
          "Dai un'occhiata al numero \"Da riconciliare\": se è alto, conviene passare alla scheda Riconciliazione.",
          "Clicca su una delle quattro card in alto (o su \"Vedi tutto\") per essere portata direttamente nella scheda corrispondente."
        ]
      },
      {
        "heading": "Conti Bancari e Open Banking",
        "body": "In questa scheda colleghi le banche vere dell'azienda tramite Open Banking (fornitore A-Cube): una volta collegata, il gestionale riceve automaticamente saldi e movimenti, senza bisogno di caricare estratti conto a mano. Per ogni banca collegata vedi il nome, l'IBAN, il saldo aggiornato e da quanto tempo non viene sincronizzata. In alto viene mostrato anche lo stato del consenso della banca (attivo, in attesa, scaduto o revocato) e il totale disponibile su tutti i conti collegati.",
        "steps": [
          "Per collegare la prima banca, clicca \"Collega prima banca\" e compila P.IVA, ragione sociale ed email dell'azienda.",
          "Clicca \"Avvia consenso\": si apre una nuova finestra sul sito della banca, dove dai il consenso PSD2 (accesso in sola lettura ai conti).",
          "Completato il consenso, torna sulla pagina e clicca \"Ho completato il consenso — Importa conti\".",
          "Da quel momento, usa il pulsante \"Aggiorna conti e movimenti\" ogni volta che vuoi far arrivare i dati più recenti dalla banca.",
          "Per collegare un'altra banca, ripeti la procedura cliccando \"Collega altra banca\"."
        ]
      },
      {
        "heading": "Movimenti",
        "body": "Qui trovi l'elenco di tutti i movimenti bancari (entrate e uscite) con data, conto, descrizione, importo, saldo e stato di riconciliazione. Puoi cercare per descrizione o controparte, filtrare per conto, tipo (entrate/uscite), stato di riconciliazione, categoria contabile e periodo. A ogni movimento puoi assegnare una categoria contabile dal menu a tendina nella colonna \"Categoria contabile\": se manca, la casella è evidenziata in arancione. L'elenco si può esportare in PDF, CSV o Excel.",
        "steps": [
          "Usa la barra di ricerca e i filtri in alto per restringere l'elenco (ad esempio solo un conto o solo le uscite di un mese).",
          "Clicca sull'intestazione di una colonna (Data, Descrizione, Importo) per ordinare la tabella.",
          "Per assegnare o cambiare la categoria di un movimento, apri il menu a tendina nella riga corrispondente e scegli la voce giusta.",
          "Usa i pulsanti PDF, CSV o Excel in alto per esportare l'elenco filtrato."
        ]
      },
      {
        "heading": "Riepilogo del giorno",
        "body": "In cima alla scheda Riconciliazione trovi un riquadro di controllo per tenere sotto controllo il lavoro giorno per giorno. Ha due tessere: \"Riconciliati oggi\" (quanti pagamenti sono stati abbinati a una fattura nella data scelta, con il totale in euro) e \"Da riconciliare\" (quanti movimenti in uscita sono ancora senza abbinamento, con il totale). Puoi scegliere la data con le frecce o il calendario (il pulsante \"Oggi\" ti riporta al giorno corrente). Cliccando su una tessera si apre l'elenco di dettaglio: nei riconciliati vedi fornitore, fattura, data del movimento e se l'abbinamento è avvenuto in automatico o a mano; nei \"da riconciliare\" vedi data, banca, controparte e importo delle uscite ancora aperte. Per i movimenti da riconciliare puoi restringere il periodo (ultimi 30/60/90 giorni, 6 mesi o tutte) così l'elenco resta gestibile. Le commissioni bancarie e i movimenti che non sono pagamenti a fornitori (stipendi, imposte, finanziamenti, incassi) non compaiono tra i \"da riconciliare\": non vanno abbinati a una fattura. Per lo stesso motivo, sul tab Riconciliazione compare un solo numero: gli abbinamenti da confermare se ci sono, altrimenti quanti movimenti restano da abbinare.",
        "steps": [
          "Al mattino apri Banche → Riconciliazione e guarda il riquadro in alto: \"Riconciliati oggi\" ti dice cosa si è già chiuso, \"Da riconciliare\" cosa resta da abbinare.",
          "Clicca sulla tessera \"Da riconciliare\" per vedere l'elenco delle uscite ancora senza fattura, e usa il menu del periodo per concentrarti su quelle recenti.",
          "Cambia la data (frecce o calendario) per vedere cosa è stato riconciliato in un altro giorno; \"Oggi\" ti riporta alla giornata corrente.",
          "Per abbinare un movimento rimasto aperto, scorri sotto nella sezione Riconciliazione e usa gli abbinamenti suggeriti o la ricerca manuale."
        ]
      },
      {
        "heading": "Riconciliazione",
        "body": "Qui abbini i movimenti in uscita dal conto alle fatture fornitori corrispondenti, così il sistema sa quali fatture sono state effettivamente pagate. La scheda si divide in due viste: \"Da riconciliare\" e \"Riconciliati\". Nella vista \"Da riconciliare\", se il sistema trova un possibile abbinamento (per importo, nome fornitore e data) lo propone nella sezione \"Abbinamenti suggeriti\" con una percentuale di affidabilità: puoi confermarlo o rifiutarlo, anche in blocco per più righe insieme. Se selezioni un movimento dall'elenco a sinistra, a destra vedi le fatture proposte come possibile corrispondenza (o puoi cercarne una manualmente). Nella vista \"Riconciliati\" trovi tutti i movimenti già abbinati, con fornitore e numero fattura: da qui puoi annullare un abbinamento sbagliato con \"Annulla abbinamento\" (la fattura torna aperta, il movimento torna da riconciliare). Vengono proposti come abbinamento suggerito solo i casi affidabili: l'importo del movimento deve coincidere con il residuo della fattura (entro il 5%) e l'affidabilità deve essere almeno del 70%; i match con importo lontano non compaiono. Quando invece il numero della fattura è scritto per esteso nella causale del movimento e l'importo coincide, l'abbinamento si chiude già da solo (non serve confermarlo).",
        "steps": [
          "Apri \"Abbinamenti suggeriti\": per ogni proposta clicca \"Conferma\" se è corretta, oppure \"Rifiuta\" se non lo è.",
          "Per confermare più abbinamenti insieme, seleziona le caselle e clicca \"Conferma selezionati\", oppure \"Conferma tutti\" per accettarli tutti in una volta.",
          "Se un movimento non ha suggerimenti, selezionalo dall'elenco a sinistra: a destra compaiono le fatture aperte più simili per importo, oppure puoi cercare la fattura giusta a mano e collegarla.",
          "Per correggere un abbinamento già confermato, passa alla vista \"Riconciliati\" e clicca \"Annulla abbinamento\" sulla riga interessata."
        ]
      },
      {
        "heading": "Prima Nota",
        "body": "È una vista pronta per l'esportazione, utile da consegnare alla commercialista. Mostra i movimenti bancari di un periodo (anno o singolo mese, tutti i conti o uno solo) con data, conto, entrata/uscita, importo, controparte, partita IVA, causale e categoria. In alto trovi i totali del periodo (entrate, uscite, saldo netto). Da qui puoi scaricare i dati in CSV o in Excel (con un foglio di riepilogo).",
        "steps": [
          "Scegli anno, eventualmente il mese, e il conto (o \"Tutti i conti\") con i filtri in alto.",
          "Controlla i totali nelle card (Entrate, Uscite, Saldo netto) per una verifica veloce.",
          "Clicca \"CSV\" o \"Excel\" per scaricare il file da inviare alla commercialista."
        ]
      },
      {
        "heading": "Finanziamenti",
        "body": "In questa scheda tieni traccia dei finanziamenti attivi collegati ai conti bancari dell'azienda, sia quelli dei soci sia quelli bancari: importo, tasso, piano di rientro e documenti allegati (contratti, piani di ammortamento). Ogni finanziamento deve essere collegato a un conto bancario già esistente. Puoi disattivare un finanziamento chiuso senza perdere lo storico, e volendo mostrare di nuovo anche quelli disattivati.",
        "steps": [
          "Per registrare un nuovo finanziamento, apri il modulo di inserimento, scegli il conto collegato e compila importo e condizioni.",
          "Apri un finanziamento esistente per modificarlo, vedere il piano rate o caricare/scaricare i documenti allegati.",
          "Quando un finanziamento è stato completamente rimborsato, disattivalo invece di eliminarlo: i dati restano consultabili."
        ]
      }
    ],
    "faq": [
      {
        "q": "Perché non trovo più il pulsante per caricare l'estratto conto in CSV?",
        "a": "Non serve più: dal collegamento con l'Open Banking, saldi e movimenti arrivano automaticamente dalle banche collegate. Il caricamento manuale è stato disattivato nella scheda Conti Bancari."
      },
      {
        "q": "Come collego una banca nuova?",
        "a": "Vai nella scheda \"Conti Bancari\" e clicca \"Collega prima banca\" (o \"Collega altra banca\" se ne hai già una): ti verrà chiesto di dare il consenso sul sito della tua banca, poi di importare i conti."
      },
      {
        "q": "Cosa significa \"Da riconciliare\" su un movimento?",
        "a": "Vuol dire che quel movimento in uscita non è ancora stato abbinato a nessuna fattura fornitore. Puoi abbinarlo dalla scheda Riconciliazione."
      },
      {
        "q": "Ho confermato un abbinamento sbagliato, come lo tolgo?",
        "a": "Nella scheda Riconciliazione passa alla vista \"Riconciliati\" e clicca \"Annulla abbinamento\" sul movimento interessato: la fattura torna aperta e il movimento torna disponibile per un nuovo abbinamento."
      },
      {
        "q": "Come faccio a sapere ogni giorno cosa è stato riconciliato e cosa resta da abbinare?",
        "a": "In cima alla scheda Riconciliazione c'è il \"Riepilogo del giorno\": la tessera \"Riconciliati oggi\" mostra i pagamenti abbinati nella data scelta (con totale), la tessera \"Da riconciliare\" mostra i movimenti in uscita ancora senza fattura. Clicca su una tessera per aprire il dettaglio, cambia la data con le frecce o il calendario e usa il menu del periodo per filtrare le uscite non abbinate."
      },
      {
        "q": "Dove prendo il file da mandare alla commercialista?",
        "a": "Nella scheda \"Prima Nota\": scegli periodo e conto, poi scarica in CSV o Excel."
      },
      {
        "q": "Dove trovo la categorizzazione automatica delle spese con l'intelligenza artificiale?",
        "a": "È in una pagina separata dal menu, \"AI Categorie\" (sezione AI & Analytics): non è dentro Banche, ma lavora sugli stessi movimenti."
      }
    ]
  },
  {
    "path": "/ai-categorie",
    "icon": "Sparkles",
    "title": "AI Categorie",
    "description": "Questa pagina usa l'intelligenza artificiale per proporre automaticamente una categoria di spesa a ogni movimento bancario, così non devi assegnarle tutte a mano. Tu resti sempre al comando: puoi confermare, correggere o assegnare manualmente ogni suggerimento.",
    "sections": [
      {
        "heading": "Cosa vedi in alto: i numeri della categorizzazione",
        "body": "In cima alla pagina trovi cinque numeri: quanti movimenti sono stati caricati in totale, quanti hanno già una categoria confermata, quanti hanno un suggerimento dell'IA ancora da verificare, quanti non hanno nessun suggerimento e quante anomalie sono state rilevate. Sono gli stessi movimenti bancari che vedi nella pagina Banche: qui non devi caricare nulla, lavori direttamente su quelli già presenti.",
        "steps": [
          "Guarda il numero \"Da verificare\": indica quanti suggerimenti dell'IA aspettano una tua conferma.",
          "Guarda \"Non categorizzati\": sono i movimenti per cui l'IA non ha trovato nessun suggerimento e vanno assegnati a mano."
        ]
      },
      {
        "heading": "Avviare la categorizzazione automatica",
        "body": "Il pulsante \"Avvia categorizzazione AI\" analizza i movimenti senza categoria e propone per ciascuno la categoria di spesa più probabile, basandosi su regole imparate in precedenza, parole chiave nella descrizione e pattern ricorrenti. Al termine compare un messaggio con quanti movimenti sono stati categorizzati e quanti erano già a posto.",
        "steps": [
          "Clicca \"Avvia categorizzazione AI\" e attendi il messaggio di completamento.",
          "Passa alla scheda \"Da verificare\" per controllare i suggerimenti appena generati."
        ]
      },
      {
        "heading": "Verificare e correggere i suggerimenti",
        "body": "I movimenti sono organizzati in quattro schede: \"Da verificare\" (l'IA ha proposto una categoria ma tu non l'hai ancora confermata), \"Non categorizzati\" (nessun suggerimento disponibile), \"Confermati\" (categoria approvata da un'operatrice) e \"Tutti\". Per ogni suggerimento vedi una percentuale di confidenza (verde se alta, arancione se media, rossa se bassa) e il metodo usato dall'IA (regola appresa, parola chiave, pattern o assegnazione manuale). Puoi accettare il suggerimento con \"Conferma\", oppure cliccare \"Correggi\" (o \"Assegna\" se manca) per scegliere tu la categoria giusta da un menu a tendina.",
        "steps": [
          "Apri la scheda \"Da verificare\" per vedere i movimenti con un suggerimento IA in attesa.",
          "Per ogni riga, clicca \"Conferma\" se la categoria proposta è corretta.",
          "Se la categoria proposta è sbagliata, clicca \"Correggi\", scegli la categoria giusta dal menu e salva.",
          "Per i movimenti nella scheda \"Non categorizzati\", clicca \"Assegna\" e scegli tu la categoria.",
          "Anche un movimento già confermato può essere cambiato: clicca \"Modifica\" sulla sua riga."
        ]
      },
      {
        "heading": "Confermare più movimenti insieme",
        "body": "Quando ci sono molti suggerimenti con confidenza alta, non serve confermarli uno per uno: il pulsante \"Conferma tutti ≥85%\" accetta in blocco tutti i movimenti con almeno l'85% di confidenza, dopo una richiesta di conferma con il numero di movimenti coinvolti.",
        "steps": [
          "Clicca \"Conferma tutti ≥85%\" quando compare (è visibile solo se ci sono suggerimenti in attesa).",
          "Conferma nel messaggio che appare: i movimenti selezionati passano automaticamente tra i \"Confermati\".",
          "Controlla comunque a mano i pochi movimenti rimasti con confidenza più bassa."
        ]
      },
      {
        "heading": "Anomalie da controllare",
        "body": "Il pulsante \"Rileva anomalie\" fa analizzare i movimenti alla ricerca di situazioni da controllare: possibili duplicati, importi fuori dal normale o scadenze fornitore non pagate. I risultati compaiono nel pannello \"Anomalie\", con una breve descrizione e, quando disponibile, un suggerimento su come risolvere. Segnalare un'anomalia non modifica né cancella nessun dato: serve solo a segnalarti qualcosa da verificare di persona.",
        "steps": [
          "Clicca \"Rileva anomalie\" per aggiornare l'elenco.",
          "Clicca \"Anomalie (N)\" per aprire o chiudere il pannello con il dettaglio.",
          "Dopo aver controllato e sistemato una segnalazione, clicca \"Risolvi\" sulla riga per toglierla dall'elenco."
        ]
      }
    ],
    "faq": [
      {
        "q": "Cos'è la percentuale di \"confidenza\" accanto a un suggerimento?",
        "a": "Indica quanto l'IA è sicura della categoria proposta: più è alta (verde), più il suggerimento è affidabile. Sotto una certa soglia il colore diventa arancione o rosso, segno che conviene controllare bene prima di confermare."
      },
      {
        "q": "L'IA ha sbagliato categoria, come la correggo?",
        "a": "Clicca \"Correggi\" (o \"Modifica\" se il movimento era già confermato), scegli la categoria giusta dal menu a tendina e salva. La correzione resta memorizzata sul movimento."
      },
      {
        "q": "Devo controllare ogni singolo movimento uno per uno?",
        "a": "No. Puoi usare \"Conferma tutti ≥85%\" per accettare in blocco i suggerimenti con confidenza alta, e dedicare tempo solo ai pochi movimenti con confidenza bassa o senza suggerimento."
      },
      {
        "q": "Da dove arrivano i movimenti che vedo in questa pagina?",
        "a": "Sono gli stessi movimenti bancari che vedi nella pagina Banche: qui non c'è nessun caricamento da fare, lavori direttamente sui dati già presenti nel gestionale."
      },
      {
        "q": "Cosa devo fare quando vedo un'anomalia segnalata?",
        "a": "Leggi la descrizione e il suggerimento su come risolverla, verifica il movimento (ad esempio se è davvero un duplicato), sistema il dato se necessario e poi clicca \"Risolvi\" per toglierla dall'elenco."
      }
    ]
  },
  {
    "path": "/dipendenti",
    "icon": "Users",
    "title": "Personale",
    "description": "La pagina Personale raccoglie l'anagrafica dei dipendenti, i cedolini mensili (netto e costo lordo) e il confronto con il budget del personale, tutto suddiviso per punto vendita. È il punto dove tenere aggiornati organico, stipendi e allocazioni.",
    "sections": [
      {
        "heading": "Come è organizzata la pagina",
        "body": "In alto trovi cinque schede: Panoramica, Per outlet, Organico, Costi & cedolini, Costo lordo. In alto a destra puoi scegliere l'anno e il mese di riferimento: quasi tutti i numeri della pagina (netti, organico attivo) si riferiscono al mese selezionato. Il pulsante \"Dipendente\" in alto apre subito il modulo per aggiungere una persona nuova."
      },
      {
        "heading": "Panoramica",
        "body": "Mostra i numeri di sintesi del mese e dell'anno scelti: quante persone sono in organico (cioè hanno un cedolino caricato per quel mese), il costo del personale a budget, il totale dei netti pagati nel mese, il costo medio per addetto e l'incidenza del costo del personale sui ricavi. C'è anche un grafico a barre con il costo per ogni punto vendita e un riquadro \"Quadratura del personale\" che confronta tre fonti diverse (netti caricati, budget, bilancio) per verificare che i numeri si avvicinino tra loro."
      },
      {
        "heading": "Per outlet",
        "body": "Elenca ogni punto vendita con il numero di dipendenti pagati nel mese, il netto totale e il costo annuo a budget. Aprendo un punto vendita vedi l'elenco delle persone assegnate con il relativo netto del mese. In fondo trovi la sezione \"Amministratori\", separata dagli altri dipendenti perché non entra nei conteggi di organico."
      },
      {
        "heading": "Organico — l'anagrafica dei dipendenti",
        "body": "È l'elenco completo delle persone, raggruppate per sede. Puoi filtrare per stato (Attivi, Cessati, Tutti), per sede e cercare per nome. Da qui gestisci ogni dipendente con le icone azione sulla riga.",
        "steps": [
          "Per aggiungere un dipendente: clicca \"Dipendente\" e compila almeno cognome, nome e data di inizio contratto (obbligatori); puoi indicare anche matricola, codice fiscale, qualifica, livello, tipo di contratto e, se è a tempo determinato, scadenza e proroghe.",
          "Per modificare i dati di un dipendente: clicca l'icona a forma di matita sulla riga.",
          "Per assegnare la persona a uno o più punti vendita: clicca l'icona con il simbolo di percentuale (Allocazione) e indica su quali outlet lavora e con quale percentuale; la somma delle percentuali non può superare il 100%.",
          "Per caricare il cedolino PDF del mese: clicca l'icona di caricamento sulla riga della persona.",
          "Per cessare un dipendente: clicca l'icona del cestino, indica la data di cessazione e conferma. Il dipendente NON viene cancellato: resta in archivio tra i \"Cessati\", visibile e riattivabile in qualsiasi momento.",
          "Per riattivare un dipendente cessato: nella scheda dei cessati clicca l'icona di riattivazione.",
          "Per aprire la scheda con il dettaglio mese per mese dei netti: clicca sul nome del dipendente oppure sull'icona documento."
        ]
      },
      {
        "heading": "Scheda dipendente: i netti mese per mese",
        "body": "Aprendo la scheda di una persona trovi i dati anagrafici e di contratto in sola lettura (con un pulsante \"Modifica\" per correggerli) e dodici caselle, una per mese, dove inserire il netto in busta paga. Il sistema tiene conto di 14 mensilità: la tredicesima va sommata al netto di dicembre e la quattordicesima al netto di giugno. Il totale annuo mostrato è semplicemente la somma dei mesi compilati, non una stima. Attenzione: i valori inseriti a mano qui sono provvisori — se in seguito importi l'elenco netti ufficiale dello stesso mese, quello sovrascrive il valore inserito manualmente."
      },
      {
        "heading": "Costi & cedolini",
        "body": "Qui trovi, raggruppati per sede, tutti i cedolini (netti) caricati per il mese selezionato, con il totale pagato e la possibilità di aprire il PDF del cedolino di ogni persona. In fondo alla pagina ci sono due corsie di importazione: una per i netti (buste paga) e una per i costi lordi, entrambe accettano file PDF oppure fogli Excel/CSV.",
        "steps": [
          "Scegli la corsia giusta: \"netto\" per il file con gli stipendi netti, \"lordi\" per il file con i costi lordi aziendali.",
          "Trascina il file oppure selezionalo dal tuo computer.",
          "Il sistema prova a riconoscere automaticamente ogni dipendente (per matricola o per nome e cognome); se non lo trova, propone di crearne uno nuovo.",
          "Controlla l'anteprima: viene mostrato anche lo scostamento tra il totale calcolato e il totale dichiarato nel file, così puoi accorgerti subito di eventuali errori.",
          "Conferma l'importazione: i dati salvati per il mese vengono aggiornati (se esistevano già dei netti per quel mese, vengono sovrascritti)."
        ]
      },
      {
        "heading": "Costo lordo",
        "body": "Questa scheda mostra il costo aziendale completo (retribuzioni, contributi, INAIL, TFR) per outlet e, quando disponibile, per singolo dipendente. Si alimenta caricando il PDF \"Prospetto riepilogativo elaborazione paghe\" del consulente del lavoro: basta trascinarlo nell'area dedicata. Qui puoi anche controllare e aggiornare i tassi INAIL per ciascuna voce (PAT) usata nel calcolo. In fondo trovi i totali per outlet e, separati, i compensi degli amministratori."
      }
    ],
    "faq": [
      {
        "q": "Se cesso un dipendente per sbaglio, perdo i suoi dati?",
        "a": "No. La cessazione non cancella nulla: la persona resta in archivio tra i \"Cessati\" con tutta la sua storia (cedolini, costi, allocazioni) e puoi riattivarla in qualsiasi momento con l'apposita icona."
      },
      {
        "q": "Perché un dipendente non compare nell'organico del mese anche se è attivo?",
        "a": "L'organico \"del mese\" conta solo le persone per cui è stato caricato il cedolino (netto) di quel mese. Se manca il cedolino, la persona è comunque nell'anagrafica (scheda Organico) ma non compare nei totali del mese finché non importi o inserisci il suo netto."
      },
      {
        "q": "Qual è la differenza tra la scheda \"Costi & cedolini\" e \"Costo lordo\"?",
        "a": "\"Costi & cedolini\" gestisce il netto in busta paga per dipendente (quello che la persona riceve). \"Costo lordo\" gestisce il costo aziendale completo (retribuzione, contributi, INAIL, TFR) per outlet, alimentato dal Prospetto paghe del consulente."
      },
      {
        "q": "Chi sono gli \"Amministratori\" e perché sono separati?",
        "a": "Sono le persone con qualifica \"Amministratore\". Non vengono conteggiate nell'organico dipendenti né nel costo medio per addetto, ma hanno una loro sezione dedicata (visibile in Per outlet e in Organico) con netto e costo lordo annuo."
      },
      {
        "q": "Posso assegnare una persona a più punti vendita contemporaneamente?",
        "a": "Sì, usando l'icona Allocazione: puoi indicare più sedi con una percentuale ciascuna, purché la somma non superi il 100%."
      }
    ]
  },
  {
    "path": "/conto-economico",
    "icon": "BarChart3",
    "title": "Conto Economico & Bilancio",
    "description": "Questa pagina mostra il quadro completo dei conti dell'azienda: ricavi, costi, margini e utile, sia con i dati ufficiali di bilancio sia confrontati con i dati operativi inseriti in Budget & Controllo. Serve per capire a colpo d'occhio come sta andando l'azienda nel periodo scelto.",
    "sections": [
      {
        "heading": "Scegliere il periodo e la vista",
        "body": "In alto puoi scegliere il tipo di periodo (annuale, trimestrale, mensile o provvisorio) e poi una delle tre viste: 'Competenza' (i dati contabili classici, quelli del bilancio), 'Cassa' (basata sui movimenti bancari reali, entrate e uscite), oppure 'Riconciliazione' (che spiega passo per passo come si passa dal risultato dei punti vendita al bilancio ufficiale). L'anno di riferimento si imposta dal selettore periodo generale del gestionale.",
        "steps": [
          "Scegli il tipo di periodo dal primo menu a tendina (annuale, trimestrale, mensile, provvisorio).",
          "Clicca su 'Competenza', 'Cassa' o 'Riconciliazione' per cambiare vista.",
          "Attiva 'Confronto YoY' per vedere il confronto con l'anno precedente accanto ai dati dell'anno corrente."
        ]
      },
      {
        "heading": "In alto: i numeri chiave (KPI)",
        "body": "Sotto i controlli trovi sei riquadri riassuntivi sempre visibili: Ricavi, Margine lordo, Costo personale, Affitti, Utile ed EBIT, ciascuno con la percentuale sui ricavi. Sono un colpo d'occhio rapido sulla salute economica del periodo scelto."
      },
      {
        "heading": "Vista Cassa: entrate e uscite reali",
        "body": "Mostra i flussi di cassa mese per mese e per categoria, calcolati sui movimenti bancari importati (dalla sezione Banche). Se non è stato ancora importato nulla, la pagina lo segnala chiaramente. C'è anche un confronto diretto tra 'Competenza' (i dati contabili) e 'Cassa' (i soldi effettivamente entrati e usciti), con la differenza (varianza) evidenziata: è normale che ci sia uno scarto, dovuto ai tempi di incasso e pagamento."
      },
      {
        "heading": "Vista Riconciliazione: dal risultato dei negozi al bilancio ufficiale",
        "body": "Questa vista spiega in tre passaggi come si arriva dal 'Risultato Gestionale' (ricavi meno costi di tutti i punti vendita, meno le spese non divise) al risultato del bilancio ufficiale: prima si sommano le 'Rettifiche di Riconciliazione' (correzioni tecniche, ad esempio la merce comprata ma non ancora venduta), poi si arriva all'EBIT e infine, aggiungendo proventi e oneri finanziari, all'Utile Netto. Se il bilancio ufficiale non è ancora disponibile per l'anno scelto, la pagina lo segnala e mostra solo il calcolo gestionale."
      },
      {
        "heading": "Indici di bilancio",
        "body": "Una serie di indicatori con soglie di riferimento per il settore retail moda: Margine lordo %, Incidenza personale, Incidenza affitti ed EBIT %. Ogni indicatore mostra il valore, la formula di calcolo e un giudizio (verde/giallo/rosso) rispetto ai valori tipici di riferimento del settore."
      },
      {
        "heading": "Confronto con Budget e Controllo",
        "body": "Questa sezione mette a confronto il preventivo e il consuntivo così come inseriti nella pagina Budget & Controllo (tab 'Preventivo vs Consuntivo'), mostrando lo scostamento in euro e percentuale per Ricavi, Costi e Risultato gestionale. Se il preventivo dell'anno non è ancora stato compilato, la pagina te lo segnala e ti invita ad andare su Budget e Controllo. Un pallino colorato accanto a un importo segnala che il preventivo contiene ancora voci provvisorie non confermate."
      },
      {
        "heading": "Un avviso importante: incoerenze tra bilancio e budget",
        "body": "Se i totali del bilancio ufficiale importato non coincidono con la somma delle righe inserite in Budget e Controllo, compare un riquadro di attenzione giallo che elenca le voci in disaccordo, con entrambi i valori a confronto. In questo caso conviene verificare con il commercialista quale dato è quello corretto."
      },
      {
        "heading": "Bilancio — Dettaglio completo",
        "body": "Qui trovi l'elenco completo e dettagliato delle voci di Stato Patrimoniale (Attività e Passività) e di Conto Economico (Costi e Ricavi), organizzate ad albero (clicca per aprire i dettagli di ogni voce). Con 'Confronto YoY' attivo, ogni totale mostra anche la variazione percentuale rispetto all'anno precedente."
      },
      {
        "heading": "Analisi e raccomandazioni",
        "body": "Un riepilogo automatico in linguaggio semplice: punti di forza, punti di debolezza e raccomandazioni, generati a partire dai numeri del periodo scelto."
      },
      {
        "heading": "Bilanci importati e Nota Integrativa",
        "body": "Nel riquadro 'Bilanci importati' trovi l'elenco dei bilanci caricati nel sistema, con lo stato (in attesa, approvato o rifiutato): se un bilancio è 'in attesa', puoi approvarlo o rifiutarlo. Attenzione: una volta approvato, il bilancio è considerato definitivo, quindi prima di confermare controlla che i dati siano corretti. Più in basso, nella 'Nota Integrativa', puoi scrivere liberamente commenti, criteri di valutazione o fatti rilevanti relativi al bilancio del periodo: il testo si salva con il pulsante 'Salva nota'.",
        "steps": [
          "Nel riquadro 'Bilanci importati', individua il bilancio con stato 'In attesa'.",
          "Clicca 'Approva' per confermarlo in via definitiva, oppure 'Rifiuta' se non è corretto.",
          "Se scegli 'Approva', conferma nella finestra di avviso che si apre.",
          "Per scrivere una nota, apri la sezione 'Nota Integrativa', scrivi il testo e clicca 'Salva nota'."
        ]
      }
    ],
    "faq": [
      {
        "q": "Da dove arrivano i dati di preventivo e consuntivo mostrati in questa pagina?",
        "a": "Da Budget & Controllo: il preventivo e il consuntivo sono quelli inseriti nel tab 'Preventivo vs Consuntivo' di quella pagina, non dalle fatture o dallo scadenzario."
      },
      {
        "q": "Perché vedo un avviso giallo di 'incoerenza' tra bilancio e budget?",
        "a": "Significa che i totali del bilancio ufficiale importato e quelli calcolati dalle righe di Budget e Controllo non coincidono per una o più voci. Va verificato con il commercialista quale dato è corretto; spesso la soluzione è reimportare un bilancio corretto."
      },
      {
        "q": "Cosa succede se approvo un bilancio importato per sbaglio?",
        "a": "L'approvazione lo rende definitivo, quindi è importante controllare i dati prima di confermare nella finestra di avviso che compare. In caso di dubbio, contatta chi gestisce il gestionale prima di approvare."
      },
      {
        "q": "Cosa vuol dire il pallino colorato accanto ad alcuni importi?",
        "a": "Indica che il valore include ancora voci segnaposto (provvisorie), non ancora confermate in Budget & Controllo, quindi il totale potrebbe non essere definitivo."
      },
      {
        "q": "Le funzioni 'Trend', 'Simulation Mode' e 'Import PDF' non fanno nulla quando ci clicco, perché?",
        "a": "Sono funzioni segnalate come 'Coming soon': sono già visibili in anteprima ma non ancora attive in questa versione del gestionale."
      }
    ]
  },
  {
    "path": "/budget",
    "icon": "Calculator",
    "title": "Budget & Controllo",
    "description": "La pagina Budget & Controllo serve per costruire il preventivo (Business Plan) di ogni punto vendita e della Sede, confrontarlo mese per mese con i dati reali (consuntivo), e inserire velocemente i corrispettivi. È il cuore del lavoro di budget: tutto quello che scrivi qui alimenta anche il Conto Economico.",
    "sections": [
      {
        "heading": "Le tre schede della pagina",
        "body": "In alto trovi tre pulsanti (schede): 'Business Plan', 'Preventivo vs Consuntivo' e 'Inserimento Rapido'. Sono tre modi diversi di lavorare sugli stessi dati, quindi quello che salvi in una scheda si vede anche nelle altre. L'anno di riferimento è mostrato accanto al titolo della pagina e si cambia dal selettore periodo generale del gestionale."
      },
      {
        "heading": "Scheda Business Plan: inserire i costi previsti",
        "body": "Qui vedi una scheda per la Sede e una per ciascun punto vendita. Ogni scheda mostra il totale ricavi (Valore della Produzione), il totale costi previsti e il risultato (utile o perdita). Cliccando sull'intestazione della scheda si apre il dettaglio con l'elenco completo delle voci di costo, organizzate ad albero (macro-categorie che si aprono nei dettagli). I ricavi in questa scheda sono di sola lettura: si inseriscono invece nella scheda 'Inserimento Rapido' o in 'Preventivo vs Consuntivo'.",
        "steps": [
          "Apri la scheda del punto vendita (o della Sede) cliccando sulla sua intestazione.",
          "Nell'elenco 'Componenti Negative' (i costi), clicca sulla freccetta per aprire una macro-categoria e trovare la voce che ti interessa.",
          "Scrivi l'importo annuale nella casella a destra della voce: il numero si formatta da solo (es. 9.000,00). Appena esci dalla casella il valore si salva automaticamente e appare un segno di conferma verde per qualche secondo.",
          "In alto vedi aggiornarsi in tempo reale il totale costi e il risultato (utile/perdita) della scheda.",
          "Se vuoi ripulire tutti i costi inseriti per quel punto vendita, usa il pulsante 'Cancella costi' (chiede conferma prima di procedere)."
        ]
      },
      {
        "heading": "Approvare e sbloccare un preventivo",
        "body": "Solo chi ha il permesso di approvare (tipicamente Lilian) vede i pulsanti 'Approva preventivo' e 'Sblocca preventivo'. Un preventivo approvato viene bloccato (non più modificabile) e sulla scheda compare l'etichetta 'Approvato' con la data. Per modificarlo di nuovo occorre sbloccarlo, indicando obbligatoriamente un motivo: questa azione resta registrata nello storico. Chi non ha il permesso di approvazione vede le schede in sola lettura e solo quelle già approvate o sbloccate (le bozze non ancora approvate restano nascoste, per non mostrare dati provvisori).",
        "steps": [
          "Compila i costi della scheda.",
          "Clicca 'Approva preventivo': si apre una finestra di conferma che spiega che il preventivo verrà bloccato.",
          "Confermi e la scheda passa allo stato 'Approvato' (lucchetto chiuso).",
          "Se serve correggere qualcosa dopo l'approvazione, clicca 'Sblocca preventivo', scrivi il motivo (almeno 5 caratteri) e conferma."
        ]
      },
      {
        "heading": "Scheda Preventivo vs Consuntivo",
        "body": "Questa scheda mette a confronto, voce per voce, il preventivo (quanto avevamo previsto) con il consuntivo (quanto è successo davvero) e mostra lo scostamento in euro e in percentuale. In alto puoi scegliere il punto vendita dal menu a tendina, oppure la vista aggregata 'Tutti gli outlet' che somma tutti i punti vendita (e la Sede, se già approvata). Puoi anche scegliere tra vista 'Annuale' (i totali dell'anno) e vista 'Mensile' (mese per mese). Nella vista aggregata è disponibile solo la vista Annuale.",
        "steps": [
          "Scegli il punto vendita (o 'Tutti gli outlet') dal menu a tendina in alto.",
          "Scegli 'Annuale' o 'Mensile' con i due pulsanti accanto.",
          "Nella colonna 'Consuntivo' scrivi l'importo realmente registrato per quella voce: appena esci dalla casella si salva da solo (nessun bottone 'Salva' obbligatorio).",
          "Se serve, usa la colonna 'Rettifica' per una correzione manuale su una voce specifica (es. una spesa dimenticata).",
          "In fondo trovi il riepilogo con Risultato prima delle imposte, Imposte e Risultato dopo le imposte."
        ]
      },
      {
        "heading": "Le Imposte",
        "body": "Nella vista aggregata 'Tutti gli outlet' puoi inserire l'importo annuale delle imposte sul reddito (un unico numero, positivo, per tutta l'azienda): si salva da solo appena esci dalla casella. Il sistema lo ripartisce automaticamente sui punti vendita aperti, in proporzione ai loro ricavi (la Sede non riceve quota). Se guardi il singolo punto vendita, l'importo delle imposte è già la quota calcolata per quel punto vendita e non è modificabile da lì."
      },
      {
        "heading": "Scheda Inserimento Rapido",
        "body": "È il modo più veloce per inserire i corrispettivi (i ricavi) mese per mese: una tabella con tutti i punti vendita in colonna e due righe, una per il Preventivo (la previsione) e una per il Consuntivo (il dato reale, definitivo, dei mesi già chiusi). Scegli il mese con i pulsanti in alto, poi scrivi gli importi nelle caselle: ogni cella si salva da sola appena esci da essa. Questi numeri alimentano direttamente sia il Business Plan che il Conto Economico.",
        "steps": [
          "Clicca sul mese che vuoi compilare (in alto, pulsanti Gen-Dic).",
          "Nella riga 'Preventivo' scrivi l'importo previsto per ciascun punto vendita.",
          "Nella riga 'Consuntivo' scrivi l'importo reale (solo per mesi già chiusi): questo dato è considerato definitivo.",
          "Esci dalla casella (clic altrove o tasto Tab) per salvare: non serve alcun pulsante."
        ]
      },
      {
        "heading": "Esportare il bilancio",
        "body": "Dalla scheda 'Preventivo vs Consuntivo' puoi generare un file Excel con il bilancio consuntivo del periodo scelto, tramite il pulsante 'Esporta bilancio' in alto a destra. È disponibile per tutti, anche in sola lettura.",
        "steps": [
          "Vai nella scheda 'Preventivo vs Consuntivo'.",
          "Clicca 'Esporta bilancio' in alto a destra.",
          "Segui le indicazioni nella finestra che si apre per scaricare il file Excel."
        ]
      }
    ],
    "faq": [
      {
        "q": "Perché non riesco a modificare i costi di un punto vendita?",
        "a": "O non hai il permesso di approvazione (modalità sola lettura, riservata a chi gestisce i budget), oppure quel preventivo è già stato approvato e quindi bloccato. In quest'ultimo caso serve che chi approva lo sblocchi, indicando un motivo."
      },
      {
        "q": "Cosa vuol dire il pallino colorato accanto ad alcuni importi?",
        "a": "Segnala che quel valore è ancora un dato segnaposto (provvisorio, non ancora confermato dall'operatrice) e va controllato e confermato."
      },
      {
        "q": "Qual è la differenza tra Preventivo e Consuntivo?",
        "a": "Il Preventivo è la previsione, un numero che si può sempre correggere. Il Consuntivo è il dato reale del mese chiuso: una volta inserito è considerato definitivo ('granitico') e rappresenta ciò che è davvero successo."
      },
      {
        "q": "Se cambio pagina o punto vendita senza cliccare Salva, perdo i dati inseriti?",
        "a": "No. Ogni casella si salva automaticamente non appena esci da essa (vedi la conferma verde). Fanno eccezione i ricavi nella scheda Business Plan, gestiti dal pulsante Salva della scheda."
      },
      {
        "q": "Dove inserisco i corrispettivi (ricavi) mese per mese nel modo più veloce?",
        "a": "Nella scheda 'Inserimento Rapido': è pensata apposta per inserire in pochi secondi preventivo e consuntivo di tutti i punti vendita, mese per mese."
      }
    ]
  },
  {
    "path": "/stock",
    "icon": "Package",
    "title": "Analisi Sell-Through Magazzino",
    "description": "Una vista che mostra, per ogni punto vendita e categoria di prodotto, quanto velocemente la merce viene venduta (sell-through) e da quanto tempo resta in giacenza. Aiuta a individuare stock in eccesso o che invecchia troppo.",
    "sections": [
      {
        "heading": "Importante: dati simulati",
        "body": "La pagina mostra un avviso ben visibile \"Dati simulati (demo)\": i numeri di giacenza e sell-through non arrivano da un magazzino reale collegato al gestionale, ma sono generati come esempio sui punti vendita effettivi dell'azienda. Quando in futuro sarà collegata una fonte magazzino vera, questa pagina userà i dati reali."
      },
      {
        "heading": "KPI generali",
        "body": "Quattro caselle in alto riassumono la situazione: valore totale dello stock a magazzino, tasso di sell-through complessivo (percentuale di merce acquistata già venduta), giorni medi di giacenza e numero di \"alert critici\" (categorie con vendite troppo lente o merce ferma da troppo tempo)."
      },
      {
        "heading": "Grafici sell-through e valore stock",
        "body": "Due grafici a barre mostrano, per ogni punto vendita, la percentuale di sell-through e il valore economico dello stock rimasto."
      },
      {
        "heading": "Analisi dell'invecchiamento (aging)",
        "body": "Un grafico e un riepilogo dividono i pezzi in magazzino in quattro fasce di giacenza: 0-30 giorni, 31-60 giorni, 61-90 giorni e oltre 90 giorni. Più pezzi ci sono nelle fasce alte, più c'è merce che resta ferma a lungo e rischia di dover essere scontata."
      },
      {
        "heading": "Avvisi",
        "body": "Un elenco degli avvisi attivi: \"Basso sell-through\" quando in una categoria si è venduto meno del 40% del comprato, \"Stock aged\" quando la giacenza media supera i 90 giorni (avviso rosso) e \"Stock aging\" quando è tra 60 e 90 giorni (avviso giallo). Ogni avviso indica punto vendita e categoria interessata."
      },
      {
        "heading": "Dettaglio per punto vendita",
        "body": "Un elenco a fisarmonica con un riquadro per ogni punto vendita: cliccandoci sopra si apre la tabella con tutte le categorie di prodotto (T-shirt, Felpe, Pantaloni, Giacche, Accessori, Calzature), con pezzi acquistati, venduti, in stock, percentuale di sell-through, giorni di giacenza, valore dello stock e potenziale di ricavo se tutto venisse venduto al prezzo pieno.",
        "steps": [
          "Clicca sull'intestazione di un punto vendita per aprire o chiudere il dettaglio.",
          "Nella tabella, la colonna \"Sell-th. %\" è colorata in rosso se sotto il 50% e in verde se sopra.",
          "La colonna \"Giacenza gg\" è colorata in base alla soglia: verde entro 60 giorni, giallo tra 60 e 90, rosso oltre 90 giorni."
        ]
      }
    ],
    "faq": [
      {
        "q": "I numeri di questa pagina sono affidabili per decidere i riordini?",
        "a": "No, non ancora: sono dati simulati generati come esempio, non provengono da un magazzino reale. Vanno usati solo per farsi un'idea di come funzionerà la pagina quando sarà collegata a una fonte dati reale."
      },
      {
        "q": "Cosa significa \"sell-through\"?",
        "a": "È la percentuale di merce acquistata che è stata effettivamente venduta. Ad esempio, se sono stati comprati 100 pezzi e venduti 60, il sell-through è del 60%."
      },
      {
        "q": "Perché una categoria compare tra gli avvisi?",
        "a": "Perché ha un sell-through sotto il 40% (vende poco rispetto a quanto acquistato) oppure una giacenza media sopra i 60 giorni (la merce resta ferma da tempo)."
      }
    ]
  },
  {
    "path": "/analytics-pos",
    "icon": "BarChart3",
    "title": "Analytics POS",
    "description": "Una vista dedicata all'analisi degli scontrini: quanti se ne emettono, quale importo medio, quanti pezzi per scontrino e come si comportano i diversi punti vendita nel corso dell'anno.",
    "sections": [
      {
        "heading": "Importante: dati simulati",
        "body": "In alto compare l'avviso \"Dati simulati (demo)\": i numeri di scontrini, importi e vendite non arrivano da un sistema cassa reale collegato al gestionale, ma sono generati come esempio sui punti vendita effettivi dell'azienda. Quando la cassa sarà collegata, la pagina mostrerà i dati reali."
      },
      {
        "heading": "Filtri",
        "body": "Puoi scegliere un punto vendita specifico (oppure lasciare \"Tutti\" per vedere il totale aziendale) e passare tra visualizzazione \"Annuale\" e \"Mensile\"."
      },
      {
        "heading": "KPI principali",
        "body": "Quattro caselle mostrano: numero totale di scontrini, scontrino medio, pezzi per scontrino (indicatore UPT, cioè quanti articoli in media contiene ogni scontrino) e ricavo medio per pezzo venduto."
      },
      {
        "heading": "Andamento mensile",
        "body": "Un grafico a linee mostra come cambia lo scontrino medio mese per mese, con una linea per ogni punto vendita. Un grafico a barre mostra invece il numero di scontrini emessi ogni mese, sempre suddiviso per punto vendita."
      },
      {
        "heading": "Distribuzione per fascia di importo",
        "body": "Un grafico a torta mostra come si distribuiscono gli scontrini in base all'importo: 0-20€, 20-50€, 50-100€, 100-200€ e oltre 200€."
      },
      {
        "heading": "Confronto tra punti vendita",
        "body": "Una tabella riepiloga, per ogni punto vendita, il numero di scontrini, lo scontrino medio, i pezzi per scontrino, il ricavo per pezzo e l'indicatore UPT. In fondo alla pagina trovi due riquadri con il punto vendita migliore e quello con le performance più basse, in base al ricavo totale annuale."
      }
    ],
    "faq": [
      {
        "q": "Posso usare questi numeri per decisioni reali sulle vendite?",
        "a": "No, non ancora: sono dati simulati generati come esempio, la pagina non è collegata a un sistema cassa reale. Servono a mostrare come funzionerà l'analisi quando i dati reali saranno disponibili."
      },
      {
        "q": "Cosa significa UPT?",
        "a": "È l'abbreviazione di \"Units Per Transaction\": il numero medio di pezzi venduti per ogni scontrino."
      },
      {
        "q": "Come cambia la pagina se scelgo un solo punto vendita nel filtro?",
        "a": "I KPI, la distribuzione per fascia di importo e i grafici si aggiornano per mostrare solo i dati di quel punto vendita, invece del totale di tutti gli outlet."
      }
    ]
  },
  {
    "path": "/cash-flow",
    "icon": "Wallet",
    "title": "Cashflow Prospettico",
    "description": "Questa pagina mostra la proiezione della liquidità: quanti soldi ci saranno in cassa nei prossimi giorni, settimane o mesi, sommando entrate e uscite previste a quelle già certe. Aiuta a capire in anticipo se in un certo periodo il saldo rischia di andare in negativo.",
    "sections": [
      {
        "heading": "Come è organizzata la proiezione",
        "body": "In alto puoi scegliere tra tre visualizzazioni: 'Giornaliero' (i prossimi 30 giorni), 'Settimanale' (i prossimi 3 mesi) e 'Mensile' (i prossimi 12 mesi). In tutte e tre trovi lo stesso schema: quattro riquadri con Saldo Iniziale, Entrate Stimate, Uscite Stimate e Saldo Finale Stimato, un grafico con l'andamento e una tabella di dettaglio riga per riga (giorno, settimana o mese).",
        "steps": [
          "Scegli la visualizzazione che ti serve cliccando su 'Giornaliero', 'Settimanale' o 'Mensile'.",
          "Guarda i quattro riquadri in alto per il colpo d'occhio generale.",
          "Scorri il grafico e la tabella sotto per il dettaglio periodo per periodo."
        ]
      },
      {
        "heading": "Da dove arrivano i numeri",
        "body": "Il saldo iniziale è la somma dei conti bancari collegati. Le entrate previste vengono soprattutto dai ricavi inseriti in Budget & Controllo. Le uscite previste sommano: le fatture fornitori e le scadenze dello Scadenzario, le scadenze fiscali, i costi ricorrenti (es. affitti), le rate dei finanziamenti e le previsioni manuali che inserisci tu in questa pagina. Nella vista Mensile, i mesi già passati mostrano il dato reale ('Consuntivo', preso dai movimenti bancari), il mese in corso è etichettato 'In corso' e i mesi futuri sono etichettati 'Previsione'."
      },
      {
        "heading": "Vedere il dettaglio di una riga (entrate o uscite)",
        "body": "In tabella, gli importi di 'Entrate' e 'Uscite' sono cliccabili: cliccandoci si apre sotto la riga un pannello con l'elenco delle singole voci che compongono quel totale (es. quali fatture, quali scadenze), utile per capire da cosa dipende un numero.",
        "steps": [
          "Individua nella tabella il periodo che ti interessa.",
          "Clicca sull'importo di Entrate o Uscite di quella riga.",
          "Si apre il dettaglio sotto; clicca di nuovo per richiuderlo."
        ]
      },
      {
        "heading": "Aggiungere una previsione di uscita manuale",
        "body": "Se sai già che ci sarà una spesa futura non ancora presente nel sistema (ad esempio un lavoro di ristrutturazione), puoi inserirla manualmente con il pulsante 'Previsione uscita' in alto a destra. Puoi scegliere se è una spesa 'Una tantum' (una volta sola, con una data) oppure 'Ricorrente' (si ripete con una frequenza scelta - mensile, bimestrale, trimestrale, semestrale o annuale - fino a una data di fine, se indicata). Questa previsione entra solo nel Cashflow Prospettico, non nel Conto Economico.",
        "steps": [
          "Clicca il pulsante '+ Previsione uscita' in alto a destra.",
          "Scegli il tipo: 'Una tantum' o 'Ricorrente'.",
          "Inserisci la data prevista (o la data di inizio, se ricorrente) e, per le ricorrenti, la frequenza e il giorno del mese.",
          "Inserisci l'importo in euro e una breve descrizione.",
          "Clicca 'Aggiungi previsione' per salvare."
        ]
      },
      {
        "heading": "Gestire le previsioni già inserite",
        "body": "Tutte le previsioni manuali inserite sono elencate nel riquadro 'Previsioni manuali', che puoi aprire o chiudere cliccandoci sopra. Da lì puoi modificare o eliminare ciascuna previsione con le icone a destra della riga.",
        "steps": [
          "Apri il riquadro 'Previsioni manuali' in alto (mostra quante ce ne sono e il totale).",
          "Clicca l'icona della matita per modificare una previsione, oppure l'icona del cestino per eliminarla.",
          "In caso di eliminazione, conferma nella finestra che appare."
        ]
      },
      {
        "heading": "L'avviso di saldo negativo",
        "body": "Se in un periodo futuro il saldo previsto scende sotto zero, in cima alla pagina appare un banner rosso che segnala la data in cui questo accadrà, con le uscite previste e il saldo atteso. È un campanello d'allarme per intervenire in anticipo (es. sollecitare incassi o rimandare spese)."
      },
      {
        "heading": "Aggiornare i dati",
        "body": "Se hai modificato fatture, scadenze o costi ricorrenti in altre pagine del gestionale, usa il pulsante 'Aggiorna' in alto per rileggere subito i dati più recenti senza dover ricaricare la pagina."
      }
    ],
    "faq": [
      {
        "q": "Perché alcuni importi di entrate hanno il simbolo ≈ davanti?",
        "a": "Significa che è una stima basata sul preventivo di Budget & Controllo, non un dato certo: può ancora cambiare."
      },
      {
        "q": "Cosa significano le etichette Consuntivo, In corso e Previsione nella vista Mensile?",
        "a": "'Consuntivo' è un mese già chiuso con dati reali dai movimenti bancari. 'In corso' è il mese attuale, ancora parzialmente stimato. 'Previsione' è un mese futuro, calcolato solo da stime."
      },
      {
        "q": "Se aggiungo una previsione di uscita qui, si vede anche nel Conto Economico o in Budget & Controllo?",
        "a": "No. Le previsioni manuali inserite in questa pagina servono solo per il Cashflow Prospettico e non modificano il Conto Economico né il Business Plan."
      },
      {
        "q": "Cosa vuol dire il pallino colorato accanto ad alcuni importi di entrate previste?",
        "a": "Segnala che la stima di quel mese si basa su voci di budget ancora provvisorie (segnaposto), non confermate in Budget & Controllo."
      },
      {
        "q": "Perché il saldo iniziale non corrisponde a quello che vedo in banca?",
        "a": "Il saldo iniziale qui è la somma dei conti bancari collegati al gestionale nella sezione Banche: verifica che tutti i conti siano collegati e aggiornati."
      }
    ]
  },
  {
    "path": "/open-to-buy",
    "icon": "Wallet",
    "title": "Open-to-Buy Planner",
    "description": "Uno strumento di simulazione per calcolare il budget di acquisto (Open-to-Buy) disponibile per la prossima stagione, punto vendita per punto vendita, in base a vendite previste, scorte e sconti di fine stagione attesi.",
    "sections": [
      {
        "heading": "Importante: valori di esempio, modifiche non salvate",
        "body": "In alto compare l'avviso \"Valori di esempio\": i parametri di partenza (vendite previste, scorte, ricarico) sono numeri di esempio calcolati sui punti vendita reali dell'azienda, pensati solo per farsi un'idea. Puoi modificarli liberamente per fare le tue simulazioni, ma le modifiche non vengono salvate da nessuna parte: se cambi pagina o ricarichi, i valori tornano a quelli di esempio."
      },
      {
        "heading": "Selezione stagione",
        "body": "In alto puoi scegliere tra due stagioni: Primavera/Estate 2026 (SS26) e Autunno/Inverno 2026 (FW26). Ogni stagione ha i propri parametri e il proprio calcolo indipendente."
      },
      {
        "heading": "Cos'è l'Open-to-Buy (OTB)",
        "body": "L'OTB è il budget di acquisto ancora disponibile per la stagione, calcolato così: Vendite Previste + Markdown Previsto (sconti di fine stagione attesi) + Scorta Finale Target − Scorta Iniziale. In pratica indica quanto si può ancora comprare, al costo, senza sforare gli obiettivi di scorta di fine stagione."
      },
      {
        "heading": "KPI di riepilogo",
        "body": "Quattro caselle mostrano il budget OTB totale su tutti i punti vendita, l'OTB medio per punto vendita, il target di sell-through (percentuale di vendite attese sul totale disponibile) e il budget stimato per i markdown (sconti)."
      },
      {
        "heading": "Parametri modificabili per punto vendita",
        "body": "Per ogni punto vendita trovi una scheda con cinque campi da modificare: vendite previste (in euro), ricarico target (%), scorta iniziale (in euro), scorta finale target (in euro) e markdown previsto (%). Sotto ogni scheda viene ricalcolato in automatico l'OTB per quell'outlet.",
        "steps": [
          "Individua la scheda del punto vendita che vuoi simulare.",
          "Modifica uno o più campi (ad esempio le vendite previste o il ricarico target).",
          "L'OTB calcolato in fondo alla scheda si aggiorna subito.",
          "I grafici e la tabella riepilogativa più in basso nella pagina si aggiornano automaticamente con i nuovi valori."
        ]
      },
      {
        "heading": "Grafici e tabella riepilogativa",
        "body": "Un grafico a barre mostra il budget OTB per ogni punto vendita. Un secondo grafico mostra come si compone la disponibilità (vendite previste, markdown, scorta finale) per ciascun outlet. In fondo trovi una tabella completa con tutti i parametri e l'OTB calcolato per ogni punto vendita."
      }
    ],
    "faq": [
      {
        "q": "Se modifico i parametri di un punto vendita e chiudo la pagina, la simulazione resta salvata?",
        "a": "No. Le modifiche servono solo per la simulazione del momento: non vengono salvate da nessuna parte e si perdono uscendo dalla pagina o ricaricandola."
      },
      {
        "q": "Da dove vengono i valori di partenza mostrati nelle schede?",
        "a": "Sono valori di esempio, non dati reali di vendita storica: servono come punto di partenza plausibile per far provare lo strumento, calcolati sui punti vendita effettivi dell'azienda."
      },
      {
        "q": "Cosa vuol dire \"scorta finale target\"?",
        "a": "È il valore di magazzino (in euro, al costo) che si vuole avere in giacenza alla fine della stagione: un obiettivo di scorta, non un dato già registrato."
      }
    ]
  },
  {
    "path": "/produttivita",
    "icon": "Users",
    "title": "Analisi Produttività",
    "description": "Questa pagina confronta i punti vendita in base a quanto rende ogni ora di lavoro e ogni dipendente, incrociando i ricavi a budget con il numero di persone assegnate a ciascuna sede. Serve a capire dove il personale è più (o meno) produttivo.",
    "sections": [
      {
        "heading": "Da dove arrivano i numeri",
        "body": "I ricavi e il costo del personale vengono dal budget dell'anno selezionato (in alto a destra puoi cambiare anno). Il numero di dipendenti per sede viene dalle allocazioni impostate nella pagina Personale (icona Allocazione): se un dipendente lavora al 50% in un outlet e al 50% in un altro, viene conteggiato come mezza persona in ciascuno. Se per un outlet non ci sono dipendenti allocati, le metriche che dipendono dal personale mostrano \"N/D\" (dato non disponibile) invece di un numero inventato."
      },
      {
        "heading": "Fatturato medio per dipendente",
        "body": "Il riquadro grande in alto mostra il ricavo totale diviso per il numero di dipendenti (calcolati in \"teste equivalenti\", cioè tenendo conto delle percentuali di allocazione). Sotto trovate quattro schede: il punto vendita con il miglior ricavo per ora lavorata, quello con il peggiore, la media di tutti e il ROI medio del personale (rapporto tra ricavi e costo del personale)."
      },
      {
        "heading": "Classifica produttività per outlet",
        "body": "Una tabella che ordina i punti vendita dal più al meno produttivo in base al fatturato per dipendente, con medaglie per i primi tre posti. Per ciascun outlet vedi fatturato, numero di dipendenti, fatturato per dipendente, incidenza del costo del personale sui ricavi (colorata: verde sotto il 20%, giallo tra 20% e 35%, rosso sopra il 35%) e ROI."
      },
      {
        "heading": "Grafici di confronto",
        "body": "Il grafico \"Trend mensile fatturato/dipendente\" mostra come cambia il fatturato per dipendente mese per mese in ciascun outlet. Il grafico \"Ricavi vs Costo Personale\" confronta i due valori per outlet. Il grafico \"Ricavo vs Costo per Ora Lavoro\" mostra quanto rende un'ora di lavoro rispetto a quanto costa, per gli outlet per cui è disponibile il dato dipendenti."
      },
      {
        "heading": "Tabella metriche complete",
        "body": "Una tabella riepilogativa con tutti gli indicatori per ogni outlet: ricavi, costo personale, incidenza, ricavo/ora, costo/ora, margine/ora e ROI. La riga con il miglior ricavo per ora è evidenziata in verde, quella con il peggiore in rosso."
      },
      {
        "heading": "Simulatore: sposta dipendente",
        "body": "Permette di simulare, solo a video, cosa succederebbe spostando uno o più dipendenti da un punto vendita a un altro: come cambierebbero fatturato per dipendente, ricavo/ora e ROI nei due outlet coinvolti.",
        "steps": [
          "Clicca \"Attiva Simulazione\".",
          "Scegli l'outlet di partenza (\"Da\") e quello di arrivo (\"A\").",
          "Indica quante persone spostare.",
          "Le tabelle e i KPI si aggiornano mostrando l'effetto simulato.",
          "Clicca \"Disattiva Simulazione\" per tornare ai dati reali: nessuna modifica viene salvata, è solo un'ipotesi di lavoro."
        ]
      },
      {
        "heading": "Raccomandazioni",
        "body": "In fondo alla pagina trovi alcuni suggerimenti automatici: un avviso per gli outlet dove il rapporto ricavi/costo del personale è sotto la soglia ottimale (1,8 volte), e un promemoria per mantenere l'organizzazione dell'outlet più produttivo."
      }
    ],
    "faq": [
      {
        "q": "Perché per alcuni outlet vedo \"N/D\" invece di un numero?",
        "a": "Significa che per quell'outlet non ci sono dipendenti allocati (pagina Personale, icona Allocazione). Senza quel dato non è possibile calcolare fatturato per dipendente o ricavo/costo per ora in modo corretto, quindi la pagina non inventa un valore ma mostra \"N/D\"."
      },
      {
        "q": "Il simulatore di spostamento dipendenti modifica davvero l'organico?",
        "a": "No. È solo un esercizio di simulazione a video per valutare l'impatto di un'ipotesi. Per spostare davvero una persona tra punti vendita bisogna modificarne l'allocazione nella pagina Personale."
      },
      {
        "q": "Come viene contato un dipendente part-time o su più sedi?",
        "a": "In base alla percentuale di allocazione impostata su ciascun outlet: ad esempio una persona al 60% in un outlet e al 40% in un altro pesa 0,6 e 0,4 rispettivamente nei conteggi di quella sede."
      },
      {
        "q": "Da cosa dipende il colore dell'incidenza del costo del personale?",
        "a": "Verde se il costo del personale è sotto il 20% dei ricavi, giallo tra il 20% e il 35%, rosso oltre il 35%: sono soglie indicative per far notare subito le situazioni da controllare."
      }
    ]
  },
  {
    "path": "/scenario",
    "icon": "BarChart3",
    "title": "Scenario Planning",
    "description": "Questa pagina permette di simulare 'cosa succederebbe se...': cosa cambia nell'utile dell'azienda se i ricavi aumentano o diminuiscono, se il costo del personale cambia, oppure se si apre un nuovo punto vendita. È uno strumento di simulazione: non modifica mai i dati reali del Budget.",
    "sections": [
      {
        "heading": "Il punto di partenza (Baseline)",
        "body": "Nel riquadro 'Baseline' a sinistra trovi il quadro reale dell'anno scelto, così come risulta da Budget & Controllo: numero di punti vendita attivi, Ricavi Totali, Costi Totali (di cui quanto è costo del personale), Utile Base e Margine %. È il punto di partenza da cui parte ogni simulazione. Se per l'anno scelto non ci sono ancora dati di budget, la pagina lo segnala chiaramente invece di mostrare numeri inventati.",
        "steps": [
          "Scegli l'anno da simulare dal menu 'Anno' in alto a destra."
        ]
      },
      {
        "heading": "Impostare i parametri dello scenario",
        "body": "Sotto la Baseline trovi tre leve per costruire la simulazione: il cursore 'Variazione Fatturato' (da -30% a +50%), il cursore 'Variazione Costo Personale' (da -20% a +30%) e l'interruttore 'Nuovo punto vendita' per simulare l'apertura di un altro negozio. Muovendo i cursori, tutti i risultati nella pagina si aggiornano subito, in tempo reale.",
        "steps": [
          "Trascina il cursore 'Variazione Fatturato' per simulare un aumento o una diminuzione percentuale dei ricavi.",
          "Trascina il cursore 'Variazione Costo Personale' per simulare un aumento o una diminuzione percentuale del costo del personale.",
          "Attiva l'interruttore 'Nuovo punto vendita' se vuoi simulare l'apertura di un altro negozio: si apre un campo dove indicare i costi annui stimati (il ricavo stimato è preso automaticamente come media dei punti vendita esistenti).",
          "Per ripartire da zero, clicca 'Resetta Scenario': i cursori e l'interruttore tornano ai valori di default."
        ]
      },
      {
        "heading": "Leggere i risultati della simulazione",
        "body": "Il riquadro 'Risultati Scenario in Tempo Reale' mostra il Margine Previsto (confrontato con quello attuale), l'impatto mensile sulla cassa e, a seconda che tu stia simulando o meno un nuovo punto vendita, i 'Mesi al Break-Even' (quanti mesi servono per rientrare dell'investimento) oppure il 'Delta Utile Annuo' rispetto alla situazione attuale. Più sotto, la tabella 'Confronto Scenario Attuale vs Simulato' mette voce per voce (Ricavi, Costi, Personale, Utile, Margine %) i valori di partenza accanto a quelli simulati, con la differenza in euro. Il grafico a barre in fondo confronta visivamente Ricavi, Costi e Utile tra scenario attuale e scenario simulato."
      },
      {
        "heading": "Salvare uno scenario",
        "body": "Quando modifichi almeno un parametro, compare il pulsante 'Salva Scenario' in alto a destra: ti permette di conservare la simulazione fatta. Se il salvataggio non riesce perché la funzione non è ancora attiva sul sistema, la pagina te lo segnala con un messaggio, ma i risultati restano comunque visibili e utilizzabili sullo schermo.",
        "steps": [
          "Imposta i parametri desiderati con i cursori e/o l'interruttore.",
          "Clicca 'Salva Scenario' in alto a destra.",
          "Attendi il messaggio di conferma (verde) o l'eventuale avviso."
        ]
      }
    ],
    "faq": [
      {
        "q": "Se modifico i cursori qui, cambio i dati reali del Budget?",
        "a": "No. È solo una simulazione: nulla di quello che fai in questa pagina modifica i dati di Budget & Controllo o del Conto Economico, a meno che tu non usi esplicitamente 'Salva Scenario' (che salva comunque una simulazione separata, non tocca il budget)."
      },
      {
        "q": "Da dove prende i numeri di partenza questa pagina?",
        "a": "Dai dati già inseriti in Budget & Controllo per l'anno selezionato (i budget_entries): se lì non c'è nulla per quell'anno, la pagina mostra un avviso di 'Nessun dato budget trovato'."
      },
      {
        "q": "Come viene stimato il ricavo del nuovo punto vendita quando attivo l'interruttore?",
        "a": "Il sistema calcola automaticamente la media dei ricavi dei punti vendita esistenti e la usa come stima per il nuovo punto vendita; i costi invece li indichi tu nel campo che compare."
      },
      {
        "q": "Cosa significa 'Mesi al Break-Even'?",
        "a": "È una stima di quanti mesi servirebbero per recuperare l'investimento iniziale del nuovo punto vendita, calcolata sull'utile annuo stimato di quel punto vendita. Se compare 'Mai', significa che con i costi indicati il nuovo punto vendita non genererebbe utile."
      }
    ]
  },
  {
    "path": "/store-manager",
    "icon": "Store",
    "title": "Dashboard Punto Vendita",
    "description": "Una vista pensata per la giornata del negozio: incasso, obiettivi, vendite orarie, personale in turno e una checklist di attività operative. In alto puoi scegliere a quale punto vendita riferirti.",
    "sections": [
      {
        "heading": "Importante: al momento i numeri sono di esempio",
        "body": "Questa pagina, così com'è oggi, mostra dei dati dimostrativi fissi (incasso, scontrini, personale in turno, top prodotti, meteo) e non è ancora collegata alla cassa o alle presenze reali del punto vendita. Il selettore in alto a destra permette comunque di cambiare punto vendita tra quelli reali dell'azienda, ma i numeri mostrati sotto non cambiano di conseguenza: sono sempre gli stessi valori di esempio, indipendentemente dall'outlet scelto."
      },
      {
        "heading": "KPI della giornata",
        "body": "Quattro caselle in alto mostrano: incasso di oggi, numero di scontrini emessi, scontrino medio e pezzi venduti (con il confronto percentuale rispetto allo stesso periodo dell'anno precedente)."
      },
      {
        "heading": "Obiettivi giornaliero, settimanale e mensile",
        "body": "Tre barre di avanzamento mostrano quanto incasso è stato raggiunto rispetto all'obiettivo: giornaliero e settimanale come barra orizzontale, mensile come cerchio con la percentuale al centro. La barra dell'obiettivo giornaliero diventa verde quando si raggiunge il 100%, arancione se ancora sotto."
      },
      {
        "heading": "Vendite per ora e top prodotti",
        "body": "Un grafico a barre mostra l'andamento delle vendite ora per ora nella giornata. Sotto trovi la classifica dei cinque prodotti più venduti oggi, con quantità e importo, e una tabella di confronto tra l'incasso di oggi, quello di ieri e la media degli ultimi 7 giorni."
      },
      {
        "heading": "Personale in servizio",
        "body": "L'elenco delle persone in turno con l'orario (mattina, pomeriggio o giornata intera), le ore lavorate e le vendite realizzate da ciascuna."
      },
      {
        "heading": "Checklist operativa",
        "body": "Un elenco di attività da svolgere in negozio (es. riordino magazzino, verifica esposizione, chiusura cassa). Puoi spuntarle cliccandoci sopra per segnarle come completate.",
        "steps": [
          "Clicca su una voce della lista per segnarla come completata (o per togliere il segno di spunta).",
          "Le voci completate appaiono barrate e in grigio.",
          "Attenzione: lo stato delle spunte non viene salvato in modo permanente — ricaricando la pagina la checklist torna alla situazione di partenza."
        ]
      },
      {
        "heading": "Meteo e azioni veloci",
        "body": "Un riquadro mostra temperatura e condizioni meteo della città dell'outlet selezionato (dato di esempio). Più sotto ci sono tre pulsanti — Segnala Problema, Richiedi Merce, Note Giornaliere — che al momento sono solo pulsanti dimostrativi: cliccandoli non succede ancora nulla, sono un'anteprima di funzioni che verranno collegate in futuro. In fondo compare anche un avviso con il tempo mancante alla chiusura cassa."
      }
    ],
    "faq": [
      {
        "q": "Se cambio punto vendita nel selettore in alto, cambiano i numeri della pagina?",
        "a": "Il selettore cambia il nome del punto vendita mostrato, ma i dati sottostanti (incasso, scontrini, personale) sono ancora numeri di esempio uguali per tutti gli outlet: non riflettono ancora l'attività reale del punto vendita scelto."
      },
      {
        "q": "Se clicco su \"Segnala Problema\" o \"Richiedi Merce\", parte una segnalazione?",
        "a": "No, non ancora. Questi pulsanti sono presenti in pagina ma non sono collegati a nessuna funzione: al momento non generano nessuna richiesta o notifica."
      },
      {
        "q": "Se spunto le voci della checklist e poi ricarico la pagina, restano segnate?",
        "a": "No. Le spunte della checklist non vengono salvate: sono solo per uso immediato durante la sessione e si azzerano quando si ricarica o si riapre la pagina."
      }
    ]
  },
  {
    "path": "/import-hub",
    "icon": "DatabaseZap",
    "title": "Hub Importazioni Dati",
    "description": "L'Hub Importazioni è il punto unico da cui caricare in gestionale tutti i documenti e i file che arrivano dall'esterno: estratti conto, fatture, cedolini, bilanci, dati dei punti vendita e corrispettivi. Da qui i file vengono caricati, controllati e trasformati in dati utilizzabili nel resto del programma.",
    "sections": [
      {
        "heading": "A cosa serve questa pagina",
        "body": "L'Hub Importazioni Dati è organizzato in tre schede, visibili in alto: \"Fonti di importazioni\" (dove si caricano davvero i file, divisi per tipologia), \"Panoramica\" (alcuni numeri riassuntivi su quanto importato) e \"Cronologia\" (l'elenco storico di tutti i file caricati, di qualsiasi tipo). Si parte sempre dalla scheda \"Fonti di importazioni\" per caricare un nuovo file."
      },
      {
        "heading": "Le fonti di importazione disponibili e cosa alimentano",
        "body": "Ogni \"fonte\" corrisponde a un tipo di documento diverso. Scegliere quella giusta è importante perché ogni fonte alimenta una parte diversa del gestionale:\n\n• Estratti Conto Bancari — formati CSV, XLSX, PDF. Contengono i movimenti bancari e servono per la riconciliazione con le fatture da pagare. Richiede di indicare a quale conto bancario appartiene il file.\n\n• Fatture Elettroniche — formati XML, PDF. Sono le fatture ricevute dai fornitori tramite il canale Agenzia delle Entrate/SDI e alimentano l'archivio fatture e lo scadenzario.\n\n• Cedolini / Personale — formati PDF, XLSX. Sono i cedolini e i riepiloghi dei dipendenti; alimentano i costi del personale. Richiede di indicare mese e anno di riferimento.\n\n• Bilanci — formati PDF, XLSX. Sono i bilanci annuali dell'azienda. Richiede di indicare l'anno fiscale.\n\n• Documenti Generali — tutti i formati (PDF, Word, Excel, testo, immagini). Per contratti, comunicazioni e altri documenti che non rientrano nelle altre categorie. Richiede di scegliere una categoria (Contratto, Comunicazione, Altro).\n\n• POS Data — formati CSV, Excel. Sono i dati delle vendite dei singoli punti vendita. Richiede di indicare il punto vendita.\n\n• Corrispettivi — formati CSV, XML. Sono i corrispettivi giornalieri comunicati all'Agenzia delle Entrate. Richiede di indicare il punto vendita."
      },
      {
        "heading": "Come caricare un file",
        "body": "Il caricamento è sempre un'operazione in due passi: prima si carica il file, poi (se la fonte lo prevede) si \"processa\" per portare i dati dentro il gestionale. La dimensione massima per ogni file è 50 MB; i file vuoti non vengono accettati e il sistema segnala eventuali formati non validi.",
        "steps": [
          "Aprire la scheda \"Fonti di importazioni\"",
          "Cliccare sulla fonte desiderata (es. Estratti Conto Bancari) e poi sul pulsante \"Importa\"",
          "Se richiesto, selezionare l'opzione obbligatoria: conto bancario, mese/anno, anno fiscale, categoria documento o punto vendita a seconda della fonte scelta",
          "Trascinare il file nell'area tratteggiata oppure cliccare \"Seleziona File\" e sceglierlo dal computer",
          "Attendere il completamento della barra di caricamento",
          "Il file compare nell'elenco \"File Importati\" con lo stato \"uploaded\" (caricato)"
        ]
      },
      {
        "heading": "Come elaborare (\"processare\") i file caricati",
        "body": "Il semplice caricamento non basta a portare i dati nel gestionale: per i tipi di fonte che lo prevedono (estratti conto, fatture, POS, corrispettivi, bilanci, cedolini) è necessario un secondo passaggio, chiamato \"elaborazione\" o \"processo\", che legge il contenuto del file e crea i record corrispondenti.",
        "steps": [
          "Nell'elenco \"File Importati\", cliccare sull'icona a forma di lente (\"Anteprima dati\") per controllare come verranno letti i dati prima di confermarli",
          "Cliccare \"Processa\" sul singolo file per elaborarlo e importare i dati",
          "In alternativa, usare il pulsante \"Processa tutti\" per elaborare in un colpo solo tutti i file ancora in attesa",
          "A elaborazione completata compare un riquadro con l'esito: numero di record importati con successo o eventuali errori da correggere",
          "Se un file è già stato elaborato in precedenza, al suo posto compare il pulsante \"Riprocessa\": va usato solo se si vuole sostituire i dati già importati per lo stesso periodo, perché l'operazione non si può annullare"
        ]
      },
      {
        "heading": "Cosa succede dopo l'import di un estratto conto bancario",
        "body": "Subito dopo aver elaborato con successo un estratto conto, il gestionale confronta automaticamente i movimenti in uscita con le fatture fornitori ancora da pagare e apre una finestra con il riepilogo: \"Match sicuri\" (importo e fornitore coincidono esattamente), \"Probabili\" (da controllare a mano) e \"Senza match\" (nessuna fattura corrispondente trovata). Da questa finestra si può confermare in blocco tutti i match sicuri — le relative fatture vengono segnate come pagate — oppure passare alla pagina Riconciliazione per gestire i casi dubbi uno per uno.",
        "steps": [
          "Attendere il calcolo automatico dei match (compare un messaggio di caricamento)",
          "Controllare i tre riquadri con i conteggi: match sicuri, probabili, senza match",
          "Cliccare \"Conferma [N] match sicuri\" per marcare automaticamente come pagate le fatture corrispondenti",
          "Oppure cliccare \"Vai alla Riconciliazione\" per rivedere manualmente i casi probabili",
          "Cliccare \"Chiudi\" per chiudere la finestra senza confermare nulla, se si preferisce controllare più tardi"
        ]
      },
      {
        "heading": "Gestire i file caricati: anteprima ed eliminazione",
        "body": "Ogni file nella lista mostra nome, dimensione, data di caricamento e stato. Per i PDF è disponibile un'anteprima diretta a schermo. È possibile selezionare più file con le caselle di spunta ed eliminarli in blocco, oppure eliminarne uno singolarmente con l'icona a forma di X. L'eliminazione richiede sempre una conferma e non può essere annullata."
      },
      {
        "heading": "La scheda Panoramica e la scheda Cronologia",
        "body": "La scheda \"Panoramica\" mostra alcuni numeri di sintesi (percentuale di record validi, duplicati trovati, errori di mapping da risolvere, quante fonti sono attive) e due grafici: i record importati mese per mese e la distribuzione degli import per tipo di fonte. La scheda \"Cronologia\" elenca invece, in un'unica tabella, tutti i file caricati da qualunque fonte, con data, nome file, tipo di fonte, dimensione e stato: utile per ritrovare rapidamente un caricamento fatto in passato."
      }
    ],
    "faq": [
      {
        "q": "Qual è la dimensione massima di un file che posso caricare?",
        "a": "50 MB per ogni singolo file. I file più grandi o i file vuoti vengono rifiutati con un messaggio di errore."
      },
      {
        "q": "Ho caricato un file nella fonte sbagliata, come lo tolgo?",
        "a": "Nell'elenco \"File Importati\" della fonte, clicca sull'icona X accanto al file per eliminarlo, poi caricalo di nuovo nella fonte corretta. Se il file era già stato elaborato, valuta con attenzione prima di eliminarlo perché i dati importati restano comunque nel gestionale finché non vengono rimossi separatamente."
      },
      {
        "q": "Cosa significa il pulsante \"Riprocessa\"?",
        "a": "Compare sui file già elaborati e serve a rileggerli da capo, sostituendo i dati già presenti per lo stesso periodo (stesso anno o stesso mese, a seconda della fonte). È un'operazione che non si può annullare, quindi va usata solo quando si è sicuri di voler sostituire i dati esistenti."
      },
      {
        "q": "Perché dopo aver caricato un estratto conto si apre una finestra con dei \"match\"?",
        "a": "È il calcolo automatico delle corrispondenze tra i movimenti bancari in uscita e le fatture dei fornitori ancora da pagare. Serve a velocizzare la riconciliazione: i match sicuri si possono confermare subito, quelli probabili vanno controllati a mano nella pagina Riconciliazione."
      },
      {
        "q": "Dove trovo tutti i file caricati in passato, anche di tipi diversi?",
        "a": "Nella scheda \"Cronologia\" in alto: mostra un elenco unico di tutti gli import, con data, nome file, fonte e stato."
      },
      {
        "q": "Perché per alcune fonti devo scegliere prima un'opzione (conto, mese, punto vendita)?",
        "a": "Perché quel dato serve al sistema per collegare correttamente il file: ad esempio un estratto conto deve sapere a quale conto bancario appartiene, un cedolino a quale mese si riferisce. Senza questa scelta il caricamento non parte."
      }
    ]
  },
  {
    "path": "/fornitori",
    "icon": "Building2",
    "title": "Fornitori",
    "description": "In questa pagina trovi l'anagrafica completa dei fornitori dell'azienda, con le loro condizioni di pagamento, la categoria merceologica, la ripartizione dei costi tra i punti vendita e l'analisi della spesa. È divisa in due schede: Anagrafica e Analytics.",
    "sections": [
      {
        "heading": "I riquadri riepilogativi e il selettore anno",
        "body": "In alto puoi scegliere l'anno di riferimento: cambia i dati mostrati nei riquadri riepilogativi, nella colonna \"Fatturato\"/\"Da pagare\" della tabella e nella scheda Analytics. I riquadri mostrano: numero totale di fornitori (e quanti attivi), quanti hanno una categoria assegnata, quanti hanno una divisione tra punti vendita configurata, l'importo scaduto e il totale fatturato dell'anno con il numero di fatture.",
        "steps": [
          "Scegli l'anno dal menu a tendina in alto per aggiornare i dati mostrati"
        ]
      },
      {
        "heading": "Scheda Anagrafica: cercare e filtrare i fornitori",
        "body": "La tabella elenca tutti i fornitori con: nome, P.IVA, categoria, divisione tra punti vendita, metodo di pagamento, fatturato dell'anno, importo da pagare e stato di riconciliazione bancaria dei pagamenti. Puoi cercare per nome, P.IVA, categoria o città, filtrare per categoria, per \"Stato\" (attivi/disattivati) e per \"Stato lavorazione\" (fornitori da completare: senza categoria, senza divisione, oppure con importi scaduti). Cliccando su una riga per espanderla vedi, oltre all'anagrafica e alle statistiche, tutto il piano di pagamento caricato: modalità (metodo), base di calcolo delle scadenze (Data fattura o Fine mese), giorni della prima scadenza, numero di rate e banca di pagamento. Con il pulsante \"Esporta\" in alto scarichi l'elenco in Excel/CSV con le stesse informazioni (modalità, base scadenze, 1ª scadenza, n° rate e banca), utile per rivedere in blocco cosa è impostato su ogni fornitore.",
        "steps": [
          "Usa la casella di ricerca per trovare un fornitore per nome, P.IVA, categoria o città",
          "Usa il filtro \"Stato: tutti\" per vedere solo i fornitori da lavorare (senza categoria o divisione) oppure quelli con importi scaduti",
          "Clicca su una riga per espanderla e vedere i dettagli completi: anagrafica, piano di pagamento (modalità, base scadenze, 1ª scadenza, n° rate, banca), statistiche e l'elenco delle scadenze ancora da pagare (le scadute per prime)",
          "Usa \"Esporta\" per scaricare l'elenco completo con modalità e piano di pagamento di ogni fornitore, da controllare in un foglio Excel"
        ]
      },
      {
        "heading": "Creare o modificare un fornitore",
        "body": "Con il pulsante \"Nuovo Fornitore\" in alto si apre un modulo per inserire un nuovo fornitore: dati anagrafici (ragione sociale, P.IVA, codice fiscale, codice SDI, PEC), contatti e indirizzo, condizioni di pagamento (IBAN, categoria, termini di pagamento in giorni, metodo di pagamento) e il piano delle scadenze (per le fatture emesse dal 31/07/2026): base di calcolo delle scadenze, banca di pagamento, giorni alla prima scadenza e numero di rate. Per un nuovo fornitore la base parte già impostata su \"Fine mese\" (la scadenza standard), ma puoi cambiarla in \"Data fattura\" quando serve. Per alcuni metodi di pagamento (Ri.Ba. 30/60/90/120, RID, SDD Core/B2B, carta di credito o debito) la banca di pagamento è obbligatoria, perché serve per lo storno nelle simulazioni di cash flow: in questi casi, se non selezioni una banca il salvataggio viene bloccato con un avviso. Lo stesso modulo si apre in modifica cliccando sull'icona della matita nella riga del fornitore.",
        "steps": [
          "Clicca \"Nuovo Fornitore\" per aggiungerne uno, oppure l'icona della matita su una riga per modificarlo",
          "Compila almeno la Ragione Sociale, che è obbligatoria",
          "Se scegli un metodo di pagamento che richiede la banca (Ri.Ba., RID/SDD, carte), seleziona anche la banca di pagamento: senza di essa il salvataggio non viene consentito",
          "Clicca \"Crea Fornitore\" o \"Salva Modifiche\" per confermare"
        ]
      },
      {
        "heading": "Revisione pagamenti (controllo veloce di tutti i fornitori)",
        "body": "Il pulsante \"Revisione pagamenti\" in alto apre una schermata dedicata dove scorri tutti i fornitori attivi in ordine alfabetico e controlli, riga per riga, la Tipologia di pagamento (bonifico, Ri.Ba., RID…), la Modalità delle scadenze (es. \"60/90/120 gg DFFM\", \"A Vista\", \"Data fissa mese\" con il giorno) e la Banca. Modifichi solo i fornitori sbagliati (la riga diventa gialla) e premi \"Salva e applica\": le correzioni vengono applicate subito ai fornitori. Ogni modifica salva anche il valore precedente, quindi è sempre annullabile. I fornitori che lasci invariati restano come sono.",
        "steps": [
          "Clicca \"Revisione pagamenti\" nell'intestazione della pagina Fornitori",
          "Correggi Tipologia, Modalità e Banca solo dove serve; le righe modificate diventano gialle",
          "Premi \"Salva e applica\" per aggiornare subito i fornitori",
          "Usa \"Annulla modifiche\" per scartare le correzioni non ancora salvate"
        ]
      },
      {
        "heading": "Il pannello Gestione: categoria, divisione tra punti vendita e fatture",
        "body": "Cliccando sull'icona a forma di cursori (\"Gestione fornitore\") in una riga si apre un pannello con tre blocchi. Il primo permette di assegnare o cambiare la categoria merceologica del fornitore (salvata subito, senza bisogno di aprire il modulo di modifica). Il secondo permette di impostare come il costo di questo fornitore viene ripartito tra i punti vendita: Diretto (tutto a un solo punto vendita), Split % (percentuali libere che devono sommare a 100%), Split Valore (un importo fisso per ciascun punto vendita) oppure Quote Uguali (diviso in parti uguali tra i punti vendita selezionati; se in futuro cambia il numero di punti vendita attivi, la quota si ricalcola automaticamente). Questa sezione è disponibile solo se l'azienda ha almeno due punti vendita attivi. Il terzo blocco mostra l'elenco delle fatture elettroniche di quel fornitore, con la possibilità di aprirle in formato leggibile o di aprire l'eventuale PDF allegato.",
        "steps": [
          "Clicca sull'icona dei cursori nella riga del fornitore per aprire il pannello Gestione",
          "Nel blocco \"Categoria merceologica\" scegli la categoria dal menu: si salva subito",
          "Nel blocco \"Divisione\" scegli una delle quattro modalità e compila i dati richiesti (percentuali, importi o selezione dei punti vendita), poi clicca \"Salva divisione\"",
          "Nel blocco \"Fatture del fornitore\" clicca \"Apri\" per vedere una fattura formattata, oppure \"PDF\" per aprire l'eventuale documento PDF allegato"
        ]
      },
      {
        "heading": "Scheda contabile del fornitore",
        "body": "Dall'icona a forma di libro nella riga di un fornitore si apre la sua scheda contabile completa, con partitario, fatture e pagamenti (vedi la guida dedicata a questa pagina).",
        "steps": [
          "Clicca sull'icona del libro nella riga del fornitore per aprire la sua scheda contabile"
        ]
      },
      {
        "heading": "Scheda Analytics: grafici di spesa",
        "body": "Questa scheda mostra tre grafici calcolati sui dati dell'anno selezionato: i fornitori con la spesa più alta, la ripartizione della spesa per categoria merceologica (se nessun fornitore ha ancora una categoria, compare un invito ad assegnarle) e una tabella di analisi \"aging\" con, per ciascun fornitore, il totale fatturato, quanto è già stato pagato, quanto è in scadenza e quanto è scaduto.",
        "steps": [
          "Passa alla scheda \"Analytics\" per consultare i grafici",
          "Se il grafico \"Spesa per categoria\" è vuoto o generico, assegna le categorie ai fornitori dal pannello Gestione o dalla pagina di categorizzazione automatica"
        ]
      },
      {
        "heading": "Disattivare un fornitore",
        "body": "Il fornitore non viene mai cancellato definitivamente dal sistema: l'icona del cestino nella riga lo disattiva (chiede prima una conferma). Un fornitore disattivato resta consultabile ma non compare più tra quelli \"attivi\" nei filtri di default.",
        "steps": [
          "Clicca sull'icona del cestino nella riga del fornitore",
          "Conferma quando il sistema chiede se vuoi disattivarlo"
        ]
      }
    ],
    "faq": [
      {
        "q": "Qual è la differenza tra le quattro modalità di divisione tra punti vendita?",
        "a": "Diretto assegna tutto il costo a un solo punto vendita. Split % ripartisce il costo secondo percentuali che tu inserisci (devono sommare a 100%). Split Valore assegna un importo fisso in euro a ciascun punto vendita. Quote Uguali divide il costo in parti uguali tra i punti vendita selezionati, e si ricalcola da sola se in futuro cambia il numero di punti vendita attivi."
      },
      {
        "q": "Perché non vedo il blocco \"Divisione tra punti vendita\" nel pannello Gestione?",
        "a": "Quella sezione compare solo se l'azienda ha almeno due punti vendita attivi. Con un solo punto vendita attivo, tutti i costi vanno automaticamente a quell'unica sede e la divisione non serve."
      },
      {
        "q": "Se cambio la categoria di un fornitore dal pannello Gestione, devo salvare separatamente?",
        "a": "No, il salvataggio della categoria è immediato: appena la selezioni dal menu, viene registrata subito senza bisogno di un pulsante \"Salva\" aggiuntivo."
      },
      {
        "q": "Cosa vuol dire il pallino accanto al numero di pagamenti riconciliati (es. 3/5)?",
        "a": "Indica quanti dei pagamenti già effettuati a quel fornitore sono stati abbinati (riconciliati) a un movimento bancario reale. Il segno di spunta verde vuol dire che tutti sono riconciliati, il triangolo di avviso arancione che alcuni pagamenti non hanno ancora un movimento bancario associato."
      },
      {
        "q": "Come faccio a vedere il PDF allegato a una fattura di un fornitore?",
        "a": "Apri il pannello Gestione del fornitore (icona dei cursori), scorri fino a \"Fatture del fornitore\" e clicca il pulsante \"PDF\" sulla riga della fattura che ti interessa. Se il fornitore non ha allegato nessun PDF, il sistema te lo segnala con un messaggio: non è un errore, puoi comunque vedere la fattura con \"Apri\"."
      },
      {
        "q": "Come verifico quale modalità e piano di pagamento è caricato su ogni fornitore?",
        "a": "Due modi. Per un singolo fornitore: clicca sulla sua riga per espanderla e leggi il blocco pagamenti (modalità, base scadenze Data fattura/Fine mese, giorni della prima scadenza, numero di rate e banca). Per rivedere tutti insieme: clicca \"Esporta\" in alto e scarica il file Excel/CSV, che riporta per ogni fornitore modalità, base scadenze, 1ª scadenza, numero di rate e banca di pagamento — così puoi controllare l'intera anagrafica in un colpo solo."
      }
    ]
  },
  {
    "path": "/fornitori/scheda-contabile",
    "icon": "Building2",
    "title": "Scheda Contabile Fornitore",
    "description": "Questa pagina mostra la situazione contabile completa di un singolo fornitore: anagrafica, fatture ricevute anno per anno e il partitario (il registro con tutti i movimenti di dare e avere) che tiene traccia di quanto l'azienda deve o ha già pagato a quel fornitore. Si apre cliccando sull'icona del libro nella pagina Fornitori.",
    "sections": [
      {
        "heading": "L'intestazione del fornitore",
        "body": "In alto trovi i dati principali del fornitore (P.IVA, codice fiscale, indirizzo, IBAN, email, PEC, telefono) e alcuni pulsanti: \"Torna ai fornitori\" per uscire dalla scheda, tre pulsanti di stampa (scheda completa, solo fatture, solo partitario) e, se ci sono fatture scadute, un pulsante rosso \"Paga scadute\" che ti porta direttamente allo scadenzario con quel fornitore già impostato come filtro.",
        "steps": [
          "Usa \"Torna ai fornitori\" per tornare all'elenco",
          "Usa uno dei tre pulsanti di stampa per stampare la versione che ti serve",
          "Se compare \"Paga scadute\", cliccalo per andare allo scadenzario con le scadenze di questo fornitore già filtrate"
        ]
      },
      {
        "heading": "I riquadri riepilogativi",
        "body": "Subito sotto l'intestazione trovi i numeri chiave: totale fatturato, totale già pagato, eventuale totale delle note di credito (compare solo se presenti), saldo contabile (in rosso se l'azienda è in debito verso il fornitore) e numero di fatture scadute sul totale."
      },
      {
        "heading": "Ripresa saldo (saldo di apertura dell'anno)",
        "body": "Questo riquadro mostra il saldo di apertura dell'anno selezionato, cioè il debito o credito residuo al 31 dicembre dell'anno precedente, riportato manualmente in fase di avvio del sistema o inserito da un operatore. Il segno negativo indica un debito dell'azienda verso il fornitore, positivo un credito a favore dell'azienda. Puoi modificarlo con il pulsante \"Modifica\", inserendo importo e data di riferimento.",
        "steps": [
          "Controlla il saldo di apertura mostrato per l'anno selezionato",
          "Clicca \"Modifica\" se devi correggere l'importo o la data",
          "Inserisci l'importo (usa il segno meno per un debito) e la data, poi clicca \"Salva\""
        ]
      },
      {
        "heading": "Tabella Fatture per anno",
        "body": "Selezionando un anno dalle schede in alto (o \"Tutti\" per vederli tutti insieme) la tabella mostra le fatture di quel periodo: numero, data, scadenza, imponibile, IVA, totale, stato e data di pagamento (se pagata, indica quanti giorni mancano o sono passati dalla scadenza). Le note di credito sono evidenziate in verde con l'etichetta \"Nota Credito\". Se una fattura è divisa in più rate, una freccetta permette di espanderla e vedere il dettaglio di ogni rata con il proprio stato. Da ogni riga puoi aprire il documento originale o, se non ancora pagata, andare direttamente allo scadenzario per pagarla.",
        "steps": [
          "Clicca su un anno nelle schede in alto per filtrare le fatture di quel periodo, oppure su \"Tutti\" per vederle tutte",
          "Clicca sulla freccetta a sinistra di una fattura con più rate per espanderla",
          "Clicca sull'icona dell'occhio per aprire il documento originale della fattura",
          "Clicca sull'icona della carta di credito per andare a pagare una fattura non ancora saldata"
        ]
      },
      {
        "heading": "Partitario — Conto Fornitore",
        "body": "Il partitario è il registro contabile del fornitore: in colonna AVERE trovi le fatture ricevute (che aumentano il debito verso il fornitore), in colonna DARE i pagamenti effettuati e le note di credito (che lo riducono). Ogni riga mostra anche il saldo progressivo: se scende sotto zero (evidenziato in rosso) significa che l'azienda è ancora in debito. Puoi scegliere se ordinare i movimenti per data di emissione fattura o per data effettiva di pagamento, con il menu \"Ordina per\" in alto a destra della tabella. In fondo trovi i totali dei movimenti selezionati e il saldo corrente della scheda.",
        "steps": [
          "Scegli \"Data fattura\" o \"Data pagamento\" dal menu \"Ordina per\" in alto alla tabella",
          "Leggi la colonna Saldo: un valore in rosso indica un debito residuo verso il fornitore",
          "Controlla la riga dei totali in fondo per il saldo complessivo del periodo selezionato"
        ]
      }
    ],
    "faq": [
      {
        "q": "Cosa significa \"AVERE\" e cosa significa \"DARE\" nel partitario?",
        "a": "AVERE raccoglie le fatture ricevute dal fornitore, che aumentano quanto l'azienda gli deve. DARE raccoglie i pagamenti effettuati e le note di credito, che riducono quel debito. Il saldo è la differenza tra le due colonne."
      },
      {
        "q": "Perché il saldo è mostrato in rosso?",
        "a": "Il saldo compare in rosso quando è negativo, cioè quando l'azienda ha ancora un debito aperto verso quel fornitore. Un saldo a zero (o positivo) significa che le partite sono chiuse o che il fornitore è addirittura in credito verso l'azienda."
      },
      {
        "q": "Come faccio a pagare una fattura scaduta direttamente da qui?",
        "a": "Se il fornitore ha fatture scadute, in alto compare il pulsante rosso \"Paga scadute\": cliccandolo vieni portata allo Scadenzario con quel fornitore già impostato come filtro. In alternativa puoi cliccare l'icona della carta di credito sulla singola fattura nella tabella."
      },
      {
        "q": "A cosa serve la \"Ripresa saldo\"?",
        "a": "Serve a registrare il saldo di apertura dell'anno, cioè il debito o credito che esisteva già al 31 dicembre dell'anno precedente prima che nel sistema fossero registrati i movimenti dell'anno corrente. Il partitario dell'anno parte sempre da questo valore."
      },
      {
        "q": "Posso stampare solo il partitario senza l'elenco fatture?",
        "a": "Sì, in alto trovi tre pulsanti di stampa distinti: uno per la scheda completa, uno per la sola tabella fatture e uno per il solo partitario."
      }
    ]
  },
  {
    "path": "/fatturazione",
    "icon": "FileCode",
    "title": "Fatturazione Elettronica",
    "description": "In questa pagina trovi tutte le fatture elettroniche dell'azienda: quelle ricevute dai fornitori, quelle emesse verso i clienti e gli incassi giornalieri dei punti vendita. La pagina è divisa in tre schede (Fatture Passive, Fatture Attive, Corrispettivi).",
    "sections": [
      {
        "heading": "Come è organizzata la pagina",
        "body": "In alto trovi il titolo \"Fatturazione Elettronica\" e il pulsante \"Sincronizza SDI\": serve per andare a scaricare subito le nuove fatture passive dal Sistema di Interscambio (SDI) tramite A-Cube, il fornitore che gestisce l'invio e la ricezione delle fatture elettroniche per conto dell'azienda. In automatico il download avviene già ogni 6 ore; il pulsante serve solo se vuoi forzare un aggiornamento immediato. Sotto il titolo trovi tre schede: Fatture Passive, Fatture Attive e Corrispettivi. Il numero tra parentesi accanto al nome di ogni scheda indica quante righe contiene.",
        "steps": [
          "Clicca su \"Sincronizza SDI\" se vuoi controllare subito se sono arrivate nuove fatture dai fornitori",
          "Usa le tre schede in alto per passare da una vista all'altra"
        ]
      },
      {
        "heading": "Scheda Fatture Passive (le fatture che ricevi dai fornitori)",
        "body": "Qui trovi l'elenco delle fatture elettroniche ricevute dai fornitori, con data, numero, fornitore, tipo documento, imponibile, IVA e totale. In alto vedi quattro riquadri riepilogativi: numero di fatture passive, numero di note di credito, totale lordo e totale IVA dell'anno selezionato. Sotto ai riquadri, se ci sono anomalie nella configurazione dei pagamenti di qualche fornitore, compare un avviso apposito. Puoi cercare per fornitore, numero fattura o codice SDI, e filtrare per anno. Cliccando su una riga (o sull'icona dell'occhio) si apre la fattura formattata, leggibile come un documento normale.",
        "steps": [
          "Usa la casella di ricerca per trovare una fattura per fornitore, numero o codice SDI",
          "Scegli l'anno dal menu a tendina per filtrare l'elenco",
          "Clicca su una riga della tabella per aprire la fattura in formato leggibile",
          "Usa \"Importa XML\" per caricare manualmente un file XML di fattura ricevuto fuori dal circuito automatico",
          "Usa \"Associa XML\" per collegare uno o più file XML già presenti sul computer a fatture già importate ma prive del documento originale (l'abbinamento avviene per numero fattura e P.IVA)"
        ]
      },
      {
        "heading": "Scheda Fatture Attive (le fatture che emetti tu)",
        "body": "Qui trovi le fatture emesse dall'azienda verso i clienti, con data, numero, cliente, tipo documento, totale e stato SDI. Lo stato SDI ti dice a che punto è la fattura: Bozza (non ancora inviata), Inviata, Ricevuta, Consegnata, Accettata, Scartata, Depositata o Errore. Cliccando su una riga si apre un pannello con tutti i dettagli del cliente, gli importi, la scadenza e la cronologia delle notifiche ricevute da SDI (ricevuta di consegna, notifica di scarto, mancata consegna, ecc.).",
        "steps": [
          "Cerca una fattura per cliente o numero, oppure filtra per periodo",
          "Per una fattura in bozza senza documento, clicca sull'icona del foglio per generarne l'XML",
          "Quando l'XML è pronto, clicca sull'icona dell'aeroplanino di carta per inviarla a SDI",
          "Clicca su una riga per vedere il dettaglio completo e la cronologia delle notifiche SDI",
          "Usa \"Converti Excel → XML\" per trasformare l'export del gestionale in file XML pronti per l'invio (vedi la guida dedicata a quella pagina)"
        ]
      },
      {
        "heading": "Scheda Corrispettivi (incassi giornalieri dei punti vendita)",
        "body": "Questa scheda mostra gli incassi giornalieri registrati dalle casse (POS) dei punti vendita, riepilogati mese per mese e per punto vendita: incasso lordo, numero di transazioni e scontrino medio. In alto trovi due pulsanti per cambiare vista: \"POS\" mostra il riepilogo mensile calcolato dai dati di cassa; \"Cassetto Fiscale\" mostra invece i corrispettivi telematici così come risultano inviati all'Agenzia delle Entrate, con il relativo stato di invio (Inviato, In attesa, Errore). Puoi filtrare per punto vendita.",
        "steps": [
          "Scegli tra vista \"POS\" e vista \"Cassetto Fiscale\" con i due pulsanti in alto",
          "Filtra per punto vendita se vuoi vedere solo un negozio",
          "Nella vista Cassetto Fiscale controlla la colonna \"Stato AdE\" per capire se un corrispettivo è stato inviato correttamente"
        ]
      }
    ],
    "faq": [
      {
        "q": "Da dove arrivano le fatture passive che vedo in questa pagina?",
        "a": "Arrivano automaticamente dal Sistema di Interscambio (SDI) tramite A-Cube, il fornitore che gestisce l'invio e la ricezione delle fatture elettroniche. Il sistema le scarica in automatico ogni 6 ore, oppure puoi forzare il download subito con il pulsante \"Sincronizza SDI\". In alternativa puoi importare manualmente un file XML con il pulsante \"Importa XML\" nella scheda Fatture Passive."
      },
      {
        "q": "Cosa significa lo stato \"Bozza\" su una fattura attiva?",
        "a": "Significa che la fattura è stata creata nel gestionale ma non è ancora stata inviata al Sistema di Interscambio. Prima serve generare l'XML, poi si può inviare."
      },
      {
        "q": "Perché il pulsante \"Nuova via A-Cube\" nella scheda Fatture Attive è disattivato?",
        "a": "L'emissione diretta di una nuova fattura tramite A-Cube è temporaneamente disattivata. Per creare i documenti da inviare, al momento va usato il pulsante \"Converti Excel → XML\", che genera i file XML a partire dall'export del gestionale."
      },
      {
        "q": "Cosa vuol dire \"Associa XML\" e quando lo devo usare?",
        "a": "Serve quando hai già una fattura importata nel sistema ma senza il file XML originale collegato: caricando uno o più XML, il sistema li abbina automaticamente alla fattura giusta cercando lo stesso numero fattura e, se disponibile, la stessa P.IVA del fornitore."
      },
      {
        "q": "Perché nella vista Cassetto Fiscale non vedo nessun dato?",
        "a": "Il canale di sincronizzazione automatica dei corrispettivi telematici con il cassetto fiscale dell'Agenzia delle Entrate non è ancora attivo per questo tenant: è normale se la lista risulta vuota."
      }
    ]
  },
  {
    "path": "/fatturazione/nuova-acube",
    "icon": "FileCode",
    "title": "Nuova Fattura Attiva — A-Cube SDI",
    "description": "Questa pagina è un modulo per creare ed emettere una nuova fattura attiva (cioè una fattura che l'azienda emette verso un cliente) tramite A-Cube, il servizio che si occupa dell'invio al Sistema di Interscambio (SDI). Si raggiunge dal link \"Torna a Fatturazione\" oppure dall'indirizzo /fatturazione/nuova-acube.",
    "sections": [
      {
        "heading": "Scegliere l'ambiente: Sandbox o Production",
        "body": "In cima al modulo trovi due pulsanti per scegliere l'ambiente di invio. \"Sandbox\" è un ambiente di prova: la fattura NON viene realmente inviata a SDI, quindi puoi usarla per fare dei test senza conseguenze. \"Production\" è l'ambiente reale: se scegli questa opzione la fattura viene davvero inviata al Sistema di Interscambio e diventa un documento fiscale a tutti gli effetti. Quando selezioni Production, compare un avviso: una fattura inviata in produzione non si può annullare, si può solo correggere emettendo una nota di credito.",
        "steps": [
          "Lascia \"Sandbox\" selezionato se vuoi solo fare una prova",
          "Seleziona \"Production\" solo quando sei sicura di voler emettere davvero la fattura",
          "Leggi con attenzione l'avviso arancione che compare in modalità Production prima di procedere"
        ]
      },
      {
        "heading": "Dati del cliente (Cessionario)",
        "body": "In questa sezione inserisci i dati del cliente a cui è indirizzata la fattura: Partita IVA o Codice Fiscale (obbligatorio), Ragione sociale (obbligatoria), Città, Provincia e CAP.",
        "steps": [
          "Compila Partita IVA/Codice Fiscale e Ragione sociale: sono obbligatori, senza questi dati non puoi inviare la fattura",
          "Compila anche Città, Provincia e CAP quando disponibili"
        ]
      },
      {
        "heading": "Dati del documento",
        "body": "Qui imposti il numero della fattura (viene proposto automaticamente ma puoi modificarlo), la data e il tipo di documento. I tipi disponibili sono: TD01 — Fattura, TD04 — Nota di credito, TD24 — Fattura differita.",
        "steps": [
          "Controlla o modifica il numero fattura proposto",
          "Verifica la data del documento",
          "Scegli il tipo documento corretto dal menu a tendina"
        ]
      },
      {
        "heading": "Linee documento (le voci della fattura)",
        "body": "Ogni riga della fattura ha una descrizione, una quantità, un prezzo unitario e un'aliquota IVA (22%, 10%, 4%, 5% o 0%). Puoi aggiungere altre righe con \"Aggiungi linea\" oppure eliminarle con l'icona del cestino (non puoi eliminare l'ultima riga rimasta). In fondo alla sezione il sistema calcola automaticamente l'imponibile, l'IVA e il totale della fattura.",
        "steps": [
          "Compila descrizione, quantità, prezzo unitario e aliquota IVA per ogni riga",
          "Clicca \"Aggiungi linea\" se la fattura ha più voci",
          "Usa il cestino per rimuovere una riga inserita per errore",
          "Controlla il totale calcolato in fondo prima di inviare"
        ]
      },
      {
        "heading": "Invio della fattura",
        "body": "Quando tutti i dati obbligatori sono compilati, il pulsante di invio si attiva e mostra l'ambiente scelto (es. \"Invia via A-Cube (sandbox)\"). Dopo l'invio, se tutto va a buon fine, compare un riquadro verde con l'identificativo A-Cube della fattura, l'eventuale identificativo SDI e il totale. In caso di errore compare invece un riquadro rosso con il messaggio di errore. Dal riquadro di successo puoi creare subito un'altra fattura.",
        "steps": [
          "Verifica che il pulsante di invio sia attivo (non grigio): significa che i campi obbligatori sono compilati",
          "Clicca sul pulsante di invio e attendi la conferma",
          "Se compare il riquadro verde, la fattura è stata inviata correttamente",
          "Se compare il riquadro rosso, leggi il messaggio di errore e correggi i dati prima di ritentare",
          "Clicca \"Crea un'altra fattura\" per ripartire da un modulo vuoto"
        ]
      }
    ],
    "faq": [
      {
        "q": "Cosa succede se invio una fattura in modalità Sandbox?",
        "a": "Niente di reale: la fattura non viene inviata al Sistema di Interscambio, serve solo per fare una prova del modulo e verificare che i dati siano corretti."
      },
      {
        "q": "Posso annullare una fattura inviata in Production?",
        "a": "No. Una fattura inviata in ambiente Production è un documento fiscale reale e non si può annullare: l'unico modo per correggerla è emettere una nota di credito (tipo documento TD04)."
      },
      {
        "q": "Quali campi sono obbligatori per poter inviare la fattura?",
        "a": "Partita IVA/Codice Fiscale del cliente e Ragione sociale del cliente sono obbligatori. Anche numero e data documento vanno sempre compilati, così come almeno una riga con descrizione, quantità e prezzo."
      },
      {
        "q": "Questa pagina è raggiungibile dal pulsante nella schermata Fatturazione?",
        "a": "Al momento il pulsante \"Nuova via A-Cube\" nella scheda Fatture Attive di Fatturazione è disattivato. Questa pagina resta comunque raggiungibile direttamente dal suo indirizzo (/fatturazione/nuova-acube) se qualcuno te ne indica il link."
      }
    ]
  },
  {
    "path": "/fatturazione/converti-xml",
    "icon": "FileCode",
    "title": "Converti Excel → XML Fattura Elettronica",
    "description": "Questo strumento trasforma l'export Excel del gestionale in file XML di fattura elettronica (formato FPR12), pronti per essere importati sul sito dell'Agenzia delle Entrate. Funziona interamente sul tuo computer, senza inviare nulla a SDI: genera solo i file da caricare tu stessa.",
    "sections": [
      {
        "heading": "Attenzione: è uno strumento provvisorio",
        "body": "Gli XML generati NON sono firmati digitalmente (niente file .p7m) e non sono validati contro lo schema ufficiale dell'Agenzia delle Entrate: hanno comunque la stessa forma già usata in passato per l'importazione manuale. Ogni fattura ha un'unica riga di dettaglio generica (\"Fornitura merce vs/ordine\"), non articolo per articolo. I dati dell'azienda cedente (NEW ZAGO S.R.L., P.IVA 07362100484) e l'aliquota IVA al 22% sono fissi e non modificabili da questa pagina."
      },
      {
        "heading": "Il numero di partenza (progressivo)",
        "body": "Ogni fattura elettronica ha bisogno di un numero progressivo di trasmissione, che deve sempre aumentare rispetto all'ultimo usato. La pagina ricorda in automatico, nel browser che stai usando, l'ultimo numero generato e propone già il numero successivo. Se non c'è nessuno storico salvato, viene proposto un numero di partenza di default che puoi comunque modificare.",
        "steps": [
          "Controlla il riquadro in alto: ti dice qual era l'ultimo numero generato e quale sarà il prossimo",
          "Modifica il \"Numero di partenza\" solo se sei sicura che il valore proposto non sia corretto"
        ]
      },
      {
        "heading": "Caricare i dati delle fatture",
        "body": "Puoi fornire i dati in due modi, scegliendo la modalità con i due pulsanti in alto: \"Carica file Excel\" per trascinare o selezionare il file .xls/.xlsx esportato dal gestionale (il file deve avere il titolo in riga 1, le intestazioni delle colonne in riga 2 e i dati dalla riga 3 in poi); oppure \"Incolla righe\" per incollare direttamente da Excel una o più righe di dati copiate negli appunti (meglio includere anche la riga di intestazione, così le colonne vengono riconosciute per nome anziché per posizione).",
        "steps": [
          "Scegli \"Carica file Excel\" oppure \"Incolla righe\" a seconda di come hai i dati a disposizione",
          "Per il file Excel: trascinalo nel riquadro tratteggiato oppure clicca per selezionarlo dal computer",
          "Per l'incolla: copia le righe da Excel (con intestazione, se possibile) e incollale nella casella di testo"
        ]
      },
      {
        "heading": "Generare gli XML",
        "body": "Premendo \"Genera XML\" il sistema crea un file XML per ciascuna fattura trovata, con un numero progressivo assegnato in ordine di data. Sotto compaiono degli avvisi: quante fatture sono state generate e con quali numeri, e se ci sono anomalie da controllare, ad esempio fatture in cui Imponibile + Imposta non corrisponde esattamente al Totale, fatture senza provincia riconosciuta o senza data valida. Gli XML vengono comunque generati anche in presenza di questi avvisi, ma è bene ricontrollare i dati originali.",
        "steps": [
          "Clicca \"Genera XML\" dopo aver caricato o incollato i dati",
          "Leggi gli avvisi colorati che compaiono sotto il pulsante",
          "Nella tabella di riepilogo, controlla la colonna \"Quadra\": le righe con \"NO\" (evidenziate in rosso) hanno un'incongruenza tra imponibile, imposta e totale da verificare"
        ]
      },
      {
        "heading": "Scaricare i file generati",
        "body": "Dopo la generazione puoi scaricare tutti gli XML insieme in un unico file compresso (.zip) con il pulsante \"Scarica tutti (.zip)\". Puoi anche vedere un'anteprima del primo XML generato, per un controllo veloce del contenuto prima di caricarlo sul sito dell'Agenzia delle Entrate.",
        "steps": [
          "Clicca \"Scarica tutti (.zip)\" per ottenere tutti i file XML in un colpo solo",
          "Consulta l'anteprima del primo XML se vuoi controllarne il contenuto prima di procedere"
        ]
      },
      {
        "heading": "Archivio generazioni",
        "body": "Ogni volta che generi un gruppo di XML, il sistema lo salva automaticamente in un archivio (visibile in fondo alla pagina), organizzato per data di generazione con l'intervallo di numeri progressivi usati. Da qui puoi ritrovare le generazioni passate, cercarle per numero fattura o cliente, filtrarle per periodo, riscaricare lo zip di un gruppo intero oppure il singolo file XML di una fattura, e — se necessario — eliminare una generazione dall'archivio.",
        "steps": [
          "Usa la casella di ricerca o il filtro per periodo per trovare una generazione passata",
          "Clicca \"Scarica .zip\" su un gruppo per riscaricare tutti i suoi file",
          "Clicca l'icona di download accanto a una singola fattura per scaricare solo quel file XML",
          "Usa \"Elimina\" solo se sei sicura: l'eliminazione di una generazione dall'archivio non è reversibile"
        ]
      }
    ],
    "faq": [
      {
        "q": "Gli XML generati qui vengono inviati automaticamente all'Agenzia delle Entrate?",
        "a": "No. Questo strumento lavora solo sul tuo computer e genera i file XML: nessun invio automatico avviene da questa pagina. Devi scaricare i file e importarli tu stessa sul sito dell'Agenzia delle Entrate."
      },
      {
        "q": "Cosa significa quando una riga è evidenziata in rosso con \"NO\" nella colonna Quadra?",
        "a": "Significa che per quella fattura la somma di Imponibile e Imposta non corrisponde al Totale indicato (con una tolleranza di un centesimo). Il file XML viene comunque generato, ma è bene ricontrollare i dati di origine prima di usarlo."
      },
      {
        "q": "Perché il numero di partenza proposto cambia da una volta all'altra?",
        "a": "Il sistema ricorda, nel browser che stai usando, l'ultimo numero progressivo generato e propone automaticamente il numero successivo, per evitare di riutilizzare per errore un numero già assegnato."
      },
      {
        "q": "Posso modificare l'aliquota IVA o i dati dell'azienda che emette la fattura?",
        "a": "No, in questa pagina l'aliquota IVA (22%) e i dati del cedente (NEW ZAGO S.R.L.) sono fissi e non modificabili."
      },
      {
        "q": "Se elimino per sbaglio una generazione dall'archivio, posso recuperarla?",
        "a": "No, l'eliminazione di una generazione dall'archivio non è reversibile: prima di confermare, il sistema chiede sempre una conferma esplicita proprio per questo motivo."
      }
    ]
  },
  {
    "path": "/scadenze-fiscali",
    "icon": "CalendarClock",
    "title": "Scadenze Fiscali e Interne",
    "description": "In questa pagina tieni sotto controllo tutte le scadenze da pagare: F24, IVA, imposte, contributi e uscite interne come stipendi, compensi e finanziamenti. Puoi vedere subito cosa è urgente, segnare i pagamenti fatti e aggiungerne di nuovi.",
    "sections": [
      {
        "heading": "Cosa vedi in alto: il riepilogo",
        "body": "Appena entri nella pagina trovi una barra con i numeri principali: quante scadenze sono scadute (in rosso, se presenti), quante cadono questa settimana, quante entro 30 giorni, il totale ancora da pagare e il totale già pagato. Questi numeri si aggiornano automaticamente ogni volta che aggiungi, modifichi o segni come pagata una scadenza."
      },
      {
        "heading": "I tre gruppi di scadenze",
        "body": "Sotto il riepilogo trovi tre pulsanti (schede) per filtrare l'elenco: \"Da pagare\" mostra tutto ciò che è ancora aperto; \"Pagati\" mostra le scadenze già saldate; \"Tutti\" mostra tutto, comprese quelle annullate. Accanto a ogni scheda c'è un numero che indica quante scadenze contiene.",
        "steps": [
          "Clicca su \"Da pagare\" per vedere solo ciò che devi ancora saldare",
          "Clicca su \"Pagati\" per controllare lo storico dei pagamenti effettuati",
          "Clicca su \"Tutti\" per avere la visione completa, comprese le voci annullate"
        ]
      },
      {
        "heading": "Cercare e filtrare una scadenza",
        "body": "Accanto alle schede trovi un menu a tendina per filtrare per tipo (es. F24, IVA periodica, INPS, IMU, TARI, Bollo auto, ecc.) e un campo di ricerca dove puoi digitare il titolo, il codice F24 o il periodo di riferimento per trovare rapidamente quello che cerchi."
      },
      {
        "heading": "Leggere la tabella delle scadenze",
        "body": "Ogni riga della tabella mostra: la data di scadenza, il tipo (con un'etichetta colorata), il titolo (es. \"IVA mensile — Maggio 2026\"), il periodo di riferimento, l'importo, lo stato attuale e quanti giorni mancano alla scadenza. Le righe scadute hanno uno sfondo rosso chiaro, quelle urgenti (entro 7 giorni) uno sfondo giallo chiaro, così le riconosci a colpo d'occhio."
      },
      {
        "heading": "Gli stati possibili di una scadenza",
        "body": "Ogni scadenza può trovarsi in uno di questi stati, mostrati come etichetta colorata: \"Da pagare\" (ancora aperta), \"In scadenza\" (si avvicina la data), \"Scaduto\" (il termine è passato), \"Pagato\" (saldata), \"Annullato\" (non più valida) oppure \"Rinviato\" (posticipata)."
      },
      {
        "heading": "Segnare una scadenza come pagata",
        "body": "Per le scadenze non ancora pagate trovi il pulsante \"Pagato\" nella colonna Azioni: cliccandolo la scadenza passa subito allo stato Pagato e viene registrata la data odierna come data di pagamento.",
        "steps": [
          "Individua la scadenza da segnare come saldata nella tabella",
          "Clicca sul pulsante verde \"Pagato\" nella colonna Azioni",
          "La scadenza si sposta automaticamente tra quelle pagate e il totale in alto si aggiorna"
        ]
      },
      {
        "heading": "Creare una nuova scadenza",
        "body": "Usa il pulsante \"Nuova scadenza\" in alto a destra per aprire un modulo dove inserire titolo, tipo, data di scadenza, importo, eventuale codice F24, periodo di riferimento, metodo di pagamento e note. Puoi anche indicare se la scadenza è ricorrente (mensile, trimestrale, semestrale o annuale).",
        "steps": [
          "Clicca su \"Nuova scadenza\" in alto a destra",
          "Compila almeno titolo, tipo e data di scadenza (i campi obbligatori)",
          "Se vuoi, aggiungi importo, codice F24, periodo, metodo di pagamento e note",
          "Se la scadenza si ripete nel tempo, spunta \"Ricorrente\" e scegli la frequenza",
          "Clicca su \"Crea scadenza\" per salvare"
        ]
      },
      {
        "heading": "Modificare o eliminare una scadenza",
        "body": "Nella colonna Azioni di ogni riga trovi anche l'icona per modificare (apre lo stesso modulo già compilato con i dati esistenti) e l'icona per eliminare (ti verrà chiesta una conferma prima di procedere)."
      }
    ],
    "faq": [
      {
        "q": "Cosa significa lo sfondo rosso o giallo su una riga?",
        "a": "Lo sfondo rosso indica una scadenza già scaduta e non ancora pagata. Lo sfondo giallo indica una scadenza urgente, cioè entro i prossimi 7 giorni. Serve a farti notare subito le priorità senza dover leggere ogni riga."
      },
      {
        "q": "Se sbaglio a segnare una scadenza come pagata, posso tornare indietro?",
        "a": "Puoi modificare la scadenza (icona matita) e cambiare manualmente lo Stato riportandolo a \"Da pagare\" o a un altro stato dal menu a tendina del modulo."
      },
      {
        "q": "Cosa vuol dire \"Ricorrente\"?",
        "a": "È un'indicazione che la scadenza si ripete periodicamente (ad esempio ogni mese per l'IVA). Selezionandola puoi scegliere la frequenza: mensile, trimestrale, semestrale o annuale. Serve solo come promemoria, non crea automaticamente le scadenze future."
      },
      {
        "q": "A cosa serve il campo \"Codice F24\"?",
        "a": "È il codice tributo da riportare sul modello F24 per quel pagamento (ad esempio 6001 per l'IVA). Se lo inserisci, comparirà anche sotto il titolo nella tabella come promemoria."
      }
    ]
  },
  {
    "path": "/archivio",
    "icon": "Archive",
    "title": "Archivio Documenti",
    "description": "L'Archivio Documenti è il luogo dove consultare, cercare e scaricare fatture ricevute, bilanci ed estratti conto già importati nel gestionale. Include anche la sezione Conservazione Sostitutiva, che tiene sotto controllo i tempi di conservazione obbligatoria dei documenti fiscali.",
    "sections": [
      {
        "heading": "A cosa serve questa pagina",
        "body": "In alto ci sono due schede: \"Archivio\", dove si consultano fatture, bilanci ed estratti conto già presenti nel gestionale, e \"Conservazione Sostitutiva\", dove si controlla lo stato di conservazione a norma dei documenti fiscali per i 10 anni previsti dalla legge. I documenti mostrati in questa pagina arrivano dai caricamenti fatti nella pagina Hub Importazioni: qui si consultano, non si caricano nuovi file."
      },
      {
        "heading": "Sezione Fatture Ricevute",
        "body": "Mostra tutte le fatture elettroniche ricevute dai fornitori per l'anno selezionato, con il totale in euro. Si possono raggruppare per fornitore oppure per mese, cercare per nome fornitore o numero fattura, e cambiare l'anno dal menu a tendina (che indica anche quante fatture ci sono per ogni anno). Ogni fattura mostra numero, data, importo ed eventuale stato di invio SDI (ad esempio ACCETTATA o RIFIUTATA, quando disponibile).",
        "steps": [
          "Aprire la sezione \"Fatture Ricevute\" cliccando sulla sua intestazione (parte chiusa per non affollare la pagina)",
          "Scegliere l'anno di interesse e il tipo di raggruppamento (per fornitore o per mese)",
          "Usare la casella di ricerca per trovare rapidamente un fornitore o un numero fattura",
          "Cliccare su un gruppo (fornitore o mese) per espanderlo e vedere le singole fatture",
          "Usare \"Espandi tutti\" / \"Comprimi tutti\" per aprire o chiudere tutti i gruppi insieme",
          "Su ogni fattura, cliccare \"Anteprima\" per vederla in formato leggibile, oppure \"Scarica PDF\" per generarla in PDF e aprire la finestra di stampa"
        ]
      },
      {
        "heading": "Sezione Bilanci",
        "body": "Elenca i bilanci annuali caricati, con anno, data di caricamento, dimensione del file e stato. Da qui si può aprire un'anteprima del PDF in una nuova scheda o scaricare il file. Se la lista è vuota, il messaggio ricorda che i bilanci si caricano dalla pagina Import Hub, sezione Bilanci.",
        "steps": [
          "Aprire la sezione \"Bilanci\" (di norma già aperta, essendo un elenco breve)",
          "Cliccare \"Anteprima\" per aprire il PDF del bilancio in una nuova scheda",
          "Cliccare \"Scarica\" per salvare il file sul computer"
        ]
      },
      {
        "heading": "Sezione Estratti Conto Bancari",
        "body": "Elenca gli estratti conto bancari importati, con il nome della banca, il numero di movimenti e la data. Da qui si può vedere un'anteprima dei primi 100 movimenti (data, descrizione, importo, saldo e se il movimento è già riconciliato) oppure scaricare il file originale così come è stato caricato. C'è anche un collegamento diretto alla pagina Banche > Movimenti per vedere l'elenco completo.",
        "steps": [
          "Aprire la sezione \"Estratti Conto Bancari\"",
          "Cliccare \"Anteprima\" per vedere i movimenti contenuti nel file",
          "Cliccare \"Scarica\" per ottenere il file originale (es. .xls, .xlsx)",
          "Cliccare l'icona del collegamento esterno per aprire la pagina Movimenti relativa a quel conto"
        ]
      },
      {
        "heading": "Conservazione Sostitutiva: a cosa serve",
        "body": "I documenti fiscali (fatture elettroniche e altri documenti contabili) devono per legge essere conservati per 10 anni dalla data di emissione, secondo l'articolo 2220 del Codice Civile e il Decreto Ministeriale 17/06/2014. Questa scheda tiene sotto controllo automaticamente tutti questi documenti e segnala quando una scadenza si sta avvicinando o è già passata, così da poter intervenire in tempo."
      },
      {
        "heading": "Come leggere e usare la scheda Conservazione Sostitutiva",
        "body": "In alto compaiono sei numeri riassuntivi: totale documenti, quanti sono ancora \"in conservazione\" regolare, quanti \"in scadenza\" (nei prossimi 6 mesi), quanti già \"scaduti\", e quanti sono fatture rispetto a documenti generici. Sotto, una tabella elenca ogni documento con tipo, data, importo, data di fine conservazione e stato (Conservato, Scade tra X giorni, Scaduto). Per i documenti scaduti sono disponibili le azioni \"Estendi\" (prolunga la conservazione) o \"Archivia\" (li segna come chiusi/gestiti).",
        "steps": [
          "Passare alla scheda \"Conservazione Sostitutiva\"",
          "Controllare le card in alto per farsi un'idea generale (quanti documenti sono in scadenza o scaduti)",
          "Usare i filtri rapidi \"Tutti / Attivi / In scadenza / Scaduti\" oppure il campo di ricerca per trovare un documento specifico",
          "Per un documento scaduto, cliccare \"Estendi\" se serve prolungare i tempi di conservazione, oppure \"Archivia\" se è già stato gestito"
        ]
      }
    ],
    "faq": [
      {
        "q": "Cos'è la Conservazione Sostitutiva e perché devo controllarla?",
        "a": "È l'obbligo di legge di conservare fatture e altri documenti fiscali per 10 anni. Questa scheda avvisa automaticamente quando un documento sta per raggiungere la scadenza dei 10 anni, così da poter agire (estendere o archiviare) prima che il termine passi senza essere gestito."
      },
      {
        "q": "Cosa devo fare quando un documento risulta \"Scaduto\"?",
        "a": "Puoi cliccare \"Estendi\" se la conservazione va prolungata, oppure \"Archivia\" se il documento è già stato gestito correttamente e non serve più tenerlo sotto osservazione in questa lista."
      },
      {
        "q": "Perché alcune fatture non mostrano nessuna etichetta SDI?",
        "a": "L'etichetta di stato SDI (es. ACCETTATA, RIFIUTATA) compare solo quando questa informazione è disponibile per quella fattura; se manca, semplicemente non viene mostrata nessuna etichetta."
      },
      {
        "q": "Posso scaricare l'estratto conto originale così come l'ho caricato?",
        "a": "Sì, nella sezione \"Estratti Conto Bancari\" c'è il pulsante \"Scarica\" su ogni file, che restituisce il documento originale caricato."
      },
      {
        "q": "Da dove arrivano le fatture, i bilanci e gli estratti conto che vedo in questa pagina?",
        "a": "Tutti i documenti mostrati qui sono stati caricati in precedenza dalla pagina Hub Importazioni Dati. L'Archivio Documenti serve solo a consultarli, non a caricarne di nuovi."
      },
      {
        "q": "Come faccio a trovare velocemente le fatture di un fornitore specifico?",
        "a": "Nella sezione Fatture Ricevute, imposta il raggruppamento \"Per fornitore\" e scrivi il nome nel campo di ricerca: i gruppi con risultati si aprono automaticamente."
      }
    ]
  },
  {
    "path": "/impostazioni",
    "icon": "Settings",
    "title": "Impostazioni",
    "description": "La pagina Impostazioni raccoglie i dati dell'azienda, la gestione degli utenti, il catalogo delle voci di costo, i centri di costo (punti vendita) e la configurazione della fatturazione elettronica SDI. Le sezioni visibili dipendono dal tuo ruolo utente.",
    "sections": [
      {
        "heading": "Come è organizzata la pagina",
        "body": "Le informazioni sono divise in blocchi a fisarmonica (uno sotto l'altro): Dati azienda, Utenti, Voci di costo, Centri di costo e Fatturazione SDI. Clicca sul titolo di un blocco per aprirlo o chiuderlo. Se un blocco appare più chiaro con un lucchetto, significa che il tuo ruolo non ha i permessi per accedervi: in quel caso contatta un amministratore."
      },
      {
        "heading": "Dati azienda",
        "body": "Qui trovi i dati anagrafici della società (ragione sociale, forma giuridica, sede legale, P.IVA, codice fiscale, REA, capitale sociale, PEC, codice SDI, ATECO, amministratore) e l'elenco dei soci con ruolo e quota di partecipazione.",
        "steps": [
          "Per modificare un singolo dato (es. la PEC), clicca sul valore: diventa un campo modificabile",
          "Compila il nuovo valore e clicca \"Salva\" in fondo, oppure \"Annulla\" per lasciare tutto com'era",
          "Per gestire i soci, clicca \"Modifica soci\": puoi aggiungere un nuovo socio, cambiarne nome/ruolo/quota o rimuoverlo",
          "Le quote dei soci non possono superare il 100% in totale: se succede, il sistema ti avvisa e non salva"
        ]
      },
      {
        "heading": "Utenti",
        "body": "In questa sezione gestisci le persone che hanno accesso al gestionale: nome, cognome, email, ruolo e a quali punti vendita possono accedere. Ogni utente ha un'etichetta colorata con il proprio ruolo (es. CEO, CFO, Contabile, Store Manager, Operatrice).",
        "steps": [
          "Clicca \"Nuovo utente\" per aprire il modulo di creazione",
          "Inserisci nome, cognome ed email (obbligatori) e scegli il ruolo",
          "Scegli a quali punti vendita l'utente può accedere, oppure lascia \"Tutti gli outlet\"",
          "Clicca \"Aggiungi\" per salvare, oppure \"Modifica\" (icona matita) su un utente esistente per aggiornarlo",
          "Per eliminare un utente clicca l'icona del cestino e conferma con il segno di spunta"
        ]
      },
      {
        "heading": "Voci di costo",
        "body": "Qui è raccolto il catalogo di tutte le voci di spesa dell'azienda, raggruppate per macro-gruppo (es. Locazione, Personale, Marketing). Ogni voce ha un codice, un nome, un importo annuo, il tipo (fisso o variabile, ricorrente o no) e i centri di costo (punti vendita) a cui è assegnata.",
        "steps": [
          "Usa la barra di ricerca o il filtro per centro di costo per trovare una voce specifica",
          "Clicca su un gruppo (es. \"Locazione\") per espanderlo e vedere le voci al suo interno, con il totale del gruppo",
          "Clicca \"Nuova voce\" per crearne una: servono almeno codice e nome",
          "Puoi assegnare la voce a uno o più centri di costo, oppure a \"Tutti gli outlet\"",
          "Puoi anche indicare che una voce è un sottoconto di un'altra, per creare una struttura gerarchica",
          "Usa l'icona matita per modificare una voce esistente o il cestino per eliminarla (con conferma)"
        ]
      },
      {
        "heading": "Centri di costo",
        "body": "I centri di costo rappresentano i punti vendita, la sede o il magazzino: sono le entità a cui vengono assegnate le voci di spesa. Qui puoi creare, modificare o eliminare un centro di costo, assegnandogli un codice, un'etichetta descrittiva e un colore identificativo.",
        "steps": [
          "Clicca \"Nuovo centro\" per crearne uno nuovo",
          "Inserisci il codice (es. VDC) e l'etichetta (es. \"Punto vendita Centro\")",
          "Scegli un colore per riconoscerlo facilmente nelle altre pagine",
          "Salva con \"Aggiungi\", oppure modifica/elimina un centro esistente passando sopra la riga con il mouse"
        ]
      },
      {
        "heading": "Fatturazione SDI",
        "body": "Questa sezione mostra lo stato dell'accreditamento al Sistema di Interscambio (SDI) per l'invio delle fatture elettroniche: se è attivo, se si è in ambiente di Test o Produzione, il codice SDI, la PEC di ricezione e lo stato dei certificati di sicurezza.",
        "steps": [
          "Clicca \"Test connessione\" per verificare che il collegamento con il Sistema di Interscambio funzioni",
          "Puoi aggiornare il Codice SDI o la PEC ricezione scrivendo direttamente nel campo: il salvataggio avviene appena esci dal campo",
          "L'interruttore \"Ambiente\" permette di passare tra Test e Produzione: in Test le fatture vengono validate ma non inviate davvero, in Produzione vengono trasmesse realmente",
          "I certificati di sicurezza sono gestiti in modo protetto e non sono mai visibili per esteso in pagina"
        ]
      }
    ],
    "faq": [
      {
        "q": "Perché non vedo tutte le sezioni?",
        "a": "L'accesso alle sezioni di Impostazioni dipende dal ruolo assegnato al tuo utente. Se una sezione ha il lucchetto e appare più chiara, il tuo ruolo non è abilitato a vederla o modificarla: contatta un amministratore."
      },
      {
        "q": "Cosa succede se passo l'ambiente SDI da Test a Produzione?",
        "a": "In Produzione le fatture elettroniche vengono inviate realmente al Sistema di Interscambio dell'Agenzia delle Entrate. In Test vengono solo validate senza essere trasmesse ai destinatari. Cambia questa impostazione solo se sei sicuro, perché ha un impatto reale sull'invio delle fatture."
      },
      {
        "q": "Posso assegnare una voce di costo a più punti vendita contemporaneamente?",
        "a": "Sì, nella sezione Voci di costo puoi selezionare più centri di costo per la stessa voce, oppure scegliere \"Tutti gli outlet\" se riguarda l'intera azienda."
      },
      {
        "q": "Come faccio a togliere l'accesso a un utente che non lavora più con noi?",
        "a": "Puoi eliminarlo dalla sezione Utenti con l'icona del cestino, oppure modificarlo e disattivare la spunta \"Utente attivo\" se preferisci mantenere lo storico senza dargli accesso."
      }
    ]
  },
  {
    "path": "/report-sincronizzazioni",
    "icon": "DatabaseZap",
    "title": "Report Sincronizzazioni",
    "description": "Questa pagina mostra lo stato e lo storico degli aggiornamenti automatici dei dati che arrivano da fonti esterne: conti bancari, fatture passive, corrispettivi e Cassetto Fiscale. Serve a capire a colpo d'occhio se tutto funziona regolarmente oppure se qualcosa è fermo da controllare.",
    "sections": [
      {
        "heading": "A cosa serve questa pagina",
        "body": "I dati di banche, fatture fornitori e Cassetto Fiscale non vengono caricati a mano ogni volta: il sistema li scarica automaticamente in modo periodico. Questa pagina è il registro di tutte queste sincronizzazioni automatiche (e di quelle avviate manualmente), così da avere sempre la prova di quando è stato fatto l'ultimo aggiornamento e se è andato a buon fine."
      },
      {
        "heading": "Le card di riepilogo per ciascun canale",
        "body": "In alto ci sono quattro riquadri, uno per ogni canale (\"feed\") di sincronizzazione: Banche, Fatture passive, Corrispettivi e Cassetto Fiscale. Ogni riquadro mostra un pallino colorato e un'etichetta di stato:\n\n• \"Aggiornato\" (pallino scuro) — l'ultimo aggiornamento è recente e regolare.\n• \"In ritardo\" (pallino arancione) — l'ultimo aggiornamento riuscito è un po' più vecchio del previsto, oppure l'ultima esecuzione è stata completata con avvisi.\n• \"Fermo\" (pallino rosso) — l'ultima esecuzione è fallita, oppure non si aggiorna da troppo tempo.\n• \"Nessuna sincronizzazione\" (pallino grigio) — quel canale non ha ancora mai girato.\n\nBanche, Fatture passive e Corrispettivi si aggiornano automaticamente ogni 6 ore; il Cassetto Fiscale una volta al giorno. Il canale Corrispettivi risulta \"non ancora attivo\" finché non viene collegato. Passando il mouse sopra una card compare il dettaglio (data/ora dell'ultimo aggiornamento e, se presente, la descrizione dell'errore)."
      },
      {
        "heading": "La tabella dello storico delle esecuzioni",
        "body": "Sotto le card c'è una tabella con una riga per ogni sincronizzazione eseguita, dalla più recente. Le colonne sono: Data e ora, Feed (il canale interessato), Origine (Automatica o Manuale), Periodo (l'intervallo di dati controllato), Esito (OK, Parziale, Errore o Vuoto) e Scaricati (quanti documenti/movimenti sono arrivati in quella esecuzione). Per chi ha un profilo da consulente è visibile anche una colonna \"Errore\" con il dettaglio tecnico in caso di problema."
      },
      {
        "heading": "Il dettaglio: cosa è stato scaricato",
        "body": "Le righe con almeno un elemento scaricato (colonna \"Scaricati\" maggiore di zero) hanno una freccetta a sinistra e si possono espandere cliccandoci sopra, per vedere esattamente cosa è arrivato in quella sincronizzazione. Le righe con \"0\" non si aprono perché non c'era nulla di nuovo.\n\n• Per le Banche il dettaglio è organizzato per banca reale (es. BCC, Intesa, MPS): ogni banca ha una sua intestazione con il riepilogo (numero di conti, movimenti scaricati e saldo) e, subito sotto, l'elenco dei suoi movimenti (data, descrizione, importo). Così si vede a colpo d'occhio da quale banca proviene ciascun movimento. Ogni banca si può aprire o chiudere cliccando sulla sua intestazione (di default è aperta se ha movimenti, chiusa se non ne ha). Se i movimenti totali sono più di 500 ne vengono mostrati i primi 500.\n• Per le Fatture passive compare l'elenco delle fatture arrivate (numero, fornitore, data e importo).\n\nNota sullo storico: le sincronizzazioni più vecchie, precedenti all'attivazione di questo dettaglio, sono state ricostruite. Per queste righe il saldo per banca non viene mostrato (non sarebbe il saldo di quella data) e sono elencate solo le banche che in quella sincronizzazione hanno effettivamente portato movimenti. Dalle sincronizzazioni nuove in poi il dato è completo (tutte le banche collegate, anche con 0 movimenti nuovi, e il saldo reale del momento)."
      },
      {
        "heading": "Come usare i filtri",
        "body": "In alto sopra la tabella si possono filtrare i risultati per canale (\"Feed\"), oppure impostare un intervallo di date (\"Dal\" / \"Al\") per restringere lo storico a un periodo preciso. Il pulsante \"Azzera\" (visibile solo quando almeno un filtro è attivo) rimuove tutti i filtri e torna alla vista completa. Il pulsante \"Aggiorna\" in alto a destra ricarica i dati più recenti.",
        "steps": [
          "Selezionare un canale specifico dal menu \"Feed\", oppure lasciare \"Tutti i feed\"",
          "Impostare le date \"Dal\" e \"Al\" per limitare la ricerca a un periodo",
          "Cliccare \"Azzera\" per rimuovere i filtri e tornare alla vista completa",
          "Cliccare \"Aggiorna\" per ricaricare i dati aggiornati"
        ]
      }
    ],
    "faq": [
      {
        "q": "Cosa significa \"Esito: Vuoto\" su una riga della tabella?",
        "a": "Significa che quella sincronizzazione è andata a buon fine, ma quel giorno non c'erano nuovi documenti o movimenti da scaricare. È una situazione normale, non un errore."
      },
      {
        "q": "Cosa devo fare se una card mostra il pallino rosso \"Fermo\"?",
        "a": "Indica che quel canale non si aggiorna da troppo tempo o che l'ultima esecuzione è fallita. Conviene segnalarlo a chi segue la parte tecnica del gestionale, eventualmente riportando l'orario dell'ultimo aggiornamento riuscito mostrato nella card."
      },
      {
        "q": "Perché non vedo la colonna \"Errore\" nella tabella?",
        "a": "La colonna con il dettaglio tecnico dell'errore è visibile solo per i profili con ruolo di consulente (super advisor, CFO, contabile). Gli altri utenti vedono comunque tutte le altre colonne, incluso l'esito generale."
      },
      {
        "q": "Ogni quanto si aggiornano automaticamente i dati?",
        "a": "Banche, Fatture passive e Corrispettivi ogni 6 ore; il Cassetto Fiscale una volta al giorno. Il canale Corrispettivi al momento risulta non ancora attivo."
      },
      {
        "q": "Posso avviare io una sincronizzazione manuale da questa pagina?",
        "a": "No: questa pagina mostra solo lo storico e lo stato delle sincronizzazioni già avvenute (automatiche o manuali), non permette di avviarne una nuova."
      },
      {
        "q": "Come vedo cosa è stato scaricato in una sincronizzazione?",
        "a": "Clicca sulla riga (quelle con \"Scaricati\" maggiore di zero hanno una freccetta a sinistra): si apre il dettaglio. Per le banche vedi il riepilogo per banca e l'elenco dei singoli movimenti; per le fatture passive l'elenco delle fatture arrivate."
      },
      {
        "q": "Perché su alcune righe delle banche non vedo il saldo?",
        "a": "Sono sincronizzazioni più vecchie, ricostruite dopo l'attivazione del dettaglio: per quelle non è disponibile il saldo di quella specifica data (esiste solo il saldo attuale del conto), quindi viene lasciato vuoto per non mostrare un valore fuorviante. Dalle sincronizzazioni nuove in poi il saldo mostrato è quello reale al momento dell'aggiornamento."
      },
      {
        "q": "Perché a volte nel dettaglio compare una sola banca?",
        "a": "Perché l'elenco \"Per banca\" mostra solo le banche che in quella specifica sincronizzazione hanno portato movimenti nuovi. Se in quella esecuzione i movimenti nuovi arrivavano da un solo conto, vedrai una sola banca; è normale e corretto."
      }
    ]
  },
  {
    "path": "/profilo",
    "icon": "UserCircle",
    "title": "Il tuo profilo",
    "description": "Nella pagina Profilo puoi aggiornare i tuoi dati personali (nome e cognome) e cambiare la tua password di accesso. Per i dati dell'azienda vai invece nella pagina Impostazioni.",
    "sections": [
      {
        "heading": "Dati personali",
        "body": "In questo primo riquadro puoi modificare il tuo nome e cognome. L'indirizzo email che usi per accedere è mostrato ma non è modificabile da qui: se hai bisogno di cambiarla, devi contattare il supporto.",
        "steps": [
          "Modifica il campo Nome e/o il campo Cognome",
          "Il pulsante \"Salva modifiche\" si attiva solo se hai effettivamente cambiato qualcosa",
          "Clicca \"Salva modifiche\" per confermare: comparirà un messaggio di conferma in alto a destra"
        ]
      },
      {
        "heading": "Cambiare la password",
        "body": "Nel secondo riquadro puoi impostare una nuova password di accesso. Devi digitarla due volte per sicurezza: una nel campo \"Nuova password\" e una in \"Conferma nuova password\". La password deve avere almeno 8 caratteri.",
        "steps": [
          "Scrivi la nuova password nel campo \"Nuova password\" (minimo 8 caratteri)",
          "Ripeti la stessa password nel campo \"Conferma nuova password\"",
          "Puoi cliccare sull'icona a forma di occhio per vedere cosa hai scritto e controllare che sia corretto",
          "Se le due password non coincidono, il sistema te lo segnala subito con un avviso rosso",
          "Clicca \"Aggiorna password\": al prossimo accesso dovrai usare la nuova password"
        ]
      }
    ],
    "faq": [
      {
        "q": "Posso cambiare la mia email da questa pagina?",
        "a": "No. Il campo email è visibile ma bloccato. Se hai bisogno di cambiarla, contatta il supporto: richiede una verifica speciale che al momento non è disponibile direttamente in questa pagina."
      },
      {
        "q": "Perché il pulsante \"Salva modifiche\" dei dati personali è disattivato?",
        "a": "Il pulsante si attiva solo quando hai realmente cambiato nome o cognome rispetto ai dati salvati. Se non hai modificato nulla, resta disabilitato."
      },
      {
        "q": "Cosa devo fare se dimentico la nuova password appena impostata?",
        "a": "Dovrai richiedere l'assistenza del supporto per reimpostarla, perché la password non è visibile a nessuno una volta salvata."
      },
      {
        "q": "La nuova password deve rispettare regole particolari?",
        "a": "L'unico requisito richiesto dalla pagina è la lunghezza minima di 8 caratteri e che le due password inserite coincidano tra loro."
      }
    ]
  },
  {
    "path": "/ticket",
    "icon": "FileText",
    "title": "Ticket & Segnalazioni",
    "description": "In questa pagina puoi segnalare un problema (bug) o richiedere una nuova funzione del gestionale. Ogni segnalazione viene seguita nel tempo e, quando possibile, risolta automaticamente da un assistente AI che lavora in background.",
    "sections": [
      {
        "heading": "Cosa vedi arrivando nella pagina",
        "body": "In alto trovi delle schede con i numeri riassuntivi: quante segnalazioni sono aperte, in corso, risolte, chiuse, quanti sono bug, quante sono richieste di nuove funzioni e il totale. Sotto trovi un avviso che indica a che ora è previsto il prossimo controllo automatico delle segnalazioni (l'AutoFix), con un conto alla rovescia."
      },
      {
        "heading": "Aprire una nuova segnalazione",
        "body": "Per segnalare un problema o proporre una nuova funzione, usa il pulsante \"Apri ticket\" in alto a destra. Si apre un modulo dove indicare il tipo, il modulo del gestionale coinvolto, un titolo, una descrizione facoltativa, la priorità ed eventuali allegati.",
        "steps": [
          "Clicca su \"Apri ticket\"",
          "Scegli il tipo: \"Bug\" se qualcosa non funziona, oppure \"Nuova funzione\" se vuoi proporre un miglioramento",
          "Seleziona il Modulo del gestionale a cui si riferisce la segnalazione (es. Banche, Fatturazione, Scadenzario...)",
          "Scrivi un titolo breve e chiaro (obbligatorio, almeno 3 caratteri), ad esempio \"il pulsante Salva non si vede in Banche\"",
          "Se vuoi, aggiungi una descrizione più dettagliata di cosa è successo o cosa vorresti",
          "Scegli la priorità: Basso, Medio o Alto",
          "Se utile, allega uno o più file: puoi trascinarli nell'area apposita, cliccare per selezionarli dal computer, oppure incollare direttamente uno screenshot con Ctrl+V (o Cmd+V su Mac). Sono accettati immagini e PDF fino a 10 MB ciascuno",
          "Clicca \"Apri segnalazione\" per inviarla"
        ]
      },
      {
        "heading": "Filtrare e cercare le segnalazioni",
        "body": "Sopra la tabella trovi delle pillole per filtrare per stato (\"Da lavorare\" mostra di default solo quelle aperte o in corso, oppure puoi scegliere In attesa, In corso, Risolto, Chiuso o Tutti) e per tipo (Bug o Funzioni). C'è anche un menu a tendina per filtrare per modulo del gestionale."
      },
      {
        "heading": "Aprire il dettaglio di una segnalazione",
        "body": "Clicca su una riga della tabella per aprire il dettaglio completo: titolo, descrizione, allegati, stato di avanzamento, e la sezione commenti dove puoi leggere gli aggiornamenti e scriverne di nuovi."
      },
      {
        "heading": "Capire lo stato di avanzamento",
        "body": "Ogni segnalazione passa attraverso queste fasi, mostrate con un percorso a pallini: \"In attesa\" (appena aperta, nessuno l'ha ancora presa in carico), \"In corso\" (qualcuno ci sta lavorando), \"Risolto\" (il problema è stato sistemato). Una segnalazione può anche essere \"Chiusa\", cioè archiviata senza ulteriori lavorazioni.",
        "steps": [
          "Dalla lista, se il tuo ticket è ancora \"In attesa\" o \"In corso\", significa che deve ancora essere lavorato",
          "Se lo stato è \"Risolto\", il problema dovrebbe essere sistemato: verifica e, se serve, scrivi un commento",
          "Se non sei soddisfatto della risoluzione, puoi riaprire la segnalazione (vedi sotto)"
        ]
      },
      {
        "heading": "Come funziona la risposta automatica dell'AI (AutoFix)",
        "body": "Ogni ora, a un orario fisso indicato nel banner in alto alla pagina, un sistema automatico (AutoFix) controlla le segnalazioni aperte, analizza quelle più semplici e, quando riesce, propone e applica una correzione al codice. Quando questo succede, trovi un commento con l'icona del robot nella sezione Commenti del ticket, che ti spiega cosa è stato fatto. Se l'AI non riesce a risolvere automaticamente il problema, lascia comunque un commento per spiegare la situazione, così sai che qualcuno dovrà occuparsene manualmente."
      },
      {
        "heading": "Scrivere un commento",
        "body": "Nella sezione Commenti del dettaglio ticket puoi aggiungere tu stessa un messaggio, ad esempio per dare più dettagli o segnalare che il problema persiste.",
        "steps": [
          "Apri il dettaglio del ticket",
          "Scrivi il tuo messaggio nel campo in fondo alla sezione Commenti",
          "Clicca \"Invia\" per pubblicarlo"
        ]
      },
      {
        "heading": "Le azioni disponibili su un ticket",
        "body": "A seconda dello stato attuale, nel dettaglio del ticket trovi diversi pulsanti di azione: \"Prendi in carico\" (passa da In attesa a In corso), \"Risolvi\" (segna come risolto), \"Riapri\" (torna in attesa se il problema non era davvero sistemato) e \"Chiudi\" (archivia la segnalazione, chiedendo conferma perché una volta chiusa non viene più seguita dall'AutoFix)."
      }
    ],
    "faq": [
      {
        "q": "Devo per forza allegare uno screenshot?",
        "a": "No, l'allegato è facoltativo. Aiuta però chi legge la segnalazione a capire subito il problema. Puoi incollare uno screenshot direttamente con Ctrl+V oppure trascinare un file nell'area apposita."
      },
      {
        "q": "Quanto tempo ci vuole prima che qualcuno veda la mia segnalazione?",
        "a": "Un controllo automatico (AutoFix) passa in rassegna le segnalazioni aperte ogni ora, all'orario mostrato nel banner in alto alla pagina. Le segnalazioni più semplici possono essere risolte direttamente dall'AI in quel momento."
      },
      {
        "q": "Come faccio a sapere se la mia segnalazione è stata risolta?",
        "a": "Controlla lo stato nella lista o nel dettaglio del ticket: se è \"Risolto\" il problema dovrebbe essere sistemato. Troverai anche un commento (spesso con l'icona del robot se è stato l'AutoFix) che spiega cosa è stato fatto."
      },
      {
        "q": "Posso modificare o cancellare una segnalazione dopo averla inviata?",
        "a": "Dal dettaglio puoi aggiungere commenti e cambiare lo stato (ad esempio riaprirla o chiuderla), ma non modificare il testo originale. La cancellazione definitiva è riservata agli amministratori."
      }
    ]
  },
  {
    "path": "/ticket/admin",
    "icon": "FileText",
    "title": "Cruscotto Admin — Ticket & Segnalazioni",
    "description": "Questa è la vista riservata agli amministratori per gestire in modo più veloce tutte le segnalazioni: selezionare più ticket insieme, chiedere all'AI di risolverli subito, chiuderli senza lavorarli, importarli o esportarli. È accessibile solo a chi ha il ruolo di amministratore (super_advisor).",
    "sections": [
      {
        "heading": "Accesso riservato",
        "body": "Questa pagina è visibile solo a chi ha il ruolo di amministratore. Se non hai i permessi, vedrai un messaggio di \"Accesso riservato\" con un pulsante per tornare alla vista normale delle segnalazioni (\"Ticket & Segnalazioni\")."
      },
      {
        "heading": "La barra in alto",
        "body": "Sotto il titolo trovi una barra azzurra con un pulsante per tornare alla vista operatore, l'indicazione \"Modalità Admin\" e, se presenti, un avviso con il numero di ticket \"fermi\" cioè segnalazioni aperte o in corso da almeno 3 giorni senza essere risolte."
      },
      {
        "heading": "La lista dei ticket con selezione multipla",
        "body": "La tabella è la stessa che vedono anche le operatrici, ma qui ogni riga ha una casella di selezione. Puoi selezionare uno o più ticket insieme (anche tutti con il pulsante in testa alla colonna) per applicare un'azione a tutti contemporaneamente.",
        "steps": [
          "Spunta la casella sulle righe dei ticket che vuoi gestire insieme",
          "Oppure clicca l'icona in testa alla colonna per selezionarli tutti quelli visibili con i filtri attuali",
          "Appena selezioni almeno un ticket, comparirà una barra di azioni sopra la tabella"
        ]
      },
      {
        "heading": "Le azioni sui ticket selezionati",
        "body": "Nella barra che appare quando hai una selezione attiva trovi questi pulsanti: \"Prendi in carico\" (porta i ticket selezionati allo stato In corso), \"Risolvi con AI\" (chiede all'assistente AI di analizzare e provare a correggere i ticket selezionati), \"Chiudi senza lavorare\" (chiude direttamente i ticket senza passare dalle fasi normali), \"Riapri\" (li riporta in stato In attesa) e \"Cancella\" (li elimina definitivamente, con richiesta di conferma).",
        "steps": [
          "Seleziona i ticket su cui vuoi agire",
          "Scegli l'azione desiderata dalla barra che appare sopra la tabella",
          "Per \"Cancella\" ti verrà chiesta una conferma esplicita perché l'operazione non è reversibile",
          "Per \"Chiudi senza lavorare\" si apre una finestra dove puoi scrivere il motivo della chiusura (facoltativo) prima di confermare"
        ]
      },
      {
        "heading": "Il pulsante \"Risolvi con AI\" nel dettaglio di un singolo ticket",
        "body": "Aprendo il dettaglio di una singola segnalazione (stato In attesa o In corso), come amministratore vedi anche qui il pulsante \"Risolvi con AI\": invoca subito l'assistente che analizza il ticket e prova a risolverlo, senza dover aspettare il controllo automatico orario. Se lo hai appena usato, il pulsante resta temporaneamente disattivato per un minuto per evitare richieste doppie.",
        "steps": [
          "Apri il dettaglio del ticket che vuoi far analizzare subito dall'AI",
          "Clicca \"Risolvi con AI\"",
          "Attendi la risposta: se l'AI riesce a proporre una correzione te lo comunica; se non può risolverlo automaticamente, lascia un commento che lo spiega",
          "Il ticket si aggiorna automaticamente con l'esito e gli eventuali nuovi commenti"
        ]
      },
      {
        "heading": "Importare ed esportare segnalazioni",
        "body": "In alto a destra nella lista trovi due pulsanti aggiuntivi rispetto alla vista normale: \"Importa\" per caricare più segnalazioni insieme da un file CSV o Excel (con le colonne titolo, descrizione, modulo, priorità e tipo), ed \"Esporta CSV\" per scaricare l'elenco completo dei ticket in un file.",
        "steps": [
          "Per importare, clicca \"Importa\" e scegli il file CSV o Excel dal computer",
          "Il sistema mostra un'anteprima con le righe valide e quelle con errori (che verranno saltate)",
          "Controlla l'anteprima e clicca \"Importa\" per confermare il caricamento",
          "Per esportare, clicca \"Esporta CSV\": viene scaricato automaticamente un file con tutte le segnalazioni"
        ]
      },
      {
        "heading": "Timeline degli ultimi commenti AutoFix",
        "body": "In fondo alla pagina, se ci sono stati interventi automatici recenti, trovi un elenco degli ultimi commenti lasciati dall'AI sui vari ticket, con la data e il titolo della segnalazione a cui si riferiscono. Cliccando su una voce si apre direttamente il ticket corrispondente."
      }
    ],
    "faq": [
      {
        "q": "Qual è la differenza tra questa pagina e \"Ticket & Segnalazioni\"?",
        "a": "La lista dei ticket è la stessa, ma qui in più puoi selezionare più ticket insieme e agire su tutti contemporaneamente, importare/esportare in blocco e vedere le informazioni riservate agli amministratori (ticket fermi, timeline AutoFix)."
      },
      {
        "q": "Cosa significa \"Chiudi senza lavorare\"?",
        "a": "È un modo per chiudere subito uno o più ticket senza farli passare dalle fasi normali (In corso, Risolto). Va usato per segnalazioni duplicate, non riproducibili, fuori tema o già risolte in altro modo. Una volta chiusi, l'AutoFix non li considera più."
      },
      {
        "q": "Cosa vuol dire \"ticket fermi\"?",
        "a": "Sono le segnalazioni ancora aperte o in corso da almeno 3 giorni senza essere state risolte. Il numero viene mostrato nella barra in alto per aiutarti a individuare subito cosa richiede attenzione."
      },
      {
        "q": "Se cancello un ticket per sbaglio, posso recuperarlo?",
        "a": "No, la cancellazione è definitiva e irreversibile: per questo il sistema chiede sempre una conferma esplicita prima di procedere, sia per un singolo ticket che per una selezione multipla."
      }
    ]
  }
]
