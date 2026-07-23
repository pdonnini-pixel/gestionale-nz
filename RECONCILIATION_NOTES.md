# RECONCILIATION_NOTES — regole di riconciliazione banca ↔ fatture/scadenze

> Regole fissate da Patrizio (sessione 2026-07-23). Valgono sempre, sono **granitiche
> e automatiche**: il motore le applica a ogni nuovo movimento (trigger) e ogni notte
> (cron `reconcile-recurring-daily`, 05:45 UTC → `run_daily_reconciliation()`).
> Principio guida: **mai essere approssimativi; quando c'è dubbio, proporre (non
> chiudere a forza); quando è certo, chiudere da soli senza chiedere conferma.**

## Regole (tutte additive/reversibili — mai DELETE)

1. **Verifica SEMPRE anche le fatture chiuse a mano.** Ogni movimento va confrontato
   non solo con le fatture aperte ma anche con quelle `pagato` + `closed_manually`
   senza `bank_transaction_id` (il bonifico che le ha pagate è rimasto orfano).
   → `try_match_bank_transaction` (trigger).

2. **Casi granitici = auto, non si conferma il certo.** Se la causale cita fornitore
   + numero/i fattura e l'importo (o la somma) è esatto, si riconcilia da solo —
   singolo o **raggruppato** (1 bonifico → N fatture, es. Sforazzini 466,95 =
   5421+5422). → `try_match_group_bank_transaction` (trigger).

3. **Note di credito in causale.** Se la causale cita fattura + NC (contesto
   "nc"/"nota"), si sommano fattura − NC e si chiude tutto insieme **solo se il netto
   è esatto**. I casi che non tornano restano manuali. → `try_match_group_bank_transaction`.

4. **Movimenti `booked` = validi.** L'Open Banking A-Cube consegna status `booked`
   (non `posted`): il motore processa entrambi (escluso `pending`).

5. **Costi ricorrenti a importo fisso (Trenitalia/Telepass/UnipolTech/NEXI/SPM…):**
   abbinamento **biettivo 1-a-1 per data**. Per ogni fattura si prende il movimento
   dello stesso fornitore (nome/P.IVA in causale), stesso importo, con la **data più
   vicina**, senza mai riusare fattura o movimento. Se ci sono più movimenti che
   fatture, gli extra restano non riconciliati. Mai la stessa fattura proposta N volte
   (dedup). → `rerun_bijective_reconciliation` (cron) + dedup lato frontend.

6. **Solo casi certi in auto; gli incerti si propongono.** Le proposte (`to_confirm`)
   restano nel tab Riconciliazione ("Abbinamenti suggeriti" / "Da verificare"), da
   confermare una per una. Non abbinare mai per solo-importo senza nome/numero.

7. **Movimenti NON-fornitore → chiusi (non serve fattura).** Commissioni/oneri banca,
   carte/POS/prelievi, giroconti, F24/imposte, stipendi (emolumenti) si marcano
   `is_reconciled=true` (categoria valorizzata). **Esclusi**: `A FAVORE` (bonifici
   fornitore), `EFFETTI RITIRATI` (RiBa = fornitore), `RIMBORSO FINANZIAMENTI/MUTUI/
   PRESTITI`, `ASSEGNO` → restano per l'abbinamento a fattura.
   → `close_non_supplier_movements` (cron).

8. **Scadenze fiscali/paga pagate a GRUPPI.** Una scadenza (14ª/13ª mensilità,
   stipendi, F24) può essere saldata da **più movimenti individuali** — es. la 14ª
   pagata ai **singoli dipendenti** (N disposizioni EMOLUMENTI che sommano
   all'importo). Nel verificare se una scadenza è pagata, cercare **anche il gruppo
   di movimenti che somma** all'importo, non solo il bonifico unico. Si chiudono in
   automatico solo le scadenze **già scadute** con pagamento riscontrato (singolo o a
   gruppo). Le future restano aperte. → `close_paid_fiscal_deadlines` (cron).

## Doppioni fatture (import ripetuti go-live/SDI)
Marcati `payables.is_placeholder = true` (NON cancellati): invisibili a scadenzario
(vista `v_payables_operative`) e al motore. Regola di marcatura: per cluster
fornitore + numero + importo arrotondato all'euro si tiene una riga (priorità:
con movimento > pagata > chiusa a mano > più vecchia). Backup in
`payables_dup_backup_20260723`. Reversibile: `is_placeholder=false`.

## Funzioni chiave (public)
- Trigger INSERT: `trg_auto_reconcile_bank_transaction` → prova `try_match_group_*`
  (granitico/NC) poi `try_match_bank_transaction` (a punteggio).
- Cron giornaliero: `run_daily_reconciliation()` = `rerun_group_reconciliation` +
  `rerun_bijective_reconciliation` + `close_non_supplier_movements` +
  `close_paid_fiscal_deadlines`.
- Manuali: `reconcile_movement`, `reconcile_movement_group`, `undo_reconcile_movement`.

Tutto è reversibile e non distruttivo. Ogni funzione va replicata sui 3 tenant
(NZ + Made + Zago) — vedi REGOLA #0 in CLAUDE.md.
