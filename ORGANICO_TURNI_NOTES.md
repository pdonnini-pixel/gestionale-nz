# Organico di oggi, turni e piano ferie: note di dominio

> **Regole granitiche (CLAUDE.md, 20/10/2026)**: il fabbisogno viene SEMPRE dal traffico MODA e dalle persone che ci sono, anche nelle simulazioni e nelle misure fatte in sessione; il turno minimo nella giornata e' di 4 ore e si cambia solo nelle «Regole dei turni» del negozio.

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
- **Fabbisogno** (persone per fascia) e persone in più dei giorni speciali: **solo il profilo Super Advisor** (su NZ Patrizio e Lilian, che deve avere le stesse facoltà: Patrizio 19/10/2026)
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
   ancora libere; la lunghezza del turno è quella giusta per le ore di contratto della persona (fino al
   massimo delle regole; il turno minimo non è una regola, Patrizio 19/10/2026: vincola e basta.
   Resta solo il limite tecnico di un'ora), con la pausa: 30 minuti da 6 ore lavorate e un'ora da 8 dal 21/10/2026 (migration 325), in aggiunta alle ore (Patrizio
   20/10/2026: «6 + 30 minuti e 8 + 30 minuti e non -», migration 318; la 317 del 19/10 prevedeva
   un'ora da 8); se il turno con la pausa non sta nella
   giornata si accorcia di mezz'ora alla volta;
3. le ore di contratto che avanzano vanno nei giorni e nelle fasce dove serve di più;
4. quello che non si riesce a coprire si dice (scoperture), senza inventare persone.

Mai oltre le ore di contratto, un turno al giorno, mai oltre i giorni di lavoro consentiti. Chi è
assente, scaduto, non ancora assunto, in un altro negozio o in ferie approvate a giornata intera quel
giorno non è disponibile. I contratti a chiamata (nessun orario fisso) restano fuori dalla proposta.

Un caso utile da ricordare (test): 2 persone dalle 10 alle 20 con turni da 8 ore più la mezz'ora di pausa
richiedono 4 turni al giorno (due aprono, due chiudono). Quattro persone a 40 ore non bastano anche se
le ore totali sì: la proposta usa comunque tutte le loro ore e dice dove manca qualcuno.

## Rinnovi e trasformazioni con orario diverso (migration 316)

Una proroga o un passaggio a indeterminato possono portare più o meno ore: il cambiamento porta
`ore_settimanali`, che valgono dal suo `data_dal` (la nuova scadenza invece vale subito). Si scrive
solo se diversa dalle ore di oggi. `organico_riconcilia` chiude la proroga (o la trasformazione) solo
quando l'anagrafica riporta anche le ore.

## Orari e fabbisogno stimati dai dati (migration 316, `stimaNegozio.ts`)

Per non partire da pagine vuote. Fonti misurate il 19/10/2026 sulle chiusure di cassa di NZ da
settembre: la cassa si conferma a fine giornata, alle 20 quasi ovunque e alle 21 a Valmontone il
sabato e la domenica; l'incasso del weekend è 3-5 volte quello dei feriali.
- Chiusura = mediana dell'ora di conferma (ora di Roma), arrotondata alla mezz'ora prima.
- Apertura = 10:00 standard: **nessun dato la registra**, e la spiegazione lo dice.
- Persone = ore di contratto del negozio distribuite sui giorni con peso √incasso medio, per difetto,
  almeno una, e mai più di metà delle persone in servizio se la giornata è più lunga di un turno
  (8 ore + mezz'ora di pausa): per avere k persone tutto il giorno servono k che aprono e k che chiudono.
- Si salva con `origine = 'stima'`; il salvataggio da una persona la rende `manuale`. Lo stimato è
  azzurro in pagina. La stima di massa scrive solo nei negozi senza dati e salta quelli senza chiusure
  di cassa (sede, Roma prima dell'apertura).

Prova a secco del 19/10/2026 su NZ (organico di oggi, settimana tipo): con la stima la proposta dei
turni copre tutto in Valdichiana, Palmanova, Franciacorta, Barberino, Torino e Brugnato; a Valmontone
resta scoperta l'ultima ora del weekend (20-21). Sede e Roma non hanno chiusure: si inseriscono a mano.

## Il piano ferie

Saldi dal tabulato dello studio (`v_leave_disponibilita`, vedi `PIANO_FERIE_NOTES.md`): il gestionale
non ricalcola la maturazione. In più incrocia ferie chieste e approvate con il fabbisogno del negozio e
dice i giorni in cui resterebbero meno persone di quelle che servono.

## Applicazione sui tenant

La migration 315 è stata applicata via connettore su NZ, Made e Zago a blocchi e **senza le righe
`DROP ... IF EXISTS`**: il connettore chiede conferma per ogni `DROP` o `DELETE` (anche dentro il
testo di una funzione) e va in timeout. Per le prossime migration: niente `DROP` nelle tabelle nuove,
blocchi piccoli.

## Specifica della fase 2 (decisa da Patrizio il 19/10/2026, non ancora costruita)

Nata dal confronto con il documento di Lilian «Turni outlet New Zago: specifiche per il gestionale»
(19/10/2026) e dalle risposte di Patrizio dello stesso giorno. Qui c'è **cosa** deve fare il gestionale;
il codice non c'è ancora. Prima di costruire un pezzo, rileggere questa sezione.

### L'obiettivo

Le ore di contratto si pagano comunque. Ogni settimana, per ogni persona:
**ore di contratto = ore lavorate + ferie e permessi goduti + festività.**
Ottimizzare vuol dire mettere le ore lavorate dove il negozio ne ha bisogno; le ore che avanzano nei
periodi tranquilli diventano ferie e permessi. Nei picchi niente ferie, e dove le persone non bastano
il gestionale lo dice.

### Orizzonte e ritmo

- Calendari per **tutti i negozi fino al 31/12/2027** (Forte dei Marmi escluso: non è un negozio NZ).
- La pianificazione è **mensile**, ma l'operatore deve poter generare o rigenerare i turni di qualunque
  periodo **in qualsiasi momento**. Turni messi a mano e pubblicati restano protetti, come oggi.
- Due livelli di calcolo: un piano settimanale di capacità (ore necessarie, ore di contratto, settimane
  di ferie, rinforzi) per tutto l'orizzonte, e i turni giorno per giorno generati come bozza e
  ricalcolati quando cambia organico, fabbisogno o ferie.

### Il calendario dei giorni

Per ogni negozio e giorno: aperto o chiuso, orario, tipo di giorno (feriale, sabato, domenica con la
stagione del mese; festivo aperto; giorno di punta; chiusura). Festività 2027: 01/01, 06/01, Pasqua
28/03 e Pasquetta 29/03, 25/04, 01/05, 02/06, 15/08, 01/11, 08/12, 25-26/12. Punte da Lilian: weekend
del Black Friday (2027: venerdì 26/11), 8/12, Ognissanti, feriali fra Natale e Capodanno, eventi dei
village, avvio dei saldi. Date dei saldi per regione ed eventi vanno confermati: fino ad allora sono
ipotesi e lo dicono.

### Il fabbisogno

- Fonte principale: il **report MODA «Conversion Rate»** (ingressi, scontrini, valore per ora). Va
  costruita la zona di caricamento (regola fissa dei caricamenti). Per fascia: ingressi medi diviso la
  soglia di affollamento del negozio (ingressi per addetto all'ora oltre cui la conversione cala),
  arrotondato, almeno una persona. Profilo per tipo di giorno e mese; i giorni di punta prendono gli
  ingressi dello stesso giorno dell'anno prima. Soglia ricalcolata ogni mese.
- Ordine delle fonti: decisione della direzione > MODA > stima dagli incassi > standard.
- Si salva il fabbisogno **vero** (codice S di Lilian), non quello ridotto alle ore disponibili (A): lo
  scoperto si mostra, non si nasconde.
- **Chi è in pausa non conta come presente**: la copertura deve reggere con le pause sfalsate. **Fatto
  il 20/10/2026**: `collocaPause()` in `turni.ts` mette ogni pausa dopo almeno due ore di lavoro e prima
  delle ultime due, nella mezz'ora in cui toglie meno rispetto al fabbisogno; `copertura()` sottrae chi
  è in pausa, la proposta ricalcola le pause a ogni turno aggiunto, la pagina mostra la pausa con inizio e fine («pausa 13:00-13:30»).
  Le pause non si salvano: sono deterministiche e si ricalcolano dai turni.
- Servono: fabbisogno per periodo (oggi una sola settimana tipo) e giorni speciali con le proprie fasce
  (oggi solo «persone in più» su tutta la giornata).
- Roma non ha storia: parte dal profilo di un negozio simile.
- **Caricati su NZ il 20/10/2026** (solo dati, nessuno schema): orari 10-20 di tutti i giorni e
  fabbisogno della settimana tipo di ottobre-novembre per Brugnato, Valmontone, Barberino, Palmanova,
  Franciacorta, più la proposta di settembre per Valdichiana e Torino; `origine = 'stima'` finché la
  direzione non conferma. Numeri S di Lilian; dove esiste solo il numero A (feriali lun-gio e sabato di
  Barberino) si è usato quello. Brugnato feriali: la S (2 persone 13-17), non la A (14-16). Giorni
  speciali: 25/12 e 01/01 chiusi ovunque, 26/12 chiusi Brugnato e Barberino, 24 e 31/12 chiusura alle
  18 a Valmontone, Barberino, Palmanova, Franciacorta. Valmontone nel weekend resta 10-20 come nel
  documento, anche se cassa e ingressi dicono 21: da confermare. Sede e Roma senza orari.

### I turni

- **La durata del turno segue le ore settimanali disponibili** della persona (nessun menu fisso di
  durate; le 7 ore sono ammesse). Massimo 8 ore lavorate, un turno al giorno, pause 30' da 6 ore e
  un'ora da 8, nessun turno minimo (resta il limite tecnico di un'ora).
- Vincoli da aggiungere: massimo giorni lavorati per persona, «solo sabato e domenica», persona che
  lavora in più negozi (Elisa Manescalchi un giorno a settimana fuori Barberino), massimo 6 giorni
  consecutivi a cavallo fra due settimane, rotazione equa di sabati e domeniche liberi.
- **Rinforzi nei picchi**: prima con il personale **dello stesso negozio** (spostando ore fra le sue
  persone), poi straordinari. **Niente prestiti fra negozi**: sono troppo lontani fra loro (Patrizio,
  19/10/2026). Le persone a chiamata sono riserva, non base.
- **Ripiego in uso dal 20/10/2026** (`proponiSettimana`): le ore si dividono sui giorni in proporzione al
  fabbisogno (turni lunghi nel weekend, corti nei feriali) e si provano quattro strategie (giorni pieni
  prima o buco più grande; turni pesati o uguali), tenendo quella con meno ore scoperte, pause comprese.
  Misurato sui 7 negozi con il fabbisogno di Lilian: ore scoperte da 89 a 46 a settimana, nessun negozio
  peggiora (Franciacorta da 10,5 a 1; Brugnato resta a 20,5 perché mancano persone: 100 ore contro 114).
- **Solo le ore che servono (20/10/2026)**: dopo la proposta `sfrondaOreInPiu()` accorcia di mezz'ora
  alla volta i turni proposti (mai quelli fissi) e toglie quelli inutili finché la copertura del giorno
  non peggiora, partendo da chi ha più ferie e permessi maturati (`saldoOre`, dal tabulato). Le ore di
  contratto che avanzano restano per ferie e permessi e la colonna «Ore» lo dice. Sui 7 negozi: Barberino
  103,5 ore pianificate per 103 necessarie (prima 130), Torino 120,5 per 120, scoperte invariate. Senza
  fabbisogno non si accorcia niente. Le ferie e i permessi approvati in settimana riducono le ore.
  Manca ancora il passo successivo della specifica: trasformare quelle ore in proposte di ferie vere.
- Calcolo: serve un ottimizzatore a numeri interi (come il PuLP/CBC usato da Lilian), non la proposta
  greedy di oggi. Obiettivo: coprire il fabbisogno (penalità più alta nei giorni di punta), non mettere
  ore dove non servono, consumare le ferie in modo equo.

### Le ferie dentro il piano

Vedi `PIANO_FERIE_NOTES.md`, sezione «Fase 4». In breve: saldo dal tabulato più maturazione proiettata
mese per mese, ferie messe nei periodi tranquilli, obiettivo di fine anno = zero sulle ore che
altrimenti verrebbero pagate.

### Dati da chiedere

- Kacorri (Brugnato): la maternità è scritta nella nota del 29/09 ma senza date; servono inizio e
  rientro per segnarla come assenza lunga.
- Report MODA mensili di tutti i negozi, e quelli 2025 di Valdichiana e Torino.
- File presenze mensile di People Smart (lo prepara Veronica per lo studio): darebbe ferie godute,
  malattie e il confronto turni pianificati / ore vere. **Da chiedere più avanti**, non ora (Patrizio,
  19/10/2026).
- Chi chiede cosa: a Veronica solo le date di Kacorri; a Lilian i report MODA e le due domande per lo
  studio (quali ore non godute vengono pagate e quando; regola mensile della maturazione).
- I calendari di Lilian di Franciacorta (contano Platto, in aspettativa, e Balada, uscita il 05/09) e
  di Brugnato da novembre (Ruggeri scade il 04/11, Falchi oggi a chiamata) vanno rifatti.

## Pausa da 8 ore a 30 minuti e ritocco finale (20/10/2026)

- Regola di Patrizio: «6 + 30 minuti e 8 + 30 minuti e non -». La pausa e' sempre di 30 minuti da 6
  ore lavorate in su e si aggiunge alle ore: 8 ore di lavoro sono 8 ore e mezza di presenza.
  `REGOLE_DEFAULT.pausaLungaMinuti = 30`, default di colonna a 30 con la migration 318 sui 3 tenant
  (tabella `outlet_shift_rules` vuota ovunque, nessuna riga toccata). Le due soglie restano
  modificabili per negozio.
- Il piano mostra la pausa con inizio e fine («pausa 13:00-13:30»).
- `ritoccaScoperture()`: dopo la proposta e la prima sfrondatura, allunga, sposta o aggiunge turni
  di mezz'ora in mezz'ora finche' le ore scoperte calano (sempre entro contratto, 8 ore, un turno al
  giorno, giorni consentiti), poi si sfronda di nuovo. Misurato sui 7 negozi di NZ con il fabbisogno
  di Lilian e l'organico del 20/10: ore scoperte da 45,5 a 31,5; Franciacorta a zero. Brugnato resta
  a 17,5 perche' servono 114 ore e il contratto ne ha 100.
- Falchi (Brugnato, a chiamata) lavora solo sabato e domenica (Veronica, 20/10/2026): annotato nella
  scheda. I contratti a chiamata restano fuori dalla proposta; il vincolo «solo questi giorni» per
  persona e' fra i vincoli per persona della fase successiva.

## Eventi, giorni chiusi e referenti (migration 319, 20/10/2026)

Richiesta di Patrizio: «la sezione giorni speciali deve essere dedicata a eventi che Veronica può
inserire anche in corso d'anno [...] Black Friday, feste natalizie, saldi [...] maggior necessità di
personale e quindi no ferie, no permessi e se necessario aggiunta straordinari; mentre ci deve essere
per ogni outlet i giorni chiusi».

- **`outlet_events`** (nuova): nome, `data_dal`/`data_al`, `outlet_ids` (NULL = tutti i negozi),
  `persone_extra`, `blocca_ferie`, `straordinari`, nota. Scrive chi tiene l'organico (Veronica e'
  `contabile`); `persone_extra` e' fabbisogno e la cambia solo `super_advisor` (trigger
  `outlet_events_fabbisogno`). UI: scheda «Eventi» della pagina Turni (`EventiNegozi.tsx`).
- **Effetti**: `costruisciGiorni(..., eventi)` somma le persone in piu' (il maggiore se gli eventi
  si sovrappongono; un evento non apre un giorno chiuso) e porta `evento`/`straordinari` sul giorno.
  `verificaRichiesta(..., senzaFerie)` blocca una richiesta con un giorno dentro un evento
  `blocca_ferie`; il calendario lo mostra in rosso; Approvazioni avvisa sulle richieste gia'
  arrivate. `proponiSettimana` dopo il ritocco normale fa un secondo ritocco **solo nei giorni di
  evento con straordinari**, oltre le ore di contratto (sempre max 8 ore al giorno e i giorni
  consentiti): `ore[id].straordinario`, mostrato nella colonna «Ore» e nel messaggio della proposta.
- **Giorni chiusi**: restano per negozio in `outlet_special_days` («Giorni chiusi e orari diversi»),
  con «anche negli altri negozi» per segnare la stessa data su tutti. Il campo persone in piu' non si
  inserisce piu' da li' (le righe gia' salvate lo conservano).
- **Referente di negozio**: `outlets.referente_employee_id`, impostata con la RPC
  `organico_imposta_referente` (chi tiene l'organico; la scheda negozio la scrive solo la direzione).
  NZ al 20/10/2026: Barberino Elisa Manescalchi, Valdichiana Silvia Felici, Brugnato Sara Buratta,
  Valmontone Daniela Cacciotti, Palmanova Shadi Mir Shafiei («Shari M»), Torino Ana Solange Da
  Fonseca Mannile, Franciacorta Paola Maggiori. **Roma: «Tania A» non e' in anagrafica**, referente
  da impostare quando arriva la sua scheda.
- Aperto: nessun evento caricato; le date di Black Friday, feste e saldi le inserisce Veronica.

## Pianificazione mensile: disegno concordato con Patrizio (20/10/2026)

Decisioni di Patrizio dopo l'analisi dei report MODA (settembre-dicembre 2025, 1-24 settembre 2026).

**Partenza**: piani dal 1° novembre 2026.

**Fabbisogno dal dato MODA, senza obiettivi**. Nessun «ingressi per persona all'ora» da fissare: si fa
il massimo, negozio per negozio, con le persone che ci sono. Le ore disponibili della settimana (contratto
meno ferie e permessi approvati) si distribuiscono fra giorni e ore in proporzione agli ingressi MODA, con
almeno una persona per tutta l'apertura. Tipi di giorno: lun-gio, venerdi' (feriale con sera piu' piena),
sabato, domenica. Forma oraria dallo stesso mese dell'anno prima, livello corretto con le settimane recenti.
Storico MODA: Torino ha aperto a marzo 2026 e Valmontone a ottobre 2025, quindi niente 2025 per loro (non e'
un dato mancante). Servono i report gennaio-agosto 2026. Roma: nessuno storico, finche' non apre profilo di
Valmontone.

**Giorni speciali per tipo, non per data**: festivo infrasettimanale come una domenica; venerdi' del Black
Friday come un sabato; feriali prima di Natale e fra Natale e Capodanno con il loro moltiplicatore (2025:
x1,3-3,4); ogni anno si ricollocano rispetto al weekend (2026: Immacolata martedi', ponte lunedi' 7/12 senza
storico; 26/12 di sabato).

**Weekend liberi a rotazione nel mese** (punti 1-7 approvati):
1. il mese e' l'unita': prima si fissano i sabati/domeniche liberi del mese, poi si costruiscono le settimane;
2. a rotazione, prima a chi ne ha avuti meno; il contatore non si azzera a fine mese;
3. un solo giorno (sabato o domenica); il weekend intero solo se avanza;
4. priorita': copertura, poi weekend libero; nei weekend di evento zero liberi, e chi li lavora parte avanti;
5. le ore della settimana restano quelle: il libero si recupera in un feriale, dove il traffico serve di piu';
6. rigenerare una settimana non tocca i liberi gia' dati;
7. chi lavora a chiamata non entra nella rotazione; le ferie approvate in un weekend non contano come libero.
Nessun minimo di domeniche libere da contratto: decide l'azienda.

**Piu' piani per lo stesso mese**: per ogni negozio e mese si possono creare piu' piani alternativi con regola
weekend diversa (nessun libero; solo sabati; solo domeniche; sabato o domenica a rotazione) e confrontarli
(ore scoperte, straordinari, liberi per persona). La responsabile HR sceglie quello che vale; gli altri restano
come bozze.

**Storico e riprova**: piani e turni restano per sempre. Quando arriva il cedolino del mese, quel mese si
chiude: turni e piano non si modificano piu' e servono per la riprova con le ore del cedolino e con il file
presenze People Smart (quando arrivera').

**Persone**: Caprioli (Brugnato, a chiamata) si usa per arrivare a copertura nel weekend; il suo contratto
oggi scade il 25/10/2026, per novembre serve una proroga. Falchi: il non rinnovo del 20/10/2026 è stato annullato lo stesso giorno. Dal 1/11/2026 torna a
Brugnato con un part-time di 20 ore (rinnovo da_confermare, scadenza provvisoria 31/01/2027): la
simulazione di novembre chiedeva circa 16 ore a settimana, 20 per coprire le settimane di ferie.

**Rinnovo che cambia contratto**: una proroga con `contratto_tipo` cambia anche il tipo di contratto
dal suo `data_dal` (es. da chiamata a part-time determinato), così le ore contano nei piani.

## Piani mensili, traffico MODA, HR, chiusura al cedolino (migration 320, 20/10/2026)

- **Traffico** in `outlet_traffic_hourly` (ingressi, scontrini per ora). Caricati il 20/10/2026 su NZ
  i 13 report MODA dello zip di Patrizio (set-dic 2025 per 6 negozi, 1-24/09/2026 per 7): totali
  per negozio verificati uguali al pezzo ai PDF. Vendite non caricate. Torino ha aperto a marzo 2026,
  Valmontone a ottobre 2025. Mancano i report gennaio-agosto 2026 (arrivano): servono un caricamento
  in pagina, che oggi non c'e'.
- **Motore** `src/lib/pianoMensile.ts`: tipo di giorno dal calendario (festivi, Black Friday =
  ultimo venerdi' di novembre, il suo weekend, feriali 22-30/12, vigilie), traffico atteso per tipo e
  mese dalla storia del negozio (ripiego: stesso tipo in tutta la storia, poi tipo vicino; negozio
  senza storia = forma media degli altri), fabbisogno = ore disponibili distribuite come il traffico
  (round(k·ingressi), minimo 1, massimo persone disponibili, k per bisezione), weekend liberi PRIMA del
  fabbisogno (un giorno a testa nel mese, quando restano chi apre e chi chiude; prima a chi ne ha
  avuti meno nei piani scelti), poi le settimane con `proponiSettimana`; chi e' a chiamata copre solo
  i buchi rimasti (`ritoccaScoperture` con `soloPersone`). Il ponte del 7/12/2026 non ha storia:
  resta un lunedi'.
- Simulazione novembre 2026 sui 7 negozi (organico al 20/10): ognuno ha un giorno libero nel weekend
  con 0-10 ore scoperte in piu' sul mese rispetto a «nessun libero» (Torino fino a 22). Black Friday di
  Valmontone: 1.806 ingressi attesi contro 644 di un sabato e 1.060 di una domenica di novembre.
- **Varianti**: `shift_plans` (regola_weekend), `shift_plan_weekend_off`, `shifts.plan_id`. Una
  sola «scelto» per negozio e mese, con `turni_scegli_piano` (solo HR: `organico_hr`, NZ =
  Patrizio, Lilian, Veronica; senza righe vale super_advisor). Il piano settimanale mostra, per i
  mesi con un piano scelto, i turni di quel piano; altrimenti quelli fatti settimana per settimana.
- **Chiusura**: `turni_mese_chiuso` = ci sono buste in `employee_cost_slips` per quel mese; i trigger
  bloccano inserimenti, modifiche e cancellazioni di turni, piani e liberi di quel mese.

## Risposte di Veronica del 20/10/2026 (registrate su NZ)

- **Ruggeri** (Brugnato): proroga di sei mesi a 30 ore, evento `proroga` da_confermare dal 05/11/2026 al
  04/05/2027 (scadenza calcolata, da confermare con il documento dello studio).
- **Roma Soratte**: aperto tutti i giorni 10-20 (`outlet_opening_hours`, origine manuale); chiuso il
  25/12/2026, l'1/1/2027 e a Pasqua 28/03/2027 (`outlet_special_days`). Per gli anni dopo le chiusure
  vanno aggiunte: Pasqua cambia data.
- **Valmontone**: sabato e domenica chiude alle 21 (orari ora manuali). Aggiunta la fascia 20-21 con
  una persona, origine stima, come la chiusura dei feriali.
- **Sede / Magazzino**: gli orari fissi sono turni manuali in bozza per novembre 2026 (84 turni):
  Sestini lun-mer 9-13/14-17, gio 9-13, ven 9-12 (28 ore); Focardi lun-mar 9-13/14-17, mer 9-13,
  gio-ven 9-12 (24); Sabrina Scanu lun-ven 9-13 (20); Rosseti lun-mar 9-17, mer-ven 9-13 (28).
  Le ore coincidono con i contratti. **Ceni** (9-13/14-20, varia con le trasferte) non ha turni: il suo
  orario cambia di settimana in settimana e 10 ore al giorno superano le 40 del contratto.
  Non esiste ancora un «orario fisso» per persona: da dicembre i turni della Sede vanno ricopiati.

## Turno minimo di 4 ore (Patrizio, 20/10/2026)

Sostituisce la scelta del 19/10 («nessun turno minimo, solo niente sotto l'ora»). I pezzi da un'ora
o un'ora e mezza consumavano un giorno di lavoro: a 6 giorni la persona si fermava con ore di contratto
non usate (Rossini a Brugnato, 97 su 128,6) mentre il piano chiamava la riserva. Ora `REGOLE_DEFAULT.turnoMinOre = 4`
(e `outlet_shift_rules.turno_min_ore` se un negozio ne salva uno), rispettato da proposta, ritocco delle
scoperture, accorciamento, riserva a chiamata e straordinari. Prezzo misurato: Franciacorta, mezz'ora a
settimana non si copre; Brugnato novembre, la riserva passa da 27 a 37 ore (anche lei non fa meno di 4 ore).
I turni messi a mano possono essere più corti.

Misura sul traffico MODA vero di Brugnato, novembre 2026 (Buratta 40, Ruggeri 30, Rossini 30, Falchi a chiamata
solo weekend): con il minimo di un'ora 38 turni corti, Rossini 100 su 128,6 ore, 42,5 ore scoperte, Falchi 9;
con il minimo di 4 ore 0 turni corti, Rossini 128 su 128,6, 34,5 ore scoperte, Falchi 39. Con Ruggeri e Rossini
a 40: 18,5 ore scoperte, Falchi 39.

**La simulazione usa MODA** (Patrizio, 20/10/2026): come i piani veri, il fabbisogno viene dal traffico e dalle
persone che ci sono, con le ore ipotetiche; niente fabbisogno fisso di «Orari e fabbisogno». La prima versione
(PR #690) lo usava: era contro la regola e l'ho tolto.


## Disponibilità delle persone e pagina del piano del mese (migration 322, 20/10/2026)

- `employee_availability` (employee_id, giorni smallint[] 1..7, nota): giorni in cui la persona può lavorare.
  Senza riga = tutti. La rispettano piano del mese (`nonDisponibile`), piano settimanale (`motivoNonDisponibile`)
  e simulazioni (che partono da lì: «solo sabato e domenica» già spuntato). Nata da Falchi: il piano vero la
  metteva nei feriali perché il «solo weekend» stava solo nella simulazione (errore mio, segnalato da Patrizio).
  Falchi su NZ = {6,7}. Migration in due passi (322 e 322b per il GRANT DELETE: il connettore si blocca con
  quella parola nel testo).
- Pagina «Piano del mese» rifatta: testata con mese e stato, «Chi lavora» con ore e giorni, «Crea le varianti
  del mese» (le quattro regole in un colpo, solo quelle mancanti), varianti come schede, mese per settimane,
  riepilogo «Ore del mese, persona per persona» (contratto, ferie e permessi con date, da lavorare, pianificate,
  differenza con il motivo). «Stima i negozi vuoti» spostato in «Orari e fabbisogno».
- Verifica visiva fatta in locale con un'anteprima a dati finti (motore vero, traffico MODA di Brugnato).


## Turni a mano dal piano del mese e straordinari (migration 323, 20/10/2026)

- `shifts.straordinario` (boolean, default false): turno concordato in più del contratto.
- Nel piano del mese la responsabile HR (`organico_e_hr`: su NZ Patrizio, Lilian, Veronica) clicca una casella e
  apre `EditorTurno` (ora in un file suo, condiviso con il piano settimanale): inizio, fine, pausa, «Straordinario»
  e il conto del mese della persona (da lavorare, ordinarie, straordinario, ore non usate).
- Riepilogo «Ore del mese»: ore non usate = da lavorare − ordinarie; straordinario = turni segnati + ordinarie oltre
  il contratto. Un turno pubblicato o messo a mano non si cancella: si annulla (trigger della 315).
- Non si apre dove la persona non può lavorare: fuori servizio, negozio chiuso, giorno non disponibile, ferie intere.


## Ore di contratto che avanzano: prima si usano, poi ferie proposte (20/10/2026)

Decisione di Patrizio («la terza»): nessuna ora pagata senza lavoro.
1. `usaOreResidue` (pianoMensile.ts), subito dopo `proponiSettimana`: a chi ha ancora ore nella settimana si allungano i
   turni di 30' dove ingressi MODA / persone in negozio è più alto, entro turno massimo e orari; se non basta, un turno
   nuovo di almeno il turno minimo in un giorno disponibile, senza superare i giorni di lavoro. Brugnato novembre (MODA
   vero): Buratta 148 -> 165,5 su 165,7, Ruggeri 120,5 -> 128 su 128,6, ore scoperte invariate (34,5).
2. `proponiFerie`: quello che resta (da 1 ora) diventa una proposta: giornate intere F01 (ore settimanali / 5) nei
   feriali senza turno, una per settimana, e il resto come permesso F02 a ore. Dal riepilogo «Proponi ferie» crea una
   `leave_requests` «inviata», titolo «Proposta dal piano del mese»; la decide la HR in Approvazioni ferie.
3. Nel riepilogo «da lavorare» è dal vivo: contratto del mese meno ferie e permessi di adesso.


## Dove mettere le ore che avanzano (21/10/2026)

`suggerisciFinestre` (pianoMensile.ts): per la persona con ore non usate, le 3 finestre migliori del mese (una per
giorno) dove ingressi MODA attesi / persone già in negozio è più alto, nei giorni in cui può lavorare e non ha turni,
lunghe quanto le ore che restano (minimo e massimo del turno). Dal riepilogo «Dove metterle»: la HR sceglie «ore di
contratto» (contano come ordinarie, riducono le non usate) o «straordinario» (`shifts.straordinario`). Il motore
resta settimanale; lo spostamento di ore tra settimane è una scelta della HR, non del calcolo (Patrizio: «così abbiamo
tutte e due le possibilità»).


## Straordinario a ore (migration 324, 21/10/2026)

`shifts.ore_straordinario` (numeric, default 0): quante ore del turno sono straordinario. Allungando un turno di un'ora e
segnandolo, straordinario è solo quell'ora (Patrizio). L'editor propone le ore aggiunte rispetto alle ordinarie che il
turno aveva (tutte, per un turno nuovo), correggibili. Riepilogo: ordinarie = ore del turno − ore_straordinario.
`shifts.straordinario` resta come «contiene straordinario» (ore_straordinario > 0).

## Negozio mai scoperto, pausa di un'ora da 8, contratto nel mese (21/10/2026)

- **Comanda l'orario.** Ogni mezz'ora di apertura ha almeno una persona; i soli giorni chiusi sono quelli del
  calendario e quelli prima di `outlets.opening_date` (`costruisciGiorni(..., apertura)`). `copriOrarioMinimo()`
  in `pianoMensile.ts`, dopo proposta e ore residue, ripara ogni buco nell'ordine: (1) sposta o allunga il turno di
  chi lavora quel giorno; (2) turno nuovo a chi non lavora; (3) prende ore dove ci sono già due persone
  (`liberaOre`: accorcia di mezz'ora i turni con colleghi, toglie un turno che non lascia vuoti) oppure sposta il
  turno di un altro giorno e risistema quel giorno, anche liberando ore a chi ci lavora; (4) chi è a chiamata.
  Se il negozio resterebbe vuoto, il sabato o la domenica liberi della settimana saltano.
- **MODA sopra il minimo.** `fabbisognoDaTraffico` restituisce anche `esigenza` (persone che MODA chiederebbe
  senza il tetto delle ore). Il riepilogo del piano lo salva in `bisogno`; la riga «In negozio» mostra per giorno:
  rosso «scoperto HH-HH», giallo «manca N persone» nelle fasce dove MODA vuole più persone, verde «coperto».
- **Pausa.** `REGOLE_DEFAULT.pausaLungaMinuti = 60`, default di colonna a 60 (migration 325, nessuna riga
  salvata). `EditorTurno` impone `pausaMinimaPerPresenza`: 10:00-18:30 con pausa 0 non vale più 8,5 ore.
- **Contratto nel mese** = ore settimanali × giorni del mese / 7, ferie redistribuite sul mese (una settimana con
  più ferie che contratto non si azzera da sola). Buratta a novembre: 171,4 − 8 ferie = 163,4 da lavorare (prima
  173,7, sbagliato). Nelle settimane a cavallo l'eccedenza sulla quota del mese è «anticipo», non straordinario.
- **Misura del 21/10/2026** (novembre, NZ, traffico MODA vero, persone vere, ferie e disponibilità; varianti
  «nessun libero» e «un sabato o una domenica»): 0 mezz'ore vuote in tutti i negozi, 0 pause sotto la regola,
  0 turni fuori 4-8 ore, mai più di 6 giorni. Roma Soratte apre il 05/11: prima è chiusa.
- I piani di novembre salvati prima di questa versione vanno ricreati (avevano buchi e pause di 30' a 8 ore).

## Un piano si toglie intero (21/10/2026, migration 326)

Patrizio: «mi deve far cancellare sempre le simulazioni anche se già modificate e manca un cestino». Il cestino della
scheda toglie bozze e simulazioni con tutti i turni (anche messi a mano o straordinario); il piano scelto lo toglie
l'HR. `shifts_no_hard_delete` ora lascia togliere i turni di un piano (`plan_id` non nullo) che non sono pubblicati;
restano protetti i turni pubblicati e quelli messi a mano fuori dai piani. Un piano con turni pubblicati non si toglie
(la pagina lo dice prima, e comunque lo blocca la chiave esterna). Mese chiuso: `trg_shifts_mese_chiuso`.

## Ore di contratto a giornata (21/10/2026)

Regola di Patrizio: ogni contratto vale a ore per giornata lavorativa, ore settimanali / 6, e anche le ferie
consumano quelle ore. Sostituisce «ore settimanali × giorni del mese / 7» (sezione sopra).
- `giorniLavorativiSettimana`: date del mese con il contratto e il negozio aperto, meno 1 riposo solo nelle settimane
  intere (tutte nel mese e tutte con il contratto). Novembre 2026: 26 giorni; 40 h = 173,3.
- `PersonaPiano.inServizio`: giorni con il contratto nel negozio (chi è assente non ne ha). Roma Soratte: contratti dal
  02/11, turni dal 05/11 (`opening_date`): i giorni a negozio chiuso non contano.
- `oreFerieGiorno`: nel piano una giornata di ferie toglie ore settimanali / 6, mezza la metà, un permesso a ore le sue
  ore, qualunque valore sia registrato (i moduli inseriti valgono 8 h per 40 h, base 5 giorni). Il modulo Ferie e
  permessi (saldi dal tabulato, `rateiParse`) resta com'è: la regola vale per i piani.
- `proponiFerie`: giornate da ore settimanali / 6.
- Misura del 21/10/2026, novembre NZ: Buratta 173,3 − 6,7 = 166,7; Rachele (32 h, ferie 11-15/11) 138,7 − 26,7 = 112;
  0 mezz'ore vuote in tutti i negozi, 0 turni fuori 4-8 ore.

## Ore necessarie a organico pieno, settimane e prova delle ferie (28/10/2026)

Richiesta di Patrizio: vedere sopra a tutto le ore necessarie della settimana e del mese, capire dove sono le ore
scoperte e poter spegnere le ferie con il conto in tempo reale.
- Misura prima della modifica (Valmontone, novembre): con il fabbisogno costruito sulle ore disponibili, togliere le
  ferie faceva SALIRE le ore scoperte (71,5 → 76,5), perché cresceva anche il fabbisogno. Per questo le ore necessarie
  ora si calcolano sull'organico pieno: contratto di tutti senza ferie, distribuito come MODA (`giorniNecessari`,
  `maxPieno` conta anche chi è in ferie). Le scoperte si misurano su queste. I turni restano costruiti sulle ore
  disponibili, come prima.
- `EsitoPianoMese.settimane` (`SettimanaPiano`): necessarie, contratto, ferie, disponibili, pianificate, scoperte per
  settimana (solo giorni del mese); `oreScoperte` = somma. Salvato in `riepilogo.settimane`.
- Pagina: riquadro «Ore del mese, settimana per settimana» in cima; striscia delle scoperte per settimana in ogni
  scheda; riquadro «Ferie e permessi del mese: prova a spegnerli» con ricalcolo delle varianti in browser
  (`caricaBase` una volta, `calcolaPiano` per regola, chiavi «persona|data»). «Salva come simulazione» salva
  `ipotesi.ferieTolte`. Le richieste di ferie non cambiano mai dalla prova.
- Le varianti salvate prima del 28/10 non hanno `settimane` e hanno le scoperte misurate alla vecchia maniera: vanno
  ricreate.

## Calendario senza ferie e ferie inserite dal calendario (28/10/2026)

Richiesta di Patrizio: poter creare il calendario senza ferie e permessi (organico pieno, sempre MODA e regole),
sceglierlo e poi inserire ferie e permessi dal calendario; resta anche la proposta automatica con le ferie giuste.
- `creaPiano(regola, ipotesi, senzaFerie)`: con `senzaFerie` tutte le ferie del mese sono tolte dal calcolo
  (`calcolaPiano` con tutte le chiavi «persona|data»); `riepilogo.senzaFerie = true`, nome «… · senza ferie · …».
  Le schede si dividono in due gruppi; «meno ore scoperte» si confronta dentro il gruppo; la prova delle ferie
  vale solo per le varianti con ferie.
- `EditorTurno` prop `ferie` (ore settimanali, codice negozio, già in ferie): «Giornata di ferie» (ore / 6) o
  «Inserisci permesso» creano `leave_requests` stato `inviata`, titolo «Inserita dal piano del mese», più il giorno
  (`F01` giornata, `F02` ore). Con la giornata il turno del giorno si toglie (`togliTurno`: tolto se il piano non è
  pubblicato, altrimenti annullato).
- La casella in ferie per la giornata si apre se c'è un turno (calendario senza ferie), per poterlo togliere.
- Aggiornamento stesso giorno: anche la mezza giornata (`mezza_giornata`, metà delle ore / 6) e la scelta «Già
  approvata» (default) o «Da approvare». Già approvata chiama `leave_decidi` sul giorno appena creato: stessa
  approvazione di Approvazioni ferie, il saldo si consuma. Se l'utente non può decidere sulle ferie, la richiesta
  resta inviata e la pagina lo dice. Un processo di approvazione dedicato si farà dopo (Patrizio).

## Riquadro delle ore che si somma, «In negozio» e ferie nel calendario senza ferie (28/10/2026)

Patrizio non capiva il riquadro (21 necessarie, 21,7 di contratto, 3,5 scoperte; «manca 12 persone» il sabato) e
vedeva le ferie nel calendario senza ferie.
- `SettimanaPiano` ha `coperte` (= necessarie − scoperte), `inPiu` (= nei turni − coperte: ore messe dove MODA
  non le chiede, per le regole) e `nonUsate` (ore disponibili per persona che i turni non usano). Il riquadro mostra
  necessarie = coperte + scoperte e nei turni = coperte + in più. Barberino, novembre, senza ferie: 1/11 21 = 17,5 +
  3,5; contratto 21,7, non usate 4,2 (Pampaloni 3,33 h sotto il turno minimo + arrotondamenti alla mezz'ora).
- «In negozio» confronta con `esito.necessari` (organico pieno, tetto = persone in servizio), non più con
  `esigenza` senza tetto: massimo «manca» misurato a Barberino 2 persone su un picco di 4.
- Calendario senza ferie: `ferieMese` mostra solo i giorni creati dopo il piano (`creato_il` > `created_at`);
  `ferieTutte` resta per la prova delle ferie.
- 93 contro 91,5 ore (nessun weekend libero peggio di un sabato libero): la proposta è un metodo a tentativi, non un
  ottimo garantito; differenze di 1-2 ore fra varianti sono possibili.

## Ore della settimana e turno massimo di 10 ore (28/10/2026)

Patrizio: «non è più valida la regola di dividere l'orario settimanale per 6 giorni». Il contratto è un monte ore
settimanale: un 40 ore può fare 4 ore un giorno e 9 o 10 il giorno dopo, sempre con il minimo di 4 ore.
- **Turno massimo 10 ore lavorate** (`REGOLE_DEFAULT.turnoMaxOre = 10`, default di colonna `turno_max_ore` a 10 con la
  migration 327; Franciacorta aveva già 10, nessun altro negozio aveva regole salvate). La pausa sta dentro l'orario:
  `lavoroMassimoGiorno` dà 9 ore lavorate in un negozio aperto 10 ore (10-20), 10 in uno aperto 11 (Valmontone sab-dom).
  Prima il motore saltava il giorno quando turno + pausa non entravano nell'orario (difetto che già toccava Franciacorta):
  ora il turno si accorcia a quello che entra.
- Con turni più lunghi una persona copre da sola una giornata di 10 o 11 ore: `personeMinime` scende (es. 2 invece di 4
  nel weekend con fabbisogno 2), quindi più sabati e domeniche liberi possibili; anche la stima di «Proponi dai dati»
  non dimezza più il tetto delle persone nei negozi aperti fino a 11 ore.
- **Ferie**: approvate = ore scritte nel piano ferie (`oreFerieGiorno`, il /6 solo se mancano); proposte da noi = ore
  settimanali / 6 nei negozi (`proponiFerie`, `EditorTurno`), / 5 in Sede (quando ci sarà la sezione Sede).
- **Settimana intera anche fra due mesi** (Patrizio, 28/10/2026): `contrattoIntero` = ore settimanali sull'intera
  settimana lun-dom (ridotte in proporzione solo per giorni a negozio chiuso o senza contratto, tolto il riposo delle
  settimane intere); `contrattoSett` = la parte di questo mese, cioè `contrattoIntero` meno le ore dei turni veri
  (piano scelto, piano settimanale, turni a mano, in qualunque negozio: `oreFuoriMese`, caricate in `caricaBase`) e
  delle ferie nei giorni dell'altro mese. Se l'altro mese non ha turni, i giorni di questo mese possono usare tutte le
  ore della settimana (nei limiti 4-10 ore al giorno). Le necessarie si distribuiscono come MODA sull'intera settimana e
  si contano solo i giorni del mese. Straordinario e anticipo si contano settimana per settimana (prima: netto del mese).
  Il «contratto del mese» non è più fisso (non più 173,3 per un 40 ore a novembre): dipende dal mese accanto.

## Accordi con il dipendente: giorni e fasce orarie (28/10/2026)

Patrizio: partire dagli accordi presi con il singolo, tenendo fermo l'orario di contratto. Nella scheda dipendente
(`src/components/AccordiOrario.tsx`, montato in `SchedaDipendenteModal` di `Dipendenti.tsx`), riquadro «Disponibilità
per i turni»: per ogni giorno Sempre / Mai / Solo dalle-alle, nota dell'accordo, validità dal-al.
- Tabella `employee_availability` (322) + migration 328: `fasce jsonb` ({"4": [{"dalle": "14:00", "alle": "20:00"}]},
  giorno assente = tutto l'orario; il formato accetta più fasce, oggi la pagina ne usa una perché il turno non si spezza),
  `valido_dal`, `valido_al`. Scrive solo `organico_e_hr()` (Patrizio: «solo gli amministratori»), leggono tutti.
  Martina Falchi (giorni 6,7, senza fasce) resta valida così com'è.
- Regole pure in `src/lib/accordiOrario.ts`: `puoLavorareIl`, `fasciaIl` (la fascia più lunga), `fasceDelle`,
  `testoAccordo` («mar mai · gio 14-20»), `orePossibiliSettimana` (ore massime a settimana nell'orario del negozio, confronto
  in rosso con il contratto).
- Motore: `PersonaTurni.fasce` / `PersonaPiano.fasce` (per data); `limitiPersona` sostituisce apertura e chiusura del negozio
  quando si crea, allunga o sposta un turno (proponiSettimana, ritoccaScoperture, copriOrarioMinimo, usaOreResidue,
  suggerisciFinestre); `rispettaFasce` è la rete di sicurezza in fondo a proponiSettimana e a ogni settimana di pianificaMese.
- Il piano del mese mostra il riassunto in «Chi lavora»; i vecchi pulsanti dei giorni sono stati tolti (si modifica dalla scheda).

## Trasferte (28/10/2026)

Patrizio: le referenti possono lavorare in altre sedi; quelle ore sono orario di lavoro ma non presenza nel negozio di
riferimento, e servono per il report. Decisioni: la copertura del negozio di destinazione si sceglie volta per volta;
le inseriscono la responsabile HR e chi tiene l'organico (poi anche le responsabili di negozio); per ora niente rimborsi.
- Tabella `employee_trasferte` (migration 329 + 329b per il GRANT DELETE, 3 tenant): persona, negozio di riferimento,
  data, inizio, fine, pausa, destinazione (negozio o luogo), `copre_destinazione`, motivo. A parte da `shifts` apposta:
  nessun conteggio dei turni in negozio le prende per presenza.
- `src/lib/trasferte.ts`: caricamento, ore (pausa esclusa), `copertureVerso` (turni fissi per la copertura del negozio
  di destinazione), `riepilogaTrasferte` (per persona e per destinazione).
- Piano del mese: `PersonaPiano.oreTrasferta` si toglie dalle ore della settimana come le ferie, il giorno non è libero
  per un turno; trasferte dei giorni dell'altro mese in `oreFuoriMese`; `pianificaMese({ fissi })` per chi copre il
  negozio (contano nelle scoperte e nella riga «In negozio», non entrano nei turni del piano). Piano settimanale: stesse
  regole (`motivoNonDisponibile` «in trasferta», ore tolte, `fissi`).
- UI: riquadro trasferta in `EditorTurno`, casella «trasferta» nel calendario, riga trasferte in «Ore del mese»,
  scheda «Trasferte» (`TrasferteNegozi.tsx`) con totali ed export Excel.

## Le parole delle ore: «ore da contratto» e «ore programmate» (28/10/2026)

Patrizio: niente «ordinarie», «lavorate», «da lavorare», «pianificate», «non usate». Due numeri e la differenza:
- **Ore da contratto** = ore settimanali (nelle settimane a cavallo la parte del mese) meno ferie, permessi e trasferte,
  con la spiegazione sotto («173,3 meno 13 di ferie»). **Ore programmate** = turni, senza lo straordinario concordato.
- Differenza: «In linea con il contratto» · «Mancano N h da programmare» · «N h in più del contratto: decidi se sono
  straordinario o se le togli». Lo straordinario concordato (turni segnati) su una riga a parte.
- Dove: accanto al nome nel calendario (colonna fissa, «33 di 36 h»), nell'editor della casella (prima la settimana, poi
  il mese, `ContoMese.settimana`), nella tabella «Ore del mese». La vecchia colonna «Ore settimana» a destra è tolta.
- Quota del mese nelle settimane a cavallo, se l'altro mese non ha turni: mai più della capienza dei giorni del mese (un
  turno al giorno, `lavoroMassimoGiorno`). Caso Maggiori (FRC, 36 h): 1/11 domenica sola valeva 12,4 h, ora 9.
  `EsitoPianoMese.persone[id].settimane` = contratto lordo per settimana (`contrattoSettimanaOra` toglie ferie e
  trasferte dal vivo).
- Ferie dalla casella: il giorno di ferie si apre e «Togli le ferie» chiama `leave_decidi` con gli altri giorni
  approvati della richiesta e motivo «Tolte dal piano del mese» (giorno respinto, saldo a posto, storico intatto). Se
  la richiesta ha altri giorni «richiesto», si rimanda ad Approvazioni ferie per non approvarli senza volerlo.
- (stesso giorno, dopo) Tabella «Ore del mese, settimana per settimana» spostata fra le schede delle varianti e il
  calendario, quattro righe: Ore da contratto (piene, nessuna ferie tolta; «di cui in ferie o permesso» se ci sono) ·
  Ore nei turni · Ore ancora da assegnare (contratto − ferie − turni; negativo = «oltre») · Ore sotto MODA (ex
  «scoperte»: orari in cui i turni hanno meno persone di quelle che chiede il traffico). Spariti necessarie, coperte,
  disponibili, dove servono, dove MODA non le chiede, contratto non usato. «mancano» → «da assegnare»; «manca N
  persone» → «sotto MODA di N persone». Le necessarie si calcolano sulle ore da contratto del mese (`contrattoSett`)
  distribuite sui giorni del mese, così non superano più il contratto nelle settimane a cavallo (44 contro 42,9).

## Mai un giorno con una persona sola (28/10/2026)

Patrizio: «non creare mai giornate con 1 dipendente solo, perché se si ammala dalla mattina siamo senza apertura».
Nei piani di Barberino di novembre (calcolati prima) il giovedì aveva una persona sola 10-20 in tutte le varianti.
- `almenoDuePersone(base, turni, titolari, riserva, regole, fissi)` in `pianoMensile.ts`: per ogni giorno con una
  persona sola dà un turno minimo a un collega (prima chi ha meno giorni e più ore libere). Ore libere: se mancano si
  accorciano i suoi turni nei giorni con almeno due persone; se ha già tutti i giorni o turni già al minimo, si sposta
  qui un suo turno da un giorno affollato e quel giorno si ricopre con `copriOrarioMinimo`. Il turno di chi era da sola
  si accorcia dove ora c'è il collega. Mai toccati i turni fissi (a mano, pubblicati, trasferte che coprono).
- Chiamata in `pianificaMese` prima dell'ultimo `usaOreResidue`, e in `PianoTurni` dopo `proponiSettimana`.
- Riga «In negozio»: «una persona sola» quando nessuno ha potuto.
- Misura su novembre 2026, 8 negozi, regole «nessuno» e «sabato o domenica»: senza la regola giovedì 26/11 con una
  persona sola a PLM, RSO, TRN; con la regola 0 ovunque, 0 mezz'ore vuote, 0 turni sotto 4 ore, ore sotto MODA +1,5/2,5.

## Scheda dipendente ordinata (28/10/2026)

Contratto e anagrafica sempre aperti e compatti (ore a settimana in vista, tempo determinato su due righe senza testo
che esce); note e storico, documenti del rapporto, disponibilità per i turni e netti dell'anno in sezioni che si aprono
(`<details>`), con il riassunto nel titolo.

## Spostare i turni dal calendario (29/10/2026)

Patrizio: trascinare le caselle su un'altra persona (sostituire o affiancare), oppure dalla finestra «metti Susanna
al posto di Claudia» con le stesse ore o con ore scritte a mano.
- `src/lib/spostaTurni.ts` (puro, testato): `mossePossibili` (casella vuota: sposta / affianca; con turno: scambia /
  sostituisci; stessa persona: solo sposta su un giorno vuoto), `dopoLaMossa`, `avvisiPerChiRiceve` (ferie, trasferta,
  accordi e fascia, giorni della settimana oltre il massimo, non in servizio), `avvisiPerIlGiorno` (una persona sola,
  scoperto, nessuno). Gli avvisi non bloccano.
- Piano del mese: drag and drop HTML5 sulle caselle con un turno (solo stessa settimana, giorni aperti), riquadro
  «Sposta il turno» con le mosse e gli avvisi; `eseguiMossa` scrive su `shifts` (update employee_id/data, insert per
  affiancare, update incrociato per scambiare, delete o annullato per il turno sostituito), sempre `origine = 'manuale'`.
  Nessun vincolo di unicità su shifts (verificato 29/10): lo scambio sono due update.
- Finestra del turno (`EditorTurno`, prop `passaggio`): «Dai questo turno a…» con l'orario scritto in alto; da telefono.
- Piano settimanale (`PianoTurni.tsx`): stesso trascinamento, stesso riquadro e stessa finestra, con le funzioni comuni
  `avvisiMossa`/`scrittureMossa`/`esitoMossa` (`spostaTurni.ts`), `eseguiMossaSuShifts` (`spostaTurniDb.ts`) e
  `SpostaTurnoModal`. Nella settimana a cavallo di due mesi il `plan_id` segue il mese del giorno di arrivo
  (`planDi`), così un turno spostato dal 31 al 1° passa al piano scelto del mese nuovo.

## Piano settimanale e piano ferie su MODA (29/10/2026)

Patrizio: «allinea piano settimanale e ferie a MODA». Prima il piano settimanale e gli avvisi del
piano ferie leggevano solo le fasce di «Orari e fabbisogno» (`outlet_staffing_needs`), contro la
regola 1 del CLAUDE.md.

- **Piano settimanale** (`PianoTurni.tsx`): il fabbisogno è `fabbisognoDaTraffico` sulle ore dei
  candidati della settimana (contratto meno ferie, permessi e trasferte), al massimo le persone
  disponibili quel giorno, più `personeInPiu` (giorni speciali + eventi). Vale per la proposta e per
  la riga «Copertura». Storico da `caricaStoricoNegozio` (traffico del negozio, altrimenti media degli
  altri), come il piano del mese. Le fasce valgono solo senza traffico.
- **Piano ferie** (`PianoFerie.tsx`): `fabbisognoPienoDaTraffico`, cioè le «ore necessarie» del piano
  del mese: per ogni settimana le ore di contratto di tutto l'organico, ferie non tolte, distribuite
  come MODA, al massimo le persone in forza. Servono le persone del picco della giornata. Avviso se chi
  resta è meno. Niente minimo di due persone nel controllo ferie: Patrizio, 29/10/2026, «per il
  momento non lo aggiungerei».
- **Piano del mese**: le «persone in più» dei giorni speciali prima si perdevano quando c'era il
  traffico (contavano solo quelle degli eventi); ora `personeInPiu` le somma tutte e due.
- Misura del 29/10/2026 su NZ, settimana 9-15/11 (ore delle fasce → ore MODA): Barberino 103 → 170
  (5 persone, 170 h di contratto; feriali 16 h al giorno con picco 2, sabato e domenica 44-46 h con
  picco 5), Palmanova 113 → 126, Valmontone 147 → 156. Avvisi ferie fino al 31/12: prima 0 ovunque;
  con MODA Barberino 4 giorni (7, 8, 14, 15/11), Valmontone 6 (weekend 7-8, 14-15, 21-22/11),
  Palmanova 0. Sono tutte ferie di sabato o domenica, dove il picco MODA chiede tutto l'organico.

## Ore oltre il tetto, sotto MODA senza arrotondare, «In negozio» con le pause (29/10/2026)

Nato dal 1/11 di Barberino: tabella «4 ore sotto MODA», calendario «coperto».
- La riga «In negozio» contava chi aveva il turno, pausa compresa; il riquadro delle ore toglieva le
  pause. Ora anche «In negozio» usa `copertura()` (pause tolte) e lo stesso fabbisogno esatto.
- `fabbisognoDaTraffico`: k si calcola sulla distribuzione **senza** il tetto delle persone, poi il
  tetto taglia. Prima k cresceva finché le ore entravano col tetto, e le ore del sabato e della
  domenica finivano nelle ore e nei giorni con meno traffico (il 1/11: 4 persone anche alle 18 con 49
  ingressi). Le ore tagliate restano «da assegnare» o ferie.
- `esatto` (non arrotondato, con tetto) misura necessarie e ore sotto MODA (`oreSottoModa`) e guida
  `collocaPause`. La proposta e i controlli interni del motore (`oreScoperte`) restano interi.
- Misura del 29/10: 1/11 Barberino, 36 h, 4 persone dalle 10 alle 20 con un'ora di pausa: da 4 a 3,6 ore
  sotto MODA. Il traffico chiede 4 persone (4,3-5,5 senza tetto) in tutte le ore 11-18 tranne le 13
  (3,63): la prima pausa va alle 13, le altre tre cadono dove servono tutte e quattro. Il buco è vero.
  Settimane di novembre (necessarie intere): Barberino 170 → 135 h (feriali 16 → 10 h), Palmanova 126 →
  117, Valmontone 156 → 133. Le varianti già create vanno ricreate per vedere i numeri nuovi.

## Soglia di ingressi per addetto, pausa pranzo 13-15, turni da 7 ore e mezza (29/10/2026)

Sostituisce il «fare il massimo con le persone che hai» e la sezione precedente sulle ore oltre il tetto
(che resta valida per `esatto`, `oreSottoModa` e la riga «In negozio» con le pause).
- **Fabbisogno** (`fabbisognoDaTraffico`): ingressi attesi nell'ora / soglia, almeno 1, tetto delle
  persone disponibili, più `personeInPiu`. `sogliaDelGiorno`: weekend = sabato, domenica e festivi.
  Soglie in `outlet_shift_rules.soglia_ingressi_feriali/_weekend` (migration 330, NZ, Made e Zago;
  NULL = 25 dal codice). Si cambiano in «Regole dei turni».
- **Da dove viene il 25**: presenze di settembre e ottobre (cartellini, 7 negozi, 2.469 ore utili) incrociate
  con ingressi e scontrini MODA. Feriali: conversione 9-10% fino a 20 ingressi per addetto, 6,6-6,7% fra 25 e
  30 (poche ore). Weekend: su tutte le giornate cala fino a ~30, sulle giornate con pause timbrate non cala
  fino a 35: il 25 nel weekend è prudente. A parità di traffico, sopra 40 ingressi l'ora più persone non
  hanno alzato la conversione. Limiti: pause non timbrate fino al 18/10, report MODA con impostazioni
  diverse, solo scontrini (niente vendite e pezzi). Rimisurare a fine novembre.
- **Ore non richieste dal traffico**: restano «ancora da assegnare» (Patrizio: ferie, permessi o turni).
  `usaOreResidue` non è più chiamata dal piano del mese.
- **Pausa pranzo 13-15** (`PAUSA_PRANZO`, `collocaPause`): per chi lavora a cavallo della fascia la pausa
  sta dentro; altrimenti la regola delle due ore.
- **Turni da 7 ore e mezza** (`giornoPieno`, `migliorStrategia` prova le strategie con e senza turni corti,
  a parità vincono i corti): con più di 2 persone insieme le pause da un'ora non stanno nella fascia.
- **Misura del 29/10** (proposta della settimana 9-15/11, traffico di novembre 2025, ore settimanali
  dell'anagrafica, senza ferie; prima → dopo): necessarie Barberino 170 → 101, Valdichiana 207 → 141,
  Palmanova 126 → 82, Franciacorta 182 → 92, Brugnato 140 → 81, Valmontone 156 → 116, Torino 138 → 99.
  Ore scoperte (persone intere) da 9,5-18 a 0-1,5 per negozio. Turni da 8 ore o più da 3-11 a 0-2.
  Pause di chi lavora a pranzo fuori dalle 13-15: da 3-8 a 0 (una a Valdichiana). Ore di contratto
  da assegnare: da 4-13 a 25-67 a settimana per negozio. 1/11 Barberino (4 persone): sotto MODA da 3,6 a 1,1.

## Due persone in negozio salvo la prima e l'ultima ora (30/10/2026)

Patrizio: «l'ottimale sarebbe avere sempre 2 persone in contemporanea in negozio salvo la prima
ora di apertura e l'ultima di chiusura» (bisogni primari, negozi di 150 mq). Se le ore non
bastano vince la seconda persona sul traffico MODA del weekend.

- **Dove**: `fabbisognoDaTraffico` alza a 2 il minimo (fabbisogno, esigenza, esatto) nelle mezz'ore
  che iniziano almeno un'ora dopo l'apertura e finiscono almeno un'ora prima della chiusura, sempre
  col tetto delle persone disponibili. Regola `duePersone` in `RegoleTurni`, colonna
  `outlet_shift_rules.due_persone` (migration 331, NZ, Made e Zago; NULL = accesa), casella in
  «Regole dei turni». Vale anche per il controllo delle ferie (`PianoFerie.tsx`, Patrizio 30/10/2026: «anche le
  ferie devono tener conto della seconda persona»).
- **Sotto MODA**: con la regola accesa le ore «sotto MODA» e la riga «In negozio» contano anche la
  seconda persona che manca.
- **Misura** (novembre 2026, persone in anagrafica, senza ferie, un sabato o una domenica liberi):

| Negozio | Ore con 1 persona fuori da prima/ultima ora, prima → dopo | Ore di contratto usate | Sotto MODA sul solo traffico |
|---|---|---|---|
| Barberino | 97,5 → 5,5 | 547 → 645 su 745 | 20,3 → 22,0 |
| Valdichiana | 93 → 4 | 684 → 798 su 918 | 53,3 → 44,6 |
| Palmanova | 124 → 18 | 441 → 531 su 554 | 8,9 → 21,4 |
| Franciacorta | 88,5 → 4 | 557 → 674 su 804 | 4,1 → 5,4 |
| Brugnato | 125,5 → 0,5 | 450 → 562 su 612 | 5,7 → 12,4 |
| Valmontone | 113,5 → 27,5 | 570 → 665 su 694 | 55,3 → 55,7 |
| Torino | 102 → 5 | 504 → 595 su 616 | 18,7 → 27,4 |

  Nessuna ora vuota e nessun turno sotto le 4 ore, prima e dopo. Palmanova (126 ore di contratto,
  esattamente quelle che servono) e Valmontone (aperto fino alle 21 nel weekend) non hanno
  abbastanza persone. Con le ferie vere i negozi al limite tornano ad avere giorni con una persona.

## Pause coperte e variante senza weekend liberi (30/10/2026)

Barberino, novembre 2026, rigenerato da Patrizio dopo la regola delle due persone:
- **Pausa da sola**: mercoledì 4/11 (Clementi e Suzzi in ferie) Manescalchi era sola 10-16 con mezz'ora di
  pausa: negozio vuoto durante il pranzo. `copriOrarioMinimo` ora guarda la copertura con le pause tolte
  (`copertura`), quindi mette un collega a coprire la pausa (Manescalchi 10-20 con un'ora, Pampaloni 13-17).
  Un buco che non si chiude finisce in `irrisolti` e il motore passa ai giorni dopo (prima si fermava al primo).
  `almenoDuePersone` resta sulla presenza lorda: con la netta il test «mai una persona sola» peggiorava.
- **Variante senza weekend liberi peggiore delle rotazioni**: il motore non è un ottimizzatore, e un vincolo
  in più a volte lo porta su una distribuzione migliore. `pianificaMese` con `regola = 'nessuno'` prova anche
  le tre rotazioni e tiene la migliore (prima meno mezz'ore vuote, poi meno ore scoperte).
- **Misura** (novembre, 7 negozi senza ferie): nessun cambiamento sulle rotazioni; la variante senza weekend
  liberi è sempre la migliore o pari. Barberino con le ferie di novembre: ore sotto MODA 149,2 senza weekend
  liberi, 142,1 con un sabato libero, ma questa lascia il negozio vuoto un'ora (pause) invece di mezz'ora.
  Resta vuota la mezz'ora di pausa di venerdì 13/11: Manescalchi in ferie tutta la settimana, Pampaloni con
  tutte le sue 20 ore usate, la pausa di Clementi non può stare dopo le 15:30. La pagina la segna in rosso.
- **Ore che mancano**: con le ferie di novembre la settimana 2-8 ha 104 ore di contratto contro circa 126 di
  presenza che servono per avere due persone salvo prima e ultima ora: una ventina di ore con una persona
  sola sono inevitabili.

## Ore libere dove manca qualcuno (30/10/2026)

Brugnato, novembre 2026: ogni giorno una persona sola dalle 17 alle 19 mentre Rossini (11-15) aveva 6 ore
da assegnare e Buratta 2. Cause: `ritoccaScoperture` provava solo spostamenti di mezz'ora, e allungare di
mezz'ora un turno già coperto da un collega non cambia niente (il ritocco si fermava); inoltre girava dentro
`proponiSettimana`, prima dei passi che rimescolano i turni.
- `ritoccaScoperture` prova ogni posizione e ogni lunghezza fino alle ore libere della persona.
- `pianificaMese` fa un ultimo ritocco alla fine della settimana con il contratto vero (`candidati`, non il
  tetto più largo della copertura nelle settimane a cavallo), poi la copertura minima ricontrolla.
- Misura (novembre, 7 negozi senza ferie, variante senza weekend liberi), prima → dopo: ore con una persona
  sola Barberino 6 → 3, Palmanova 22 → 14,5, Franciacorta 4 → 0, Brugnato 4,5 → 2, Valmontone 27,5 → 26,
  Torino 13,5 → 15; sotto MODA Palmanova 37,8 → 30,3, Brugnato 13,4 → 8,2, Franciacorta 9,4 → 5,3,
  Valmontone 69,7 → 71,8, Torino 23,4 → 24,4. Nessuna mezz'ora vuota, nessun turno sotto le 4 ore.
