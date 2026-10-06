# Paghe: i file dello studio, i pagamenti e gli F24

> Da leggere prima di toccare Dipendenti → Costi & cedolini / Costo lordo, le tabelle
> `employee_cost_slips`, `personnel_gross_cost*`, `payroll_*` o il riquadro «Pagamenti in banca».
> Fissato il 05/10/2026 (richiesta di Patrizio: «fai A, B, C e D»).

## Cosa manda lo studio ogni mese

Tutti PDF di Zucchetti «Paghe Infinity», con il testo leggibile:

| Documento | Cosa c'è | Dove va |
|---|---|---|
| Elenco netti (mensilità normale) | netto per persona, filiale, IBAN | Costi & cedolini → buste paga (`employee_cost_slips`, tipo normale) |
| Elenco netti (mensilità aggiuntive automatiche) | la 14ª a giugno, la 13ª a dicembre | stesse buste, tipo quattordicesima / tredicesima |
| Netti negativi | chi quel mese deve restituire | **non si importa** (scelta): si archivia |
| Prospetto riepilogativo «Dal … Agg.1 al … Norm.» | costo per filiale + riepilogo dei versamenti | Costo lordo (`personnel_gross_cost`) + voci F24 (`payroll_f24_items`) |
| Statistica costo orario (saltuaria) | lordo per persona | Costo lordo → dettaglio per dipendente |
| Situazione ratei ferie e permessi | saldi ferie | Ferie e permessi → Saldi dalle paghe (vedi `PIANO_FERIE_NOTES.md`) |

## A. Zona unica di caricamento

`src/components/CaricaFilePaghe.tsx`, in cima a Dipendenti. Riconosce il file con
`riconosciFilePaghe` (`src/lib/payrollParse.ts`): titolo, mese («Periodo di elaborazione»,
per il Prospetto l'ultimo mese di «Dal … Al …»), tipo di cedolino («Tipo cedolino Norm.»,
«mensilità aggiuntive» = 14ª a giugno, 13ª a dicembre). Senza testo (Excel) guarda il nome.

**Smista, non salva**: apre il file nel flusso che c'era (ImportLane netti, anteprima
Prospetto) con mese e cedolino impostati. Anteprima e conferma restano a chi carica: il
carico dei netti è una sostituzione del mese con il riquadro «Cosa cambia», e non va
saltato. I Netti negativi si archiviano subito.

## B. Stipendi pagati ↔ buste paga

Misurato su NZ: le disposizioni «DISPOSIZ.PER EMOLUMENTI» del 10 del mese portano in causale
`ID FLUSSO CBI`, `NUM. TOT. PAGAMENTI`, `IMPORTO BONIFICI`, `IMPORTO COMMISSIONI`. L'importo
dei bonifici è uguale **al centesimo** ai netti del mese prima di una filiale (la sede può
essere in due disposizioni). Le commissioni sono circa 1,75 € a bonifico: per questo
«pagato in banca» supera i netti (settembre 2026: 66.729,39 contro 66.655,39, +74,00).

Motore: `fn_payroll_sync` (migration 268), tabella `payroll_payment_links` (una riga per
busta pagata). Giro 1 dentro la filiale (prima filiale + tipo di cedolino, poi filiale);
giro 2 fra le buste rimaste del mese (sottoinsieme fino a 16 buste, o esattamente
`NUM. TOT. PAGAMENTI` buste fino a 30). Due combinazioni equivalenti = nessun aggancio.

Gira: ogni mattina (cron `payroll-sync-daily`, 07:20 UTC = 09:20 ora di Roma d'estate),
dopo ogni import dei netti, dopo ogni Prospetto, col pulsante «Ricontrolla ora».

Primo giro su NZ (06/10/2026): 268 buste agganciate; marzo, maggio, luglio, agosto e la
14ª di giugno complete al centesimo. Restano fuori 9 buste di aprile e 9 di giugno: sono
disposizioni con più bonifici che buste (una persona pagata in due bonifici), il caso del
foglio Prima nota. Troppo vecchie per una domanda.

Il foglio «Dipendenti ed emolumenti» della Prima nota fa ancora il suo abbinamento al volo
(`src/lib/primaNotaStipendi.ts`): stessa regola, risultati uguali sui mesi pieni.

## C. F24 del personale

Il «RIEPILOGO IMPORTI A DEBITO/CREDITO» del Prospetto dice cosa versare, a chi e per quale
«Periodo versamento». Lettore: `rigaVersamento` / `parseProspettoPaghe().versamenti`.
Canale `f24`: INPS (9001), EBINTER (9540), Fondo EST (9660), IRPEF anticipata, addizionali
(si prende la riga «Totale addizionale …», non il dettaglio per comune). Canale `fondo`:
fondi pensione (Azimut 5108, trimestrale), pagati fuori dall'F24.

Agosto 2026 NZ: F24 atteso 33.305,93 (INPS 23.739,31, EBINTER 85,40, EST 150,00, IRPEF
8.529,85, regionale 573,76, comunale 227,61). In banca il 16/09: 4 deleghe per 66.911,64
(dentro c'è anche altro: IVA, ritenute). Nessuna combinazione fa la cifra esatta: esito
«pagato con altre voci» (coperto).

`save_payroll_f24_items` salva le voci al momento della conferma del Prospetto. **Non
cancella**: ricaricare lo stesso mese aggiunge una versione (`batch_id`), conta l'ultima.
(Nota tecnica: il connettore Supabase chiede conferma per ogni `DELETE` anche dentro una
funzione e va in timeout; la versione è anche più prudente.)

`payroll_f24_checks`: atteso, scadenza (16 del mese dopo il periodo, sabato e domenica al
lunedì), deleghe in banca fra scadenza −3 e +7 giorni, esito `pagato` (combinazione esatta),
`pagato_con_altre_voci` (coprono), `in_attesa`, `da_chiarire`.

Vale dai Prospetti caricati dopo il 05/10/2026: i Prospetti già in archivio non hanno le voci
salvate (non si rielaborano i dati vecchi). Ricaricando un Prospetto vecchio le voci arrivano.

## Domande in chat (R28)

Nel riquadro «Da chiarire» di Banche → Documenti banca, solo se servono a un pagamento vero e
solo una persona può saperlo:
- `stipendio_non_abbinato`: disposizione degli ultimi 60 giorni che nessun gruppo di buste
  spiega, solo se le buste del mese prima sono già caricate (altrimenti manca un caricamento,
  non un'informazione);
- `buste_non_pagate`: una filiale intera senza pagamento mentre le altre sono pagate, dopo il
  25 del mese dopo (una busta sola no: contanti, assegno, pagamento a parte);
- `f24_paghe`: deleghe assenti o sotto la cifra 5 giorni dopo la scadenza (compensazione?).

## Cosa non fa

Non tocca `bank_transactions` (le disposizioni restano chiuse come «stipendi», migration 186),
non tocca le buste paga né il costo lordo. Aggiunge solo righe nelle tabelle `payroll_*`.
Rollback: `20261005_268_paghe_pagamenti_e_f24_ROLLBACK.sql`.
