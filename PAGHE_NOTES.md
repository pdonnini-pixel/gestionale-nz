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
| Modello F24 «AAAA-MM in scadenza il 16-MM-AAAA (prog.N) tipo Ordinario» | la delega vera: moduli, saldi per sezione, IBAN di addebito | `payroll_f24_documents` + scadenza in `fiscal_deadlines` già disposta (migration 270) |
| Statistica costo orario (saltuaria) | lordo per persona | Costo lordo → dettaglio per dipendente |
| Situazione ratei ferie e permessi | saldi ferie | Ferie e permessi → Saldi dalle paghe (vedi `PIANO_FERIE_NOTES.md`) |

## A. Zona unica di caricamento

`src/components/CaricaFilePaghe.tsx`, in cima a Dipendenti. Riconosce il file con
`riconosciFilePaghe` (`src/lib/payrollParse.ts`): titolo, mese («Periodo di elaborazione»,
per il Prospetto l'ultimo mese di «Dal … Al …»), tipo di cedolino («Tipo cedolino Norm.»,
«mensilità aggiuntive» = 14ª a giugno, 13ª a dicembre). Senza testo (Excel) guarda il nome.

**Salva da solo** (dall'08/10/2026, regola fissa di Patrizio, vedi CLAUDE.md «Un caricamento arriva in fondo da solo»).
Prima la zona smistava e basta: serviva «Apri e controlla» e poi la conferma nell'anteprima.
L'08/10 Sabrina si è fermata al primo passo, la pagina si è ricaricata e settembre non è mai stato salvato, senza che niente lo dicesse.
Ora la zona porta ogni file fino in fondo, uno alla volta (i due flussi stanno in schede diverse):
- Elenco netti → `ImportLane.doImport`, Prospetto → `CostiLordoTab.confirmSave`, chiamati dal codice;
- prima di salvare si guarda il **database** (non la pagina): se per quel mese e cedolino ci sono già netti, o per quel mese c'è già costo lordo, il file li sostituirebbe e allora si chiede la conferma (anteprima aperta con «Cosa cambia»); si chiede anche se il totale letto non torna con quello del file;
- il flusso risponde alla zona con l'evento `paghe-esito` (`segnalaEsitoPaghe`): salvato, da confermare, errore. Un file che non risponde entro 3 minuti viene segnalato;
- alla fine la zona mostra «Finito, tutti i dati sono aggiornati» o cosa resta, e la pagina va sul mese dei file.
I Netti negativi si archiviano subito.

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

### Il modello F24 dello studio comanda (migration 270, 08/10/2026)

Il Prospetto dà solo una stima. Settembre 2026 NZ: Prospetto 32.715,42, modello 32.601,97.
La differenza era TAXBENEFIT 75,06 (codice 5096, si paga fuori dall'F24) e 38,39 di quote INPS
con periodo del mese dopo. Da qui tre regole:
- le voci con codice 5xxx del Prospetto (TAXBENEFIT, Azimut) sono canale `fondo`, non F24
  (`RE_CODICE_FUORI_F24` in `payrollParse.ts`);
- `fn_payroll_sync` conta solo le voci con `periodo` = mese del Prospetto: le piccole quote INPS
  del mese dopo non aprono più un controllo a sé;
- quando c'è il modello (`payroll_f24_documents`), l'atteso è il suo totale (`payroll_f24_checks.fonte = 'modello'`).

Lettura: `src/lib/modelloF24.ts` (`leggiModelloF24` sulle righe di `extractPdfLines`): un modulo
per pagina, saldo finale = somma dei saldi di sezione (ogni modulo si controlla da solo),
IBAN dalle lettere dopo «Autorizzo addebito su», periodo = mese prima della scadenza.
Settembre 2026: 10 moduli tutti in quadra, 32.601,97, MPS …621460.

Salvataggio: `save_payroll_f24_document(p_doc, p_conferma)` dalla zona unica, senza cambiare
scheda. Controlla che il codice fiscale sia dell'azienda, trova il conto dall'IBAN e crea la riga
in Scadenze fiscali «F24 ritenute e contributi dipendenti, <mese> <anno>» con importo, scadenza,
codici e la **disposizione già compilata** (data, conto, importo, nota «la banca la addebita da
sola, non va disposta a mano»): così è fra i pagamenti pianificati di Scadenzario e Tesoreria.
Se esiste già una F24 del personale con la stessa scadenza la completa invece di duplicarla.
Conferma solo se sostituirebbe un importo diverso o se un modulo non quadra. Quando in banca
arriva una sola delega che fa la cifra al centesimo, `fn_payroll_sync` chiude la scadenza
(`paid`, `bank_transaction_id`). In Fabbisogno la stima F24 di quel mese non si somma più.

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
