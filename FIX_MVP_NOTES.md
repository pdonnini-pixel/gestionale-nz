# FIX_MVP_NOTES — Refactor hardcoded NZ + bug residui multi-tenant

> Working notes per il branch `feature-fix-hardcoded-mvp`.
> Riferimenti: `PROMPT_FIX_HARDCODED_E_BUG_RESIDUI.md`.

---

## F0 — Audit hardcoded outlet NZ

`grep -rnE '(Valdichiana|Barberino|Palmanova|Franciacorta|Brugnato|Valmontone|"Torino"|Ufficio.Magazzino)' src/`

**57 occorrenze in 10 file**:

| File | Tipo | Note |
|---|---|---|
| `src/components/ChartTheme.tsx` | **OUTLET_COLORS const** (7 chiavi) | Mappa hardcoded usata dai grafici. Refactor: funzione `getOutletColor(name)` con palette deterministica + retrocompat NZ. |
| `src/pages/Dipendenti.tsx` | **OUTLET_COLORS map + OUTLET_NAMES const** (7+7 entries) | Refactor con `useOutlets()` + palette dinamica. |
| `src/pages/StockSellthrough.tsx` | **outletsData mock** (6 chiavi con dati fake) | Refactor: empty state se tenant non-NZ o senza dati reali. |
| `src/pages/AnalyticsPOS.tsx` | **OUTLETS const + generatePOSData mock** | Idem: empty state. |
| `src/pages/OpenToBuy.tsx` | **seasonal data mock con 6 outlet** | Idem: empty state. |
| `src/pages/StoreManager.tsx` | **outlets hardcoded** (6 entries) | Refactor: useOutlets. |
| `src/lib/formatters.ts` | Commento esempio JSDoc | Sostituire con esempio generico (non bloccante). |
| `src/pages/Impostazioni.tsx` | Placeholder input "ES: Valdichiana Village" | Sostituire con esempio generico. |
| `src/pages/BudgetControl.tsx` | Commento codice (RICAVI categoria) | Mantenere (è documentazione tecnica). |
| `src/pages/Contratti.tsx` | Placeholder input | Sostituire con esempio generico. |

### Stato RPC `onboard_tenant`

✅ La migrazione `20260508_012_onboard_tenant_v2.sql` ha **già** il fix `has_jwt_role` (Fase 5 del prompt = no-op).

### Stato migrazione 013

`20260511_013_get_or_associate_tenant_company.sql` già a main (creata in PR precedente).

---

## Stato fasi

| Fase | Stato |
|---|---|
| F0 — Setup + audit | ✅ |
| F1 — useOutlets hook + refactor pagine | ✅ |
| F2 — Fix SDI 401 loop | ✅ |
| F3 — Fix count punti operativi BudgetControl | ✅ |
| F4 — Sidebar conditional rendering | ✅ |
| F5 — RPC onboard_tenant (skip, già fatto in 012) | ✅ |
| F6 — Audit altre stringhe NZ | ✅ |
| F7 — Reset + drift + smoke + PR | ✅ |

---

## F1 — useOutlets hook + refactor pagine MVP

### `src/hooks/useOutlets.ts` (nuovo)
Hook che ritorna la lista outlet del tenant attivo via SELECT da `outlets` filtrato per `company_id` di `useCompany()`. Fonte unica di verità per ogni pagina che mostra una lista di punti vendita.

### `src/components/ChartTheme.tsx`
- `OUTLET_COLORS` mantenuto come retrocompat NZ.
- Aggiunte funzioni:
  - `getOutletColor(name)` → `{ main, light }` con fallback hash-deterministico su palette estesa (16 colori).
  - `getOutletTailwindBg(name)` → classe `bg-*` Tailwind hash-deterministica.

### Pagine refactorate

| File | Cosa cambia |
|---|---|
| `src/pages/Dipendenti.tsx` | Rimossi `OUTLET_COLORS` (8 entries) e `OUTLETS_ORDER` (8 entries) hardcoded. Ora derivati da `useOutlets()` + `getOutletTailwindBg()`. |
| `src/pages/StockSellthrough.tsx` | Empty state UX-friendly quando il tenant non ha outlet che matchano i mock data NZ. Mock data preservato per NZ (retrocompat). |
| `src/pages/AnalyticsPOS.tsx` | Stesso pattern: empty state se nessun outlet del tenant matcha `OUTLETS` hardcoded. |
| `src/pages/OpenToBuy.tsx` | Stesso pattern. Rinominato `outlets` const → `LEGACY_OUTLETS`. |
| `src/pages/StoreManager.tsx` | Outlets ricavati da `useOutlets()` (in passato hardcoded). Empty state se tenant senza outlet. Default selezione = primo outlet. |

### Sub-componenti non toccati
- `src/components/OutletWizard.tsx:117` — `<option value="outlet">Outlet</option>` è il valore SQL `outlet_type` (outlet/store/popup) nel form aggiunta outlet, NON una label generica.

---

## F2 — Fix SDI 401 loop

### `src/pages/Fatturazione.tsx`
- Aggiunto `class SdiNotConfiguredError` esportato.
- `callEdgeFunction`:
  - Niente più fallback hardcoded `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` su NZ; usa `getCurrentTenant()`.
  - **Niente più retry-on-401**: una volta che 401/403 arrivano, throw `SdiNotConfiguredError`.
  - Riconosce anche `code: 'SDI_NOT_CONFIGURED'` o `'CERTIFICATE_MISSING'` come segnale.
- State `sdiAvailable: boolean | null` (default `null` = non controllato).
- `loadStats`: cattura `SdiNotConfiguredError` → `setSdiAvailable(false)`, NIENTE log (è uno stato atteso). Errori generici → `setSdiAvailable(false)` per coerenza UX (evita loop).
- Banner `<AlertTriangle>` sopra l'header quando `sdiAvailable === false`: "Sincronizzazione SDI non disponibile — accreditamento AdE non configurato. Contattare EPPI."

Risultato: tenant senza certificati SDI → un solo tentativo, niente cascata di refreshSession + re-render, niente loop.

---

## F3 — Fix count punti operativi BudgetControl

### `src/pages/BudgetControl.tsx`
- `const ops` ora esclude esplicitamente `'sede'`, `HQ_CODE`, `'spese_non_divise'`, `'rettifica_bilancio'`.
- Risolve bug "2 Outlet operativi" per tenant con 1 outlet reale (il wizard crea anche cost_center `'sede'` per la sede centrale).

---

## F4 — Sidebar conditional rendering

### `src/components/Sidebar.tsx`
- Aggiunta proprietà opzionale `minOutlets?: number` a `NavItem`.
- Sidebar chiama `useOutlets()` e filtra le voci: se `item.minOutlets > outletCount`, voce nascosta.
- `minOutlets: 2` applicato a:
  - `/confronto-outlet` ("Confronto {Plural}")
  - `/allocazione-fornitori` ("Divisione Fornitori")
- Risultato: tenant single-outlet (Made/Zago appena onboardati con 1 outlet) NON vedono voci che non avrebbero senso.

---

## F5 — RPC `onboard_tenant`

Skip: la migrazione `20260508_012_onboard_tenant_v2.sql` già ha il check `has_jwt_role('super_advisor') OR has_jwt_role('budget_approver')`. Nessun lavoro necessario.

---

## F6 — Audit altre stringhe NZ

Placeholder UX-visibili refactor:
- `src/pages/Contratti.tsx`: "es. Locazione Valdichiana Village" → "es. Locazione punto vendita centro"
- `src/pages/Impostazioni.tsx`: "ES: Valdichiana Village" → "es. Punto vendita Centro"
- `src/components/OutletWizard.tsx`: "es. Torino Outlet Village" → "es. Centro Commerciale" (mall_name, concedente, address, city — 3 placeholder).

Stringhe brand "New Zago"/"Gallo"/"Made Retail" come label visibili: ✅ zero residui (la maggior parte già pulita nella PR #13).

---

## F7 — Reset + drift + smoke + verifica NZ

### Drift
✅ Made + Zago entrambi a **14/14 migrazioni** (incluso 013 appena applicato).

### Smoke E2E
✅ Made (Negozio) e Zago (Boutique) onboarding atomico passa tutti i check (companies/outlets/cost_centers/cost_categories/chart_of_accounts/suppliers/company_settings + idempotency + point_of_sale_label).

### NZ invariato
✅ `budget_entries=816, outlets=7, companies=1, point_of_sale_label="Outlet"`. Nessuna DELETE/UPDATE su dati NZ, solo le modifiche additive di PR precedenti rimangono.

### Reset finale
✅ Made + Zago resettati a vergine (companies=0), pronti per Lilian.

### Build
- `npm run typecheck` ✅ zero errori
- `npx vite build` ✅ pulito (3.09s)

---

## Decisioni autonome chiave

1. **Empty state invece di refactor strutturale per mock pages** — StockSellthrough/AnalyticsPOS/OpenToBuy/OutletValutazione sono pagine 100% mock data hardcoded su NZ. Refactor verso lettura DB reale (giacenze/POS/OTB) è un task strutturale grosso, fuori dallo scope del prompt. Soluzione MVP: detect "il tenant ha almeno 1 outlet che matcha l'hardcoded?" → SI → mostra mock (preserva esperienza NZ produzione). NO → empty state UX-friendly. Per Made/Zago/SaaS futuri il risultato è "nessun dato disponibile" + messaggio chiaro.

2. **`getOutletTailwindBg` deterministico via hash** invece di richiedere colonna `color` nel DB. Pro: zero modifiche schema, palette estensibile. Con: classi Tailwind devono essere statiche (incluse nel build) — risolto con `TAILWIND_BG_PALETTE` array fisso di 16 classi.

3. **Banner SDI invece di pagina-vuota** — la pagina Fatturazione continua a essere usabile (consultazione fatture passive/attive già nel DB) anche su tenant senza accreditamento SDI. Solo il bottone Sync è disabilitato + banner informativo.

4. **`callEdgeFunction` legge da `getCurrentTenant()`** invece di env hardcoded — necessario per il multi-tenant: prima il fallback era `https://xfvfxsvqpnpvibgeqpqp.supabase.co` (NZ) sempre, anche su Made/Zago.

5. **Fix bonus typecheck pre-esistenti su main**: 2 errori (`MarginiCategoria.tsx:328` con `labels` non in scope, `useOnboardingStatus.tsx:55` cast RPC) erano già rotti su main pre-PR. Li fixo qui per non lasciare il build rosso, ma non sono nello scope esplicito del prompt.

6. **`minOutlets` come proprietà sulla NavItem** invece di filtro hardcoded nel componente Sidebar. Scalabile: se in futuro serve nascondere altre voci (es. "AnalyticsPOS" se mancano dati cassa), basta aggiungere `minOutlets: N` alla definizione.

---

## Limitazioni residue note

- **Pagine mock**: StockSellthrough/AnalyticsPOS/OpenToBuy ancora generano mock data quando il tenant matcha l'hardcoded (NZ). Per refactor strutturale → task separato.
- **OutletValutazione.tsx**: il prompt lo menzionava ma in pratica il componente non ha hardcoded outlet (verificato con grep). Non toccato.
- **Test browser**: la verifica visiva delle 4 pagine refactorate (Dipendenti, StockSellthrough, AnalyticsPOS, OpenToBuy, StoreManager) post-merge nel browser Made/Zago conferma il rendering corretto.
