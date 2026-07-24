# AI Categorie — Piano di backfill categorie storiche

Sessione 2026-07-24. Collega il mondo "legacy" a quello dei report per categoria.

## Problema

La pagina **AI Categorie** e i report che leggono `cash_movements.cost_category_id`
(Conto Economico → vista cassa, Margini per Categoria, Costi Ricorrenti) oggi
ricevono **zero** dato: su NZ, `cost_category_id` è NULL su **tutti i 9.212 movimenti**
(nessuna categoria è mai stata confermata). Il dato categoria "storico" vive invece
nel campo **legacy `category`** (1.504 righe), una tassonomia a slug di un vecchio
import, che i report **non leggono**.

Obiettivo: popolare `cost_category_id` a partire dallo storico, così i report si
riaccendono, senza perdere né alterare dati (regola NO DATA LOSS).

## Decisioni (Patrizio, 2026-07-24)

| Tema | Decisione |
|---|---|
| Modalità | **Conferma diretta**: scrive `cost_category_id` (report accesi subito) |
| Slug `tasse` (694k) | **Creare categoria "Imposte e tasse"** (migration 111) |
| Slug `spese_banca` (383k) | **Split per descrizione** (solo le vere spese bancarie) |
| Slug `giroconti` (236k) | **Escludere** (trasferimenti tra conti, non costi) |

## Mappatura (verificata su NZ)

### Fase 2 — backfill automatico (migration 112), solo USCITE

| slug legacy | mov. | € | → categoria |
|---|---:|---:|---|
| `stipendi` | 162 | 864.883 | Personale dipendente |
| `tasse` | 101 | 694.428 | Imposte e tasse *(nuova)* |
| `carte` | 184 | 45.191 | Commissioni carte e varie |
| `fees` | 21 | 8.996 | Commissioni carte e varie |
| `utilities` | 6 | 5.188 | Energia elettrica e gas |
| `real_estate` | 1 | 854 | Locazione outlet |
| `transport` | 1 | 138 | mezzi e carburante |
| `contractors` | 1 | 75 | Consulenze tecniche |
| `spese_banca` *(parte spese vere)* | ~490 | ~130.000 | vedi split sotto |

**Split di `spese_banca`** (è un calderone: 557 mov, controparte sempre vuota):
- descrizione `imposta di bollo` / `imp. bollo` → **Imposte e tasse**
- descrizione `interessi e competenze` → **Interessi passivi**
- descrizione `commissioni…` / `pagobancomat` / `transato` / `oneri e commissioni` /
  `pagamento bollettini` → **Commissioni carte e varie**

### Fase 3 — gestione manuale (NON toccati dal backfill)

| cosa | mov. | € | perché a mano |
|---|---:|---:|---|
| `giroconti` | 17 | 236.651 | trasferimenti tra conti, **non** costi → esclusi |
| `spese_banca` bonifici (`bonifico%`, `causale: disposizione%`) | ~65 | ~255.000 | **pagamenti a controparti mascherati** da "spese banca": vanno categorizzati per beneficiario/fornitore, non come oneri bancari |
| `financials` (uscita) | 14 | 27.904 | composizione incerta, da rivedere |
| `storage`, `loans` (uscita) | 2 | ~1.500 | ambigui / rimborso finanziamento |
| tutte le **entrate** (`income` 362k, ecc.) | — | — | i ricavi hanno già la loro fonte (daily_revenue): non toccare per evitare doppi conteggi |

## File

1. `supabase/migrations/20260724_111_add_category_imposte_tasse.sql` (+ `_ROLLBACK`)
2. `supabase/migrations/20260724_112_backfill_cost_category_from_legacy.sql` (+ `_ROLLBACK`)

Il backfill risolve la categoria **per nome** e per `company_id`, riempie **solo**
`cost_category_id IS NULL` (additivo) e crea una **tabella di backup**
`_backup_cash_movements_cat_20260724` per il rollback puntuale.

## Come applicare (PATRIZIO — su TUTTI E 3 i tenant)

Ordine obbligatorio: **111 prima**, **112 poi**.

**Prima di 112, ricognizione per tenant** (Made/Zago possono avere slug diversi):
```sql
SELECT category, type, count(*) FROM cash_movements
WHERE category IS NOT NULL GROUP BY category, type ORDER BY 1,2;
```
Se compaiono slug non previsti in mappatura, fermarsi e segnalare.

Per ogni tenant (NZ `xfvfxsvqpnpvibgeqpqp`, Made `wdgoebzvosspjqttitra`,
Zago `jxlwvzjreukscnswkbjx`):
1. Dashboard Supabase → progetto → **SQL Editor**.
2. Incolla ed esegui `20260724_111_add_category_imposte_tasse.sql`.
3. Incolla ed esegui `20260724_112_backfill_cost_category_from_legacy.sql`.
4. Esegui le **query di verifica** in coda al file 112 e controlla i totali.
5. Verifica su gestionale-nz.netlify.app che Conto Economico (vista cassa) e
   Margini per Categoria mostrino i valori.
6. Quando tutto torna, esegui `DROP TABLE _backup_cash_movements_cat_20260724;`
   (finché non lo fai, il rollback resta disponibile).

Se qualcosa non torna: esegui il `_ROLLBACK` del 112 (ripristina lo stato esatto),
poi eventualmente il `_ROLLBACK` del 111.

## Note

- **Reversibile**: il backup fotografa lo stato pre-modifica; il rollback ripristina
  1:1. Nessun DELETE su dati vivi.
- **F24 / `tasse`**: la categoria "Imposte e tasse" è un contenitore unico; gli F24
  reali sono misti (IVA/ritenute/contributi/imposte) — affinamento possibile in futuro.
- **`spese_banca`-bonifici**: è il residuo più importante (255k). Non è una spesa
  bancaria: è la spia che un vecchio import ha etichettato male dei pagamenti. Andrà
  ricategorizzato per controparte, idealmente agganciandolo alla riconciliazione
  fornitori.
