// Modali dello Scadenzario: modifica scadenza, nuova scadenza (fattura/rate),
// nuovo fornitore. Estratti da ScadenzarioSmart.tsx (spezzatura ondata 9)
// senza cambi funzionali: componenti autosufficienti, comunicano solo via props.
import { useState, useEffect, useRef } from 'react';
import { Search, Plus, RefreshCw, Trash2, FileUp, Loader2, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { extractScadenzaFromPdf, ScadenzaExtractError, type ExtractedScadenza } from '../../lib/scadenzaPdfExtract';
import { SCHEDULE_MODE_GROUPS, findScheduleMode, derivePlan, computeInstallments, scheduleModeText, SCHEDULE_GROUP_TEXT } from '../../lib/paymentSchedule';

export type EditSchedulePayload = { id: string; amount: number; due_date: string; status: string }
export type ScheduleLike = Record<string, unknown> & { id?: string; gross_amount?: number | null; due_date?: string | null; status?: string | null; invoice_number?: string | null }
export const EditScheduleModal = ({ schedule, onUpdate: _onUpdate, onSave }: { schedule: ScheduleLike; onUpdate: (s: ScheduleLike) => void; onSave: (data: EditSchedulePayload) => void }) => {
  const [formData, setFormData] = useState<EditSchedulePayload>({
    id: schedule.id || '',
    amount: schedule.gross_amount || 0,
    due_date: schedule.due_date || '',
    // Il select supporta solo stati "editabili"; gli stati calcolati (es.
    // 'addebito_automatico', sintetico e non presente nell'enum DB) vengono
    // riportati a 'da_pagare' per non scriverli mai a database.
    status: ['da_pagare', 'pagato', 'parziale'].includes(String(schedule.status || ''))
      ? String(schedule.status)
      : 'da_pagare',
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Importo</label>
        <input type="number" step="0.01" value={formData.amount} onChange={e => setFormData({ ...formData, amount: Number(e.target.value) })}
          onWheel={e => e.currentTarget.blur()}
          className="no-spin w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Scadenza</label>
        <input type="date" value={formData.due_date} onChange={e => setFormData({ ...formData, due_date: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Stato</label>
        <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          <option value="da_pagare">Da Pagare</option>
          <option value="pagato">Pagato</option>
          <option value="parziale">Parziale</option>
        </select>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={() => onSave({ ...schedule, ...formData })} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Salva</button>
      </div>
    </div>
  );
};

// Invoice Modal Component
export type RataInput = { dueDate: string; amount: number }
export type InvoiceFormState = { supplierId: string; newSupplierName: string; supplierType: string; invoiceNumber: string; invoiceDate: string; grossAmount: number; paymentMethod: string; frequency: string; costCenter: string; endDate: string; rate: RataInput[] }

// Tipo del nominativo/scadenza. Diventa la `category` del fornitore quando si crea
// un'anagrafica leggera al volo (nominativo non a sistema).
const supplierTypeOptions: { value: string; label: string }[] = [
  { value: 'fornitore', label: 'Fornitore' },
  { value: 'fiscale', label: 'Fiscale' },
  { value: 'interno', label: 'Interno' },
  { value: 'altro', label: 'Altro' },
];
const supplierTypeValues = supplierTypeOptions.map(o => o.value);
export type CostCenterLite = { code?: string; label?: string | null; [k: string]: unknown }
// Frequenze della scadenza ricorrente — allineate a recurring_costs.frequency
// (stessi valori della tab Ricorrenze). 'una_tantum' = scadenza singola.
const scadenzaFrequencyOptions: { value: string; label: string }[] = [
  { value: 'una_tantum', label: 'Una tantum (inserisci solo questa)' },
  { value: 'monthly', label: 'Mensile' },
  { value: 'bimonthly', label: 'Bimestrale' },
  { value: 'quarterly', label: 'Trimestrale' },
  { value: 'semiannual', label: 'Semestrale' },
  { value: 'annual', label: 'Annuale' },
];

// ─── Scadenze dalle REGOLE INTERNE ───────────────────────────────────────────
// derivePlan/computeInstallments vivono in src/lib/paymentSchedule.ts: le usa
// anche l'anteprima nel form fornitore, e due copie divergerebbero. Default
// quando il fornitore non ha un piano: 30 gg fine mese, rata unica.
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export type SupplierLite = { id?: string; name?: string | null; ragione_sociale?: string | null; [k: string]: unknown }
export type PaymentGroup = { label: string; methods: string[] }
export const InvoiceModal = ({ suppliers, costCenters, paymentGroups, paymentMethodLabels, onSave, onClose }: { suppliers: SupplierLite[]; costCenters: CostCenterLite[]; paymentGroups: PaymentGroup[]; paymentMethodLabels: Record<string, string>; onSave: (data: InvoiceFormState) => void; onClose: () => void }) => {
  const [formData, setFormData] = useState<InvoiceFormState>({
    supplierId: '',
    newSupplierName: '',
    supplierType: 'fornitore',
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    grossAmount: 0,
    paymentMethod: 'bonifico_ordinario',
    frequency: 'una_tantum',
    costCenter: '',
    endDate: '',
    rate: [],
  });

  // Selettore fornitore con RICERCA (typeahead): NON mostra l'intera lista quando
  // il campo è vuoto (ingestibile con centinaia di fornitori). Si digita almeno
  // 2 lettere e compaiono le corrispondenze; se il nominativo non è a sistema, si
  // può aggiungerlo al volo (anagrafica leggera con il "tipo" scelto).
  const MIN_QUERY = 2;
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const selectedSupplier = suppliers.find(s => s.id === formData.supplierId);
  const selectedSupplierLabel = formData.newSupplierName
    ? formData.newSupplierName
    : (selectedSupplier?.ragione_sociale || selectedSupplier?.name || '') as string;
  const trimmedQuery = supplierQuery.trim();
  const filteredSuppliers = (() => {
    if (trimmedQuery.length < MIN_QUERY) return [];
    const q = trimmedQuery.toLowerCase();
    return suppliers
      .filter(s => `${s.ragione_sociale || ''} ${s.name || ''}`.toLowerCase().includes(q))
      .slice(0, 50);
  })();
  // Mostra l'azione "aggiungi nuovo" solo se non esiste già un nominativo con lo
  // stesso nome esatto (case-insensitive).
  const hasExactMatch = suppliers.some(s =>
    `${s.ragione_sociale || s.name || ''}`.trim().toLowerCase() === trimmedQuery.toLowerCase()
  );
  const canAddNew = trimmedQuery.length >= MIN_QUERY && !hasExactMatch;

  const isRecurring = formData.frequency !== 'una_tantum';

  // Piano applicato per il nominativo scelto (per l'etichetta informativa).
  const selectedPlan = derivePlan(selectedSupplier);
  // Quando applichiamo le scadenze lette da un PDF, saltiamo UNA volta il
  // ricalcolo automatico dalle regole (l'effect qui sotto) così non sovrascrive
  // le rate del documento con quelle di default. Le modifiche manuali successive
  // all'importo/data ricalcolano normalmente.
  const skipRecalcRef = useRef(false);
  // Ricalcolo le scadenze dalle REGOLE INTERNE quando cambia il fornitore, la data
  // documento o l'importo. Restano poi correggibili a mano (le modifiche persistono
  // finché non cambia uno di questi input).
  useEffect(() => {
    if (skipRecalcRef.current) { skipRecalcRef.current = false; return; }
    const sup = suppliers.find(s => s.id === formData.supplierId);
    const plan = derivePlan(sup);
    const nextRate = computeInstallments(formData.invoiceDate, plan, formData.grossAmount);
    setFormData(prev => ({ ...prev, rate: nextRate }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.supplierId, formData.invoiceDate, formData.grossAmount, suppliers]);

  const updateRata = (i: number, patch: Partial<RataInput>) =>
    setFormData(prev => ({ ...prev, rate: prev.rate.map((r, idx) => idx === i ? { ...r, ...patch } : r) }));
  const addRata = () =>
    setFormData(prev => ({ ...prev, rate: [...prev.rate, { dueDate: prev.rate[prev.rate.length - 1]?.dueDate || prev.invoiceDate, amount: 0 }] }));
  const removeRata = (i: number) =>
    setFormData(prev => ({ ...prev, rate: prev.rate.filter((_, idx) => idx !== i) }));
  const recalcFromRules = () => {
    const plan = derivePlan(selectedSupplier);
    setFormData(prev => ({ ...prev, rate: computeInstallments(prev.invoiceDate, plan, prev.grossAmount) }));
  };
  const rateSum = round2(formData.rate.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const rateMismatch = Math.abs(rateSum - (Number(formData.grossAmount) || 0)) > 0.01;

  // ─── LETTURA DA PDF (estrazione automatica) ──────────────────────────────
  // L'operatrice carica un documento (proforma/notula/fattura) e il sistema
  // pre-compila il form leggendone i dati. Resta tutto correggibile a mano.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pdfInfo, setPdfInfo] = useState<{ fields: string[]; supplierMatched: boolean; confidence: number | null; creditNote: boolean } | null>(null);

  // Normalizza P.IVA/CF per il confronto (solo alfanumerici, via "IT").
  const normVat = (v: unknown): string =>
    String(v ?? '').replace(/[^0-9A-Za-z]/g, '').replace(/^IT/i, '').toLowerCase();

  const applyExtracted = (ext: ExtractedScadenza) => {
    const filled: string[] = [];
    // 1) Fornitore: match per P.IVA sull'anagrafica (regola aggancio per P.IVA).
    let matchedSupplier: SupplierLite | undefined;
    if (ext.supplierVat) {
      const target = normVat(ext.supplierVat);
      matchedSupplier = suppliers.find(s =>
        normVat((s as { partita_iva?: unknown }).partita_iva) === target ||
        normVat((s as { vat_number?: unknown }).vat_number) === target,
      );
    }
    // Fallback: match per nome esatto (case-insensitive) se manca la P.IVA.
    if (!matchedSupplier && ext.supplierName) {
      const nm = ext.supplierName.trim().toLowerCase();
      matchedSupplier = suppliers.find(s => `${s.ragione_sociale || s.name || ''}`.trim().toLowerCase() === nm);
    }

    // 2) Scadenze dal documento (se presenti e quadrano con l'importo).
    const gross = ext.grossAmount != null && ext.grossAmount > 0 ? round2(ext.grossAmount) : 0;
    const rate: RataInput[] = (ext.installments || [])
      .filter(r => r.dueDate && Number.isFinite(r.amount))
      .map(r => ({ dueDate: r.dueDate, amount: round2(r.amount) }));
    const useDocRate = rate.length > 0;
    if (useDocRate) skipRecalcRef.current = true;

    setFormData(prev => {
      const next = { ...prev };
      if (matchedSupplier) {
        next.supplierId = String(matchedSupplier.id);
        next.newSupplierName = '';
        const cat = String((matchedSupplier as { category?: unknown }).category || '');
        if (supplierTypeValues.includes(cat)) next.supplierType = cat;
        filled.push('nominativo');
      } else if (ext.supplierName) {
        next.supplierId = '';
        next.newSupplierName = ext.supplierName;
        filled.push('nominativo (nuovo)');
      }
      if (ext.invoiceNumber) { next.invoiceNumber = ext.invoiceNumber; filled.push('numero documento'); }
      if (ext.invoiceDate) { next.invoiceDate = ext.invoiceDate; filled.push('data documento'); }
      if (gross > 0) { next.grossAmount = gross; filled.push('importo'); }
      if (ext.paymentMethod) { next.paymentMethod = ext.paymentMethod; filled.push('metodo'); }
      if (useDocRate) { next.rate = rate; filled.push(rate.length > 1 ? `${rate.length} scadenze` : 'scadenza'); }
      return next;
    });

    setPdfInfo({
      fields: filled,
      supplierMatched: !!matchedSupplier,
      confidence: ext.confidence,
      creditNote: ext.isCreditNote,
    });
  };

  const handlePdfFile = async (file: File | null | undefined) => {
    if (!file) return;
    setPdfError(null);
    setPdfInfo(null);
    setPdfLoading(true);
    try {
      const ext = await extractScadenzaFromPdf(file);
      applyExtracted(ext);
    } catch (e) {
      setPdfError(e instanceof ScadenzaExtractError ? e.message : 'Estrazione non riuscita. Inserisci i dati a mano.');
    } finally {
      setPdfLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {/* LETTURA DA PDF — carica un documento e il sistema pre-compila il form */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={e => handlePdfFile(e.target.files?.[0])}
        />
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0 w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            {pdfLoading ? <Loader2 size={16} className="text-indigo-600 animate-spin" /> : <Sparkles size={16} className="text-indigo-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-indigo-800">Compila da PDF</p>
            <p className="text-[11px] text-indigo-600/80 mb-2">Carica un documento (proforma, notula, fattura…) e i dati vengono letti in automatico. Controlla sempre prima di salvare.</p>
            <button type="button" disabled={pdfLoading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed">
              {pdfLoading ? <><Loader2 size={13} className="animate-spin" /> Lettura in corso…</> : <><FileUp size={13} /> Scegli un PDF</>}
            </button>
          </div>
        </div>
        {pdfError && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600">
            <AlertCircle size={13} className="shrink-0 mt-px" /> <span>{pdfError}</span>
          </div>
        )}
        {pdfInfo && !pdfError && (
          <div className="mt-2 space-y-1">
            <div className="flex items-start gap-1.5 text-[11px] text-emerald-700">
              <CheckCircle2 size={13} className="shrink-0 mt-px" />
              <span>
                Compilati: {pdfInfo.fields.length ? pdfInfo.fields.join(', ') : 'nessun campo riconosciuto'}. Verifica e correggi dove serve.
                {pdfInfo.confidence != null && pdfInfo.confidence < 0.6 ? ' Attenzione: lettura poco sicura.' : ''}
              </span>
            </div>
            {pdfInfo.fields.includes('nominativo (nuovo)') && (
              <p className="text-[11px] text-amber-600 flex items-start gap-1.5"><AlertCircle size={13} className="shrink-0 mt-px" /> Nominativo non a sistema: verrà creato. Controlla nome e tipo.</p>
            )}
            {pdfInfo.creditNote && (
              <p className="text-[11px] text-amber-600 flex items-start gap-1.5"><AlertCircle size={13} className="shrink-0 mt-px" /> Il documento sembra una NOTA DI CREDITO: verifica importo e gestione prima di salvare.</p>
            )}
          </div>
        )}
      </div>

      {/* FORNITORE / NOMINATIVO — combobox con ricerca + aggiunta al volo */}
      <div className="relative">
        <label className="block text-sm font-medium text-slate-700 mb-1">Nominativo *</label>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input
            type="text"
            value={supplierOpen ? supplierQuery : selectedSupplierLabel}
            onChange={e => { setSupplierQuery(e.target.value); setSupplierOpen(true); }}
            onFocus={() => { setSupplierOpen(true); setSupplierQuery(''); }}
            onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
            placeholder="Digita per cercare o aggiungere un nominativo…"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
        {supplierOpen && (
          <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
            {trimmedQuery.length < MIN_QUERY ? (
              <div className="px-3 py-2 text-xs text-slate-400">Digita almeno {MIN_QUERY} lettere per cercare…</div>
            ) : (
              <>
                {filteredSuppliers.map(s => (
                  <button key={s.id} type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      const cat = String(s.category || '');
                      setFormData({
                        ...formData,
                        supplierId: String(s.id),
                        newSupplierName: '',
                        supplierType: supplierTypeValues.includes(cat) ? cat : formData.supplierType,
                      });
                      setSupplierOpen(false); setSupplierQuery('');
                    }}
                    className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 ${formData.supplierId === s.id ? 'bg-slate-50 font-medium' : ''}`}>
                    {s.ragione_sociale || s.name}
                  </button>
                ))}
                {filteredSuppliers.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">Nessun nominativo a sistema</div>
                )}
                {canAddNew && (
                  <button type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setFormData({ ...formData, supplierId: '', newSupplierName: trimmedQuery });
                      setSupplierOpen(false); setSupplierQuery('');
                    }}
                    className="w-full text-left px-3 py-2 text-sm border-t border-slate-100 bg-emerald-50/60 hover:bg-emerald-100 text-emerald-700 font-medium flex items-center gap-1.5">
                    <Plus size={14} /> Usa «{trimmedQuery}» come nuovo nominativo
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {formData.newSupplierName && !supplierOpen && (
          <p className="mt-1 text-[11px] text-emerald-600 font-medium">Nuovo nominativo — verrà creato come «{supplierTypeOptions.find(o => o.value === formData.supplierType)?.label}»</p>
        )}
      </div>
      {/* TIPO — classifica il nominativo/scadenza (salvato come categoria) */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
        <div className="flex rounded-lg overflow-hidden border border-slate-300">
          {supplierTypeOptions.map(o => (
            <button key={o.value} type="button"
              onClick={() => setFormData({ ...formData, supplierType: o.value })}
              className={`flex-1 px-3 py-1.5 text-sm font-medium border-l first:border-l-0 border-slate-200 ${formData.supplierType === o.value ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Numero documento <span className="text-slate-400 font-normal">(opzionale)</span></label>
        <input type="text" value={formData.invoiceNumber} onChange={e => setFormData({ ...formData, invoiceNumber: e.target.value })}
          placeholder="Es. fattura, riferimento…"
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data documento</label>
          <input type="date" value={formData.invoiceDate} onChange={e => setFormData({ ...formData, invoiceDate: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Importo *</label>
          <input type="number" step="0.01" value={formData.grossAmount || ''} onChange={e => setFormData({ ...formData, grossAmount: Number(e.target.value) })}
            onWheel={e => e.currentTarget.blur()}
            placeholder="0,00"
            className="no-spin w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-right focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      {/* SCADENZE — calcolate dalle REGOLE INTERNE (piano del fornitore o default
          aziendale "a vista"), correggibili a mano. */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-sm font-medium text-slate-700">Scadenze pagamento *</label>
          <button type="button" onClick={recalcFromRules}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
            <RefreshCw size={12} /> Ricalcola dalle regole
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-2">
          {selectedPlan.hasPlan
            ? `Piano fornitore: ${selectedPlan.base === 'fine_mese' ? 'fine mese' : 'data fattura'} · ${selectedPlan.gg} gg · ${selectedPlan.nRate} ${selectedPlan.nRate > 1 ? 'rate' : 'rata'}. Puoi correggere date e importi.`
            : 'Regola predefinita: a vista (30 gg data fattura, fine mese). Puoi correggere date e importi.'}
        </p>
        <div className="space-y-2">
          {formData.rate.length === 0 && (
            <p className="text-xs text-slate-400 italic">Inserisci la data documento e l'importo per calcolare le scadenze.</p>
          )}
          {formData.rate.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-9 shrink-0">{formData.rate.length > 1 ? `#${i + 1}` : 'Rata'}</span>
              <input type="date" value={r.dueDate} onChange={e => updateRata(i, { dueDate: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
              <input type="number" step="0.01" value={r.amount || ''} onChange={e => updateRata(i, { amount: Number(e.target.value) })}
                onWheel={e => e.currentTarget.blur()}
                placeholder="0,00"
                className="no-spin w-28 px-3 py-2 rounded-lg border border-slate-300 text-sm text-right focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
              <button type="button" disabled={formData.rate.length <= 1} onClick={() => removeRata(i)}
                className="p-2.5 text-red-500 disabled:text-slate-200 hover:bg-red-50 rounded" aria-label="Rimuovi rata">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between mt-2">
          <button type="button" onClick={addRata}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={13} /> Aggiungi rata
          </button>
          {formData.rate.length > 0 && (
            <span className={`text-xs font-medium ${rateMismatch ? 'text-amber-600' : 'text-slate-400'}`}>
              Somma rate: € {rateSum.toFixed(2)}{rateMismatch ? ` ≠ € ${(Number(formData.grossAmount) || 0).toFixed(2)}` : ''}
            </span>
          )}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Metodo Pagamento</label>
        <select value={formData.paymentMethod} onChange={e => setFormData({ ...formData, paymentMethod: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          {paymentGroups.map(g => (
            <optgroup key={g.label} label={g.label}>
              {g.methods.map(m => <option key={m} value={m}>{paymentMethodLabels[m]}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {/* PERIODICITÀ — ogni quanto si ripete il pagamento */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Periodicità</label>
        <select value={formData.frequency} onChange={e => setFormData({ ...formData, frequency: e.target.value })}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          {scadenzaFrequencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {/* Centro di costo + Fine periodicità: solo se ricorrente */}
      {isRecurring && (
        <div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Centro di costo / Outlet *</label>
              <select value={formData.costCenter} onChange={e => setFormData({ ...formData, costCenter: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
                <option value="">Seleziona centro di costo…</option>
                {costCenters.map(c => <option key={String(c.code)} value={String(c.code)}>{c.label || c.code}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fine periodicità <span className="text-slate-400 font-normal">(opzionale)</span></label>
              <input type="date" value={formData.endDate} min={formData.rate[0]?.dueDate || undefined}
                onChange={e => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">La prima scadenza viene creata ora; la ripetizione viene registrata tra le Ricorrenze e nel cashflow previsionale. Vuoto = nessuna fine (orizzonte mobile 12 mesi).</p>
        </div>
      )}
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave(formData)} className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">Crea scadenza</button>
      </div>
    </div>
  );
};

// Supplier Modal Component
export type SupplierFormState = {
  name: string; vat: string; fiscal: string; iban: string; category: string;
  paymentMethod: string; paymentTerms: number;
  // Piano scadenze: stesse colonne del form fornitore completo, cosi' il
  // nominativo creato al volo nasce gia' con la sua modalita' (anche le
  // dilazioni multiple: 30/60, 30/60/90/120, 90/120 …).
  paymentBase: string; primaScadenzaGg: number; numeroRate: number;
}
export const SupplierModal = ({ onSave, onClose }: { onSave: (data: SupplierFormState) => void; onClose: () => void }) => {
  const [formData, setFormData] = useState<SupplierFormState>({
    name: '', vat: '', fiscal: '', iban: '', category: 'merce',
    paymentMethod: 'bonifico_ordinario', paymentTerms: 30,
    paymentBase: 'fine_mese', primaScadenzaGg: 30, numeroRate: 1,
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Ragione Sociale *</label>
        <input type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">P.IVA</label>
          <input type="text" value={formData.vat} onChange={e => setFormData({ ...formData, vat: e.target.value })} maxLength={16}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Codice Fiscale</label>
          <input type="text" value={formData.fiscal} onChange={e => setFormData({ ...formData, fiscal: e.target.value })} maxLength={16}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">IBAN</label>
        <input type="text" value={formData.iban} onChange={e => setFormData({ ...formData, iban: e.target.value })} maxLength={34}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Categoria</label>
          <select value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
            {['merce', 'servizi', 'utenze', 'affitti', 'stipendi', 'imposte', 'finanziamenti'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Termini (gg)</label>
          <input type="number" value={formData.paymentTerms} onChange={e => setFormData({ ...formData, paymentTerms: parseInt(e.target.value) })}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none" />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Modalità (scadenze)</label>
        <select
          value={findScheduleMode(formData.paymentBase, formData.primaScadenzaGg, formData.numeroRate)?.label || ''}
          onChange={e => {
            const m = SCHEDULE_MODE_GROUPS.flatMap(g => g.items).find(x => x.label === e.target.value);
            if (!m || !m.base || m.prima == null) return;
            setFormData(prev => ({
              ...prev,
              paymentBase: m.base as string,
              primaScadenzaGg: m.prima as number,
              numeroRate: m.rate as number,
              paymentTerms: m.prima as number,
            }));
          }}
          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none">
          {SCHEDULE_MODE_GROUPS.filter(g => g.group !== 'Personalizzata').map(g => (
            <optgroup key={g.group} label={SCHEDULE_GROUP_TEXT[g.group] || g.group}>
              {g.items.map(o => <option key={o.label} value={o.label}>{scheduleModeText(o)}</option>)}
            </optgroup>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-slate-400">Da qui si sceglie anche una dilazione a più rate (es. 30/60/90 gg DFFM): le scadenze delle fatture di questo fornitore verranno create di conseguenza.</p>
      </div>
      <div className="flex gap-3 pt-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium hover:bg-slate-50">Annulla</button>
        <button onClick={() => onSave(formData)} className="flex-1 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">Crea Fornitore</button>
      </div>
    </div>
  );
};
