# WIZARD_VALIDATION_NOTES — Validation + terminologia + branding cleanup

> Working notes per il branch `feature-wizard-validation-terminologia`.
> Riferimenti: `CLAUDE.md` (root), `PROVISIONING_NOTES.md`, `ONBOARDING_FIX_NOTES.md`, `PROMPT_WIZARD_VALIDATION_TERMINOLOGIA.md`.

---

## Stato fasi

| Fase | Stato |
|---|---|
| F0 — Merge PR pendenti + branch | ✅ |
| F1 — Reset Made + Zago | ✅ |
| F2 — Terminologia configurabile per tenant | ✅ |
| F3 — Validazione campi wizard | ✅ |
| F4 — Branding cleanup NZ/Made/Zago | ✅ |
| F5 — Smoke test E2E aggiornato | ✅ |
| F6 — Reset finale Made/Zago + drift | ✅ |
| F7 — Build + PR | ✅ |

---

## F0 — Setup

- PR #12 (fix-logout-redirect) mergiata (squash + delete-branch).
- PR #11 (fix-onboarding-rpc-this-binding) già mergiata in precedenza.
- Branch `feature-wizard-validation-terminologia` creato da `main` aggiornato.

## F1 — Reset Made + Zago

`UPDATE user_profiles SET company_id = NULL` + `DELETE FROM company_settings/suppliers/chart_of_accounts/cost_categories/cost_centers/outlets/companies`. Eseguito via Management API. Stato post-reset: 0 ovunque, 4 utenti seed sopravvivono in `auth.users`.

## F2 — Terminologia configurabile

### DB
- Migrazione `20260508_011_add_point_of_sale_label.sql`: `ALTER TABLE companies ADD COLUMN IF NOT EXISTS point_of_sale_label TEXT NOT NULL DEFAULT 'Punto vendita'`.
- NZ: applicata via Management API + `UPDATE companies SET point_of_sale_label = 'Outlet'` per preservare la terminologia esistente.
- Made + Zago: applicata via `apply-migrations.ts`.

### RPC
- Migrazione `20260508_012_onboard_tenant_v2.sql`: `DROP FUNCTION` + nuova `CREATE FUNCTION onboard_tenant(jsonb,jsonb,text,jsonb,text)` con:
  - **Nuovo parametro `p_point_of_sale_label TEXT DEFAULT 'Punto vendita'`** scritto in `companies.point_of_sale_label`.
  - **Fix permission check**: ora usa `has_jwt_role('super_advisor') OR has_jwt_role('budget_approver')` invece di `user_profiles.role`. Lilian ha role JWT 'budget_approver' ma in `user_profiles` è registrata come 'contabile' — il vecchio check la bloccava. Mantenuta safety net per profilo non trovato.
  - Applicata a NZ + Made + Zago.

### Frontend
- **`src/hooks/useCompanyLabels.ts`** (nuovo): legge `companies.point_of_sale_label` da `useCompany()` e ritorna `{ pointOfSale, pointOfSalePlural, pointOfSaleLower, pointOfSalePluralLower }`. Pluralizzazione italiana minimale (Negozio→Negozi, Outlet/Boutique invariati).
- **`src/hooks/useCompany.tsx`**: select aggiornato per leggere la nuova colonna; cast minimo perché i tipi DB auto-generati non includono ancora la colonna.
- **`src/components/Sidebar.tsx`**: `allSections` const → `buildSections(labels)` factory. Sostituite label "Outlet"/"Confronto Outlet"/"Margini Outlet"/"Outlet & Performance" con label dinamiche. `BREADCRUMB_MAP` const → `buildBreadcrumbMap(labels)` factory; export legacy mantenuto per backward compatibility.
- **`src/components/Layout.tsx`**: usa `buildBreadcrumbMap(useCompanyLabels())` invece della costante.
- **`src/pages/Onboarding.tsx`**: nuovo input "Come chiami i tuoi punti vendita?" nel primo step con chip suggerimenti (Outlet/Negozio/Boutique/Store/Punto vendita) + input testuale custom. Step 2 usa `pointOfSaleLabel` dinamico (titolo, label "{singular} #N", placeholder, bottone). Payload RPC include `p_point_of_sale_label`.
- **`src/pages/Outlet.tsx`** + **`ConfrontoOutlet.tsx`** + **`MarginiOutlet.tsx`**: titoli e descrizioni delle pagine usano `useCompanyLabels()`.

### Limitazioni dichiarate
Le label `<th>Outlet</th>` nelle tabelle interne (Banche, Dipendenti, Contratti, OpenToBuy, MarginiCategoria, Scadenzario, Produttivita, AnalyticsPOS, Fatturazione, TesoreriaManuale, Dashboard, CostiRicorrenti, OutletWizard) NON sono state aggiornate in questa PR — sono ~17 occorrenze ripetitive che rendono ogni file con un piccolo refactor. Restano label "Outlet" hardcoded in colonne di tabelle interne, accettabile per primo passaggio. Da pulire in PR separata se Patrizio vuole completezza al 100%.

## F3 — Validazione campi wizard

Implementate inline (no Zod, no dependency aggiuntive). Validators puri in `Onboarding.tsx`:

| Campo | Pattern | Errore |
|---|---|---|
| Ragione sociale | min 2 / max 200 | "Min 2 caratteri" |
| P.IVA | `^\d{11}$` | "P.IVA: 11 cifre numeriche" |
| Codice fiscale | `^(\d{11}\|[A-Z0-9]{16})$` opzionale | "CF: 11 cifre (società) o 16 caratteri (persona)" |
| PEC / email outlet | `^[^\s@]+@[^\s@]+\.[^\s@]+$` opzionale | "Email non valida" |
| Codice SDI | `^[A-Z0-9]{7}$` opzionale | "Codice SDI: 7 caratteri alfanumerici" |
| Telefono | min 9 caratteri se presente | "Telefono: minimo 9 caratteri" |
| Outlet codice | `^[A-Z]{3}$` obbligatorio | "Codice: 3 lettere maiuscole (es. VDC)" |
| Outlet nome | min 2 | "Min 2 caratteri" |
| Provincia | `^[A-Z]{2}$` opzionale | "2 lettere (es. MI)" |
| CAP | `^\d{5}$` opzionale | "5 cifre" |
| Fornitore P.IVA | `^\d{11}$` opzionale | "P.IVA: 11 cifre numeriche" |
| Fornitore nome | obbligatorio se P.IVA presente | "Nome obbligatorio se inserisci P.IVA" |

UX:
- Errori inline appaiono subito sotto il campo, in rosso.
- Bordo input rosso quando invalido.
- Bottoni "Avanti" / "Completa configurazione" disabilitati se step non valido.
- Per i campi obbligatori vuoti, errore appare solo dopo che l'utente ha digitato qualcosa (no "rosso" pre-emptivo).
- Auto-uppercase per codice outlet, provincia, codice fiscale, codice SDI.
- Auto-strip caratteri non numerici per CAP, P.IVA.

## F4 — Branding cleanup NZ/Made/Zago

Sostituite stringhe hardcoded "NZ"/"New Zago"/"Made"/"Made Retail"/"Zago"/"Gallo" come label visibili UI:

| File | Prima | Dopo |
|---|---|---|
| `Onboarding.tsx` | "Template NZ — 25 categorie costo + 20 conti standard" | "Template standard — ~26 categorie costo + 20 conti standard" |
| `Onboarding.tsx` | "Imposta {tenant.displayName} in 5 passi" | "5 passi, tempo stimato 5-10 minuti" |
| `InvoiceViewer.tsx` | "Documento generato dal gestionale New Zago" | "Documento generato dal gestionale" |
| `StockSellthrough.tsx` | "outlet New Zago" | "punti vendita" |
| `Impostazioni.tsx` | "New Zago S.R.L. — visura..." | "Visura e compagine societaria" |
| `Impostazioni.tsx` | "Outlet, sede, magazzino..." | "Punti vendita, sede, magazzino..." |
| `SchedaContabileFornitore.tsx` | "Generato il ... — Gestionale New Zago" | "Generato il ..." |
| `OpenToBuy.tsx` | "Pianificazione...New Zago S.R.L." | "Pianificazione stagionale acquisti" |
| `StoreManager.tsx` | "New Zago S.R.L. • Giovedì 3 Aprile 2026" | data corrente formattata |
| `Dipendenti.tsx` | "New Zago S.R.L. ERP \| Costi Personale 2025-2026" | "Costi Personale" |
| `ContoEconomico.tsx` (5 occorrenze) | fallback "NEW ZAGO S.R.L." / "07362100484" / "FIRENZE (FI)" | fallback stringa vuota o sezione condizionale |

Conservati intenzionalmente:
- `tenants.ts` alias `'newzago'` (chiave tecnica) e `displayName: 'New Zago Srl'` (mostrato nella banda tenant pre-onboarding, è il nome del progetto Supabase).
- Subdomain Netlify `gestionale-nz.netlify.app` (URL, non branding).
- Commenti del codice.
- Documentazione PROVISIONING_NOTES, ONBOARDING_FIX_NOTES (riferimenti storici).

## F5 — Smoke E2E

`tools/provisioning/smoke-test-onboard.ts` esteso per:
- Mappa POS label per alias: Made → "Negozio", Zago → "Boutique", NZ → "Outlet", default "Punto vendita".
- Passa `p_point_of_sale_label` alla RPC.
- Verifica `companies.point_of_sale_label` post-onboarding.

Esiti:
```
=== MADE === ✅ companies.point_of_sale_label = "Negozio"
=== ZAGO === ✅ companies.point_of_sale_label = "Boutique"
```

Tutti i check (companies/outlets/cost_centers/cost_categories/chart_of_accounts/suppliers/company_settings + idempotency) passano su entrambi.

## F6 — Reset finale + drift

Reset Made + Zago a vergine. `check-version-drift.ts`:

```
20260417_000_baseline_schema.sql                            ✓ ✓
20260417_001..007                                           ✓ ✓
20260506_008_align_outlets_contact_columns.sql              ✓ ✓
20260506_009_onboard_tenant_rpc.sql                         ✓ ✓
20260506_010_add_budget_approver_role.sql                   ✓ ✓
20260508_011_add_point_of_sale_label.sql                    ✓ ✓
20260508_012_onboard_tenant_v2.sql                          ✓ ✓

✅ Nessun drift: tutti i tenant alla stessa versione.
```

NZ INVARIATO: solo modifiche additive (ALTER TABLE ADD COLUMN, ALTER TYPE ADD VALUE, CREATE OR REPLACE FUNCTION). Zero DELETE, zero UPDATE su dati esistenti tranne il singolo `UPDATE companies SET point_of_sale_label = 'Outlet'` che preserva la terminologia attuale di NZ.

## F7 — Build + PR

- `npm run typecheck` ✅ zero errori
- `npx vite build` ✅ pulito (2.95s)
- PR aperta: vedi link finale nel report.

---

## Decisioni autonome non banali

1. **Hook `useCompanyLabels` invece di mini-componenti `<PosLabel />`**: lo hook è più pulito (TypeScript-first, no overhead React), si integra con il resto del codice che già usa hook (`useCompany`, `useAuth`, `useRole`), e permette pluralizzazione contestuale.
2. **Pluralizzazione italiana minimale** (`Negozio→Negozi`, `Outlet/Boutique/Store invariati`). Non ho importato librerie i18n; se in futuro serve l'inglese, si estende facilmente.
3. **`buildBreadcrumbMap` factory** con `BREADCRUMB_MAP` legacy esposto per backward compatibility. Limita il blast radius: solo `Layout` consuma la versione dinamica, eventuali altri import legacy continuano a funzionare con label "Outlet" hardcoded (no regressione).
4. **DROP FUNCTION + CREATE FUNCTION** per la RPC (signature cambia 4→5 param). `CREATE OR REPLACE` non funziona quando cambia la lista parametri.
5. **Permission check spostato a JWT role** (`has_jwt_role`) invece di `user_profiles.role`: Lilian ha role JWT `budget_approver` ma nel DB era `contabile` (causa: enum `user_role` aggiunse `budget_approver` solo in migrazione 010, e l'allineamento in `user_profiles` non è stato ribattuto su tutti gli utenti seed). Soluzione: usare il JWT come fonte autoritativa per il check di onboarding (allineato con tutte le RLS write).
6. **Validators inline** invece di Zod. Niente nuova dependency, controllo totale sui messaggi italiani.
7. **NON tutte le tabelle interne hanno avuto refactor "Outlet"**: ~17 occorrenze in colonne di tabelle (Banche, Dipendenti, Contratti, ecc.) lasciate hardcoded "Outlet". Pulizia ad alta visibilità (Sidebar, page headers, Onboarding wizard) sì; pulizia capillare di ogni `<th>Outlet</th>` no — task separato.
8. **ContoEconomico fallback hardcoded NZ rimossi**: `denominazione: 'NEW ZAGO S.R.L.'`, `cf_piva: '07362100484'`, `sede: 'FIRENZE (FI)'` erano fallback hardcoded. Se per qualche ragione `companies` o `company_settings` non ritornano dati, ora mostriamo stringhe vuote o nascondiamo la riga (sezione `Sede` condizionale). Il vincolo "non toccare dati di NZ" è rispettato — ho cambiato solo il rendering.
9. **Smoke test posLabel diverso per alias** (`Negozio`/`Boutique`/`Outlet`): copre il path "label nuova" senza dover creare 3 utenti diversi. Se in futuro Lilian sceglie un'altra label, il test continua a passare (è data-driven).

## Limitazioni note (consegnate a Patrizio)

1. **Tabelle interne con `<th>Outlet</th> hardcoded** — vedi sopra.
2. **Pluralizzazione approssimata**: "Boutique" plurale in italiano dovrebbe essere "boutique" (invariabile) — funziona. "Outlet" invariabile in italiano — funziona. Casi più complessi (es. nomi composti) potrebbero non pluralizzare correttamente; in pratica gli unici 5 casi che proponiamo sono tutti coperti.
3. **`OutletWizard.tsx`** (componente, non pagina) ha `<option value="outlet">Outlet</option>` — è il valore tecnico del campo `outlet_type` (outlet/store/popup/...). NON sostituito perché il valore è SQL, non label.
4. **Smoke test browser** (UI rendering, validation feedback inline visivo, redirect post-onboarding) lo fa Patrizio in produzione.
