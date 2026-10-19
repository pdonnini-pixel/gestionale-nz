# Organico di oggi, turni e piano ferie: note di dominio

Da leggere prima di toccare le schede «Organico di oggi» e «Turni» di Dipendenti, il «Piano ferie»,
le tabelle `employee_events`, `outlet_opening_hours`, `outlet_staffing_needs`, `outlet_special_days`,
`outlet_shift_rules`, `shifts`, o le librerie `src/lib/organico.ts` e `src/lib/turni.ts`.
Fissato il 19/10/2026 (richiesta di Patrizio, migration 315).

## Il principio

L'anagrafica dei dipendenti è la fotografia dell'ultimo documento dello studio paghe e resta il dato
vero (regola «documenti dello studio paghe = dato vero», CLAUDE.md). Fra un documento e l'altro chi
tiene l'organico **segna i cambiamenti** (`employee_events`): maternità, proroga, non rinnovo,
licenziamento o dimissioni, cambio d'orario o di negozio, passaggio a indeterminato, rientro,
assunzione. **La scheda della persona non si modifica**: l'organico di una data è la scheda più i
cambiamenti fino a quella data (`personaAllaData` in `organico.ts`, funzione pura e testata).

Da non confondere con l'organico «granitico» di `headcount.ts`: quello conta chi ha un cedolino in un
mese ed è la fonte dei costi e dei confronti fra negozi. Questo dice chi c'è oggi e serve a turni,
ferie e decisioni. Nessuno dei due sostituisce l'altro.

## Chi può fare cosa

- Segnare cambiamenti, aggiungere persone, orari dei negozi, giorni speciali, regole e turni:
  **profili contabilità o superiori** (`super_advisor`, `ceo`, `cfo`, `coo`, `contabile`), funzione
  `organico_puo_scrivere()`. Per questo la voce Dipendenti del menu è aperta anche a `ceo` e `cfo`.
- **Fabbisogno** (persone per fascia) e persone in più dei giorni speciali: **solo Patrizio**
  (`super_advisor`), funzione `organico_puo_decidere_fabbisogno()` e trigger sui giorni speciali.
- Una persona nuova passa da `organico_nuova_persona()` (RPC con controllo del ruolo): la policy di
  `employees` resta com'era (scrivono solo super_advisor e contabile).

Verificato il 19/10/2026 su NZ con i profili veri, in una transazione annullata: Veronica (contabile)
segna cambiamenti, orari e persone nuove ma non il fabbisogno; Denise (viewer) legge e non scrive;
Patrizio scrive il fabbisogno.

## Niente si cancella

- Un cambiamento non si cancella (trigger): si annulla, `stato = annullato`, con il motivo.
- Un turno messo a mano o pubblicato non si cancella (trigger): si annulla con il motivo. Si cancellano
  solo le **proposte del sistema in bozza**, che il ricalcolo rifà.
- Segnando un'assenza o un'uscita, i turni dopo quella data si tolgono con la stessa regola. Le ferie
  già approvate non si toccano: la modale avvisa che vanno ritirate dalla richiesta.

## Il confronto con lo studio

`organico_riconcilia()` (chiamata all'apertura della scheda) chiude da sola i cambiamenti che
l'anagrafica, aggiornata dai documenti dello studio, riporta uguali: ore, scadenza, cessazione,
indeterminato, negozio. Un'assunzione si chiude con il primo cedolino. **Assenze lunghe e rientri non
compaiono in nessun documento letto dal gestionale**: si confermano a mano («Lo studio l'ha
registrato»). Quando lo studio dice altro, «Vale lo studio» annulla il cambiamento.

Sotto c'è l'ultimo mese di cedolini contro l'organico (`confrontaConCedolini`): chi è pagato ma fuori
organico, chi è in organico tutto il mese senza busta. Chi entra o esce nel mese e chi è assente non
sono anomalie. Le ore pianificate nei turni **non** si confrontano con le ore pagate: i cedolini letti
dal gestionale non portano le ore. Se un giorno lo studio manda le ore lavorate (o si legge il file
presenze di People Smart), il confronto si aggiunge lì.

## La proposta dei turni (`turni.ts`)

Regola semplice e leggibile, non un ottimizzatore:
1. per ogni mezz'ora servono le persone del fabbisogno (fasce del giorno tipo, giorno speciale che
   vince, persone in più sommate);
2. si copre prima il buco più grande, dando il turno a chi ha la quota più alta di ore di contratto
   ancora libere; la lunghezza del turno è quella giusta per le ore di contratto della persona (fra il
   minimo e il massimo delle regole), con la pausa oltre la soglia;
3. le ore di contratto che avanzano vanno nei giorni e nelle fasce dove serve di più;
4. quello che non si riesce a coprire si dice (scoperture), senza inventare persone.

Mai oltre le ore di contratto, un turno al giorno, mai oltre i giorni di lavoro consentiti. Chi è
assente, scaduto, non ancora assunto, in un altro negozio o in ferie approvate a giornata intera quel
giorno non è disponibile. I contratti a chiamata (nessun orario fisso) restano fuori dalla proposta.

Un caso utile da ricordare (test): 2 persone dalle 10 alle 20 con turni da 8 ore più la pausa
richiedono 4 turni al giorno (due aprono, due chiudono). Quattro persone a 40 ore non bastano anche se
le ore totali sì: la proposta usa comunque tutte le loro ore e dice dove manca qualcuno.

## Il piano ferie

Saldi dal tabulato dello studio (`v_leave_disponibilita`, vedi `PIANO_FERIE_NOTES.md`): il gestionale
non ricalcola la maturazione. In più incrocia ferie chieste e approvate con il fabbisogno del negozio e
dice i giorni in cui resterebbero meno persone di quelle che servono.

## Applicazione sui tenant

La migration 315 è stata applicata via connettore su NZ, Made e Zago a blocchi e **senza le righe
`DROP ... IF EXISTS`**: il connettore chiede conferma per ogni `DROP` o `DELETE` (anche dentro il
testo di una funzione) e va in timeout. Per le prossime migration: niente `DROP` nelle tabelle nuove,
blocchi piccoli.
