# Divise e acquisti dei dipendenti

Note di riferimento per chi tocca divise e acquisti: tabelle `employee_capi`, `employee_divise`,
`employee_divise_sconti`, `divise_impostazioni`, `divise_gestori`, `divise_registro`, il pulsante sul
telefono del negozio (`/timbra`), la sezione della scheda dipendente e la scheda «Divise» dell'app.
Migration `20261116_422_divise_e_acquisti.sql` (con `_ROLLBACK`).

## Decisioni di Patrizio (16/11/2026)

- **Tre voci**: «Divisa fornita dall'azienda» (la persona non paga), «Divisa con sconto»,
  «Acquisto personale». La parola «omaggio» non si usa mai.
- **La divisa** è un insieme libero di capi numerato dal sistema per ogni persona (Divisa 1, 2…).
  È tutta fornita o tutta con sconto, mai mista: i capi in più vanno come divisa con sconto.
- **Si registra solo il codice a barre del produttore**, niente nome dell'articolo.
- **Il «Prezzo outlet oggi» lo scrive la persona**: obbligatorio per divisa con sconto e acquisto,
  facoltativo per la fornita.
- **Due sconti per persona** (divise, acquisti): lo standard dell'azienda più uno personale che lo
  sostituisce. **Lo sconto si fissa sul capo alla registrazione** (`employee_capi.sconto_pct`):
  cambiarlo dopo non tocca i capi già registrati.
- **Sul telefono del negozio niente prezzo scontato, sconto o importi.**
- **Si entra solo con il proprio QR o con nome e PIN, e solo se si è entrate oggi e non ancora
  uscite.** Il pulsante è piccolo, in fondo, separato da quelli delle timbrature.
- **Chi gestisce**: solo l'elenco «Chi gestisce divise e acquisti» più il Super Advisor. Non l'HR in
  quanto tale. L'elenco lo modifica solo il Super Advisor. Le prime persone (Sabrina, Veronica) le
  inserisce Patrizio o chi lui indica, non il codice.
- **Chi gestisce può**: correggere il prezzo (niente lo blocca, resta scritto); segnare scaricato
  in MODA e addebitato, anche in blocco, e togliere il segno; cambiare gli sconti personali.
- **Registro che non si modifica**, badge nella lista dipendenti, scheda «Divise» nell'app.
- **Come si addebita**: ancora da decidere (busta paga, cassa…). Oggi il gestionale segna solo
  «addebitato».

## Calcoli

- Prezzo che vale = `prezzo_corretto` se c'è, altrimenti `prezzo_outlet`.
- Prezzo da pagare = arrotondato al centesimo di prezzo che vale × (100 − sconto) / 100; 0 per la
  fornita. Esempi nei test (`src/lib/divise.test.ts`): 50 € al 30% = 15 € di sconto e 35 € da
  pagare; 39,90 € al 30% = 27,93 €.
- Lo sconto fissato: personale della voce, altrimenti standard dell'azienda, altrimenti 0; NULL per
  la fornita.

## Sicurezza

- Le tabelle hanno RLS in **sola lettura** per chi gestisce (`divise_posso_gestire()`, stessa
  azienda). `authenticated` non ha permessi di scrittura: tutto passa dalle funzioni SECURITY
  DEFINER, che scrivono anche il registro.
- **Telefono del negozio** (`divise_timbratrice_apri`, `divise_registra`): l'identità si ricava
  riusando le funzioni delle timbrature. QR `NZT1` controllato con `timbrature_firma` e valido
  **10 minuti**, come per le timbrature, e **solo sul telefono del proprio negozio** (o di quello
  del turno di oggi): stessa regola del PIN, `timbrature_pin_del_negozio` (revisore sicurezza,
  16/11/2026: prima 15 minuti e su qualunque negozio). PIN `NZP1` con `timbrature_pin_del_negozio` e `timbrature_pin_controlla`: 5 errori bloccano
  il PIN come nelle timbrature. Per questo gli errori di QR e PIN tornano come `{errore}` e non
  come eccezione: un'eccezione annullerebbe il conteggio dei tentativi. Il negozio deve essere uno
  in cui il telefono può timbrare (`timbrature_puo_timbrare`).
- «Entrata oggi e non uscita» si legge in `attendance_punches`, giorno di Roma, timbrature non
  annullate: c'è un'entrata e l'ultima non è un'uscita.
- `divise_registra`: da 1 a 30 capi, lock per persona, divisa esistente solo se è della persona e
  dello stesso tipo, codici `^[0-9A-Za-z.\-]{4,40}$`, prezzi fra 0 e 100.000.
- **Ripetibile**: ogni «Conferma» del telefono porta un id (`p_richiesta`, generato una volta per
  conferma e riusato se si riprova dopo un errore di rete). La prima volta l'esito si salva in
  `divise_richieste`; la stessa richiesta che arriva di nuovo restituisce lo stesso esito con
  `ripetuta: true` e non scrive niente. Ogni capo porta `richiesta_id`. Una richiesta con lo stesso
  id ma di un'altra persona viene rifiutata.
- Gestione (`divise_capi_segna`, `divise_capo_correggi_prezzo`, `divise_capo_annulla`,
  `divise_sconti_persona_imposta`) e sconti standard (`divise_impostazioni_salva`, dalla migration
  423, Patrizio 17/11/2026: «sì, anche Sabrina e Veronica»): `divise_gestione_controlla()`. Elenco
  di chi gestisce (`divise_gestore_imposta`): solo Super Advisor. Un gestore non può
  essere `dipendente`, `operatore_cassa` o `viewer` (sola lettura: non gestisce mai, nemmeno se
  finisse nell'elenco).
- **Nessuno tocca i propri capi né i propri sconti**, Super Advisor compreso (`divise_non_proprio`:
  la persona collegata a chi chiama da `employees.user_id` o da `responsabile_dipendente`). Nella
  propria scheda le azioni non compaiono e una riga dice che li sistema un'altra persona.
- **Annullare un capo** registrato per sbaglio (`divise_capo_annulla`, motivo obbligatorio da 3 a
  300 caratteri): `annullato_il`, `annullato_da`, `annullato_motivo`, riga `capo_annullato` nel
  registro, **mai DELETE**. Il capo resta visibile barrato con il motivo e non conta più in
  contatori, etichette, importi da addebitare e app (dove compare barrato con «annullato»). Non si
  può correggere né segnare, e l'annullamento non si toglie: se serve si registra di nuovo dal
  telefono del negozio.
- Recinti RESTRICTIVE `cash_operator_block` e `dipendente_block` su tutte e 7 le tabelle (come la
  329), e `REVOKE ALL` da `PUBLIC`, `anon`, `authenticated` prima della sola SELECT: niente
  TRUNCATE o altri privilegi di default.
- Registro: trigger `trg_divise_registro_fermo` blocca UPDATE e DELETE.
- App: `app_dipendente_divise()` restituisce solo i capi della persona collegata
  (`timbrature_mio_dipendente()`).

## Frontend

- `src/lib/divise.ts` (calcoli puri, testati), `src/lib/diviseDb.ts` (chiamate).
- `src/components/TimbraDivise.tsx` (telefono del negozio: voce → divisa → lettura → conferma →
  fatto, chiusura dopo 30 secondi senza tocchi (10 sul «Fatto»; `onChiudi` tenuto in un ref perché
  Timbra si ridisegna ogni secondo: prima il conto alla rovescia ripartiva sempre e la sezione non
  si chiudeva, test in `TimbraDivise.test.tsx` con `happy-dom`), formati ean_13, ean_8, code_128, upc_a, upc_e e
  inserimento a mano), pulsante in `src/pages/Timbra.tsx`.
- `src/components/DiviseAcquistiPersona.tsx` (sezione della scheda), `ImpostazioniDivise.tsx`
  (Super Advisor), badge in `OrganicoOggi.tsx`, `src/components/app/AppDivise.tsx`.
- **Made**: le tabelle non ci sono. Ogni errore di lettura nasconde sezione, pulsante e scheda
  dell'app, senza messaggi.

## Dubbi aperti

- Un'entrata ancora in coda offline sul telefono del negozio non è nel database: finché non parte,
  il pulsante risponde «non risulta entrata».
- Un capo annullato non si «riattiva»: scelta voluta, semplice e tracciata.
