// Gestione categorie di costo (cost_categories) dallo Scadenzario.
//
// Permette a un super_advisor di:
//  - creare una nuova categoria (nome, gruppo contabile, colore)
//  - modificare la descrizione/gruppo/colore di una categoria esistente
//  - vedere, per ogni categoria, quali fornitori vi sono collegati
//    (suppliers.default_cost_category_id) e quante fatture la usano
//
// La scrittura su cost_categories è protetta da RLS (policy cost_cat_write):
// solo il ruolo super_advisor può INSERT/UPDATE. Gli altri ruoli vedono il
// pannello in sola lettura. Il `code` è una chiave stabile (usata da
// ce_account_code e dai vincoli di unicità): si genera automaticamente alla
// creazione e non è modificabile.

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, ChevronDown, X, Save, Users, ArrowRightLeft, CheckSquare, Square } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../components/Toast';
import { Modal } from './SharedUI';

export type CatRow = {
  id?: string;
  code?: string | null;
  name?: string | null;
  macro_group?: string | null;
  color?: string | null;
  sort_order?: number | null;
};

export type SupLite = {
  id?: string;
  name?: string | null;
  ragione_sociale?: string | null;
  default_cost_category_id?: string | null;
  vat_number?: string | null;
  partita_iva?: string | null;
};

// Gruppi contabili (enum cost_macro_group) con label italiane.
const MACRO_GROUPS: { value: string; label: string }[] = [
  { value: 'costo_venduto', label: 'Costo del venduto' },
  { value: 'locazione', label: 'Locazione' },
  { value: 'personale', label: 'Personale' },
  { value: 'generali_amministrative', label: 'Generali e amministrative' },
  { value: 'finanziarie', label: 'Finanziarie' },
  { value: 'oneri_diversi', label: 'Oneri diversi' },
];

const macroLabel = (v: string | null | undefined) =>
  MACRO_GROUPS.find(g => g.value === v)?.label || v || '—';

// Genera un code stabile dal nome, garantendone l'unicità nel tenant.
function makeCode(name: string, existing: Set<string>): string {
  const base = (name || 'CAT')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'CAT';
  let code = base;
  let n = 1;
  while (existing.has(code)) { code = `${base}_${n}`; n += 1; }
  return code;
}

type EditForm = { name: string; macro_group: string; color: string };
const DEFAULT_COLOR = '#6b7280';

export function CategoryManagerModal({
  open,
  onClose,
  companyId,
  categories,
  suppliers,
  payableCountByCat,
  canEdit,
  onChanged,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string | null | undefined;
  categories: CatRow[];
  suppliers: SupLite[];
  payableCountByCat: Record<string, number>;
  canEdit: boolean;
  onChanged: () => void | Promise<void>;
  /** Aggiornamento in memoria dopo lo spostamento di fornitori (evita il refetch
   *  pesante che chiuderebbe il pannello). Il parent riallinea suppliers+payables. */
  onMoved: (movedSuppliers: SupLite[], targetCategoryId: string) => void;
}) {
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({ name: '', macro_group: 'oneri_diversi', color: DEFAULT_COLOR });
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<EditForm>({ name: '', macro_group: 'oneri_diversi', color: DEFAULT_COLOR });
  const [busy, setBusy] = useState(false);
  // Selezione fornitori da spostare + categoria di destinazione (scoped alla
  // categoria attualmente espansa: si azzera quando cambia l'espansione).
  const [selectedSup, setSelectedSup] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  useEffect(() => { setSelectedSup(new Set()); setMoveTarget(''); }, [expandedId]);

  // Fornitori collegati per categoria (suppliers.default_cost_category_id).
  const suppliersByCat = useMemo(() => {
    const map: Record<string, SupLite[]> = {};
    (suppliers || []).forEach(s => {
      const cid = s.default_cost_category_id;
      if (!cid) return;
      (map[cid] ||= []).push(s);
    });
    Object.values(map).forEach(list =>
      list.sort((a, b) =>
        String(a.ragione_sociale || a.name || '').localeCompare(String(b.ragione_sociale || b.name || ''))));
    return map;
  }, [suppliers]);

  const startEdit = (c: CatRow) => {
    setEditingId(c.id || null);
    setEditForm({
      name: String(c.name || ''),
      macro_group: String(c.macro_group || 'oneri_diversi'),
      color: String(c.color || DEFAULT_COLOR),
    });
  };

  const handleSaveEdit = async (id: string) => {
    if (!editForm.name.trim()) { toast({ type: 'error', message: 'Il nome della categoria è obbligatorio' }); return; }
    setBusy(true);
    const { error } = await supabase
      .from('cost_categories')
      .update({ name: editForm.name.trim(), macro_group: editForm.macro_group, color: editForm.color } as never)
      .eq('id', id);
    setBusy(false);
    if (error) {
      toast({ type: 'error', message: `Errore salvataggio: ${error.message}` });
      return;
    }
    setEditingId(null);
    await onChanged();
    toast({ type: 'success', message: 'Categoria aggiornata' });
  };

  const handleCreate = async () => {
    if (!companyId) return;
    if (!createForm.name.trim()) { toast({ type: 'error', message: 'Il nome della categoria è obbligatorio' }); return; }
    setBusy(true);
    const existing = new Set(categories.map(c => String(c.code || '').toUpperCase()));
    const code = makeCode(createForm.name, existing);
    const maxSort = categories.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    const { error } = await supabase
      .from('cost_categories')
      .insert({
        company_id: companyId,
        code,
        name: createForm.name.trim(),
        macro_group: createForm.macro_group,
        color: createForm.color,
        is_fixed: true,
        is_recurring: false,
        is_system: false,
        sort_order: maxSort + 10,
      } as never);
    setBusy(false);
    if (error) {
      toast({ type: 'error', message: `Errore creazione: ${error.message}` });
      return;
    }
    setCreating(false);
    setCreateForm({ name: '', macro_group: 'oneri_diversi', color: DEFAULT_COLOR });
    await onChanged();
    toast({ type: 'success', message: `Categoria "${createForm.name.trim()}" creata` });
  };

  // Sposta i fornitori selezionati in un'altra categoria: aggiorna la categoria
  // predefinita del fornitore E riallinea TUTTE le sue fatture alla nuova
  // categoria (scelta dell'utente). Match come la propagazione dello Scadenzario:
  // supplier_id, in mancanza P.IVA, in mancanza nome.
  const handleMoveSuppliers = async () => {
    if (!companyId || !moveTarget) return;
    const chosen = suppliers.filter(s => s.id && selectedSup.has(s.id));
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      for (const s of chosen) {
        if (!s.id) continue;
        await supabase.from('suppliers').update({ default_cost_category_id: moveTarget } as never).eq('id', s.id);
        // Riallinea TUTTE le fatture del fornitore (nessun filtro su cost_category_id).
        await supabase.from('payables').update({ cost_category_id: moveTarget } as never)
          .eq('company_id', companyId).eq('supplier_id', s.id);
        const vat = s.vat_number || s.partita_iva;
        if (vat) {
          await supabase.from('payables').update({ cost_category_id: moveTarget } as never)
            .eq('company_id', companyId).eq('supplier_vat', vat);
        }
        const name = s.ragione_sociale || s.name;
        if (name) {
          await supabase.from('payables').update({ cost_category_id: moveTarget } as never)
            .eq('company_id', companyId).eq('supplier_name', name);
        }
      }
    } catch (e) {
      setBusy(false);
      toast({ type: 'error', message: `Errore spostamento: ${(e as Error).message}` });
      return;
    }
    setBusy(false);
    onMoved(chosen, moveTarget);
    const targetName = categories.find(c => c.id === moveTarget)?.name || 'categoria';
    setSelectedSup(new Set());
    setMoveTarget('');
    toast({ type: 'success', message: `${chosen.length} fornitor${chosen.length === 1 ? 'e' : 'i'} spostat${chosen.length === 1 ? 'o' : 'i'} in "${targetName}"` });
  };

  const toggleSup = (id: string) => {
    setSelectedSup(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const fieldRow = (form: EditForm, setForm: (f: EditForm) => void) => (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 flex-1 min-w-[160px]">
        <span className="text-xs font-medium text-slate-500">Nome / descrizione</span>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400"
          placeholder="Es. Utenze e forniture"
        />
      </label>
      <label className="flex flex-col gap-1 min-w-[180px]">
        <span className="text-xs font-medium text-slate-500">Gruppo contabile</span>
        <select
          value={form.macro_group}
          onChange={e => setForm({ ...form, macro_group: e.target.value })}
          className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
        >
          {MACRO_GROUPS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-500">Colore</span>
        <input
          type="color"
          value={form.color}
          onChange={e => setForm({ ...form, color: e.target.value })}
          className="h-9 w-12 rounded-md border border-slate-200 cursor-pointer"
        />
      </label>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Gestione categorie di costo" wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Le categorie classificano le fatture passive e alimentano Conto Economico, budget e report.
          {canEdit
            ? ' Modifica nome, gruppo e colore, oppure creane di nuove.'
            : ' Solo un utente con ruolo super advisor può crearle o modificarle.'}
        </p>

        {/* Creazione nuova categoria */}
        {canEdit && (
          creating ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 space-y-3">
              <div className="text-sm font-semibold text-slate-700">Nuova categoria</div>
              {fieldRow(createForm, setCreateForm)}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setCreating(false); setCreateForm({ name: '', macro_group: 'oneri_diversi', color: DEFAULT_COLOR }); }}
                  disabled={busy}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-white disabled:opacity-50"
                >
                  Annulla
                </button>
                <button
                  onClick={handleCreate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  <Save size={14} /> Crea categoria
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
            >
              <Plus size={15} /> Nuova categoria
            </button>
          )
        )}

        {/* Elenco categorie */}
        <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
          {categories.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-slate-400">Nessuna categoria presente.</div>
          )}
          {categories.map(c => {
            const linked = (c.id && suppliersByCat[c.id]) || [];
            const invoiceCount = (c.id && payableCountByCat[c.id]) || 0;
            const isEditing = editingId === c.id;
            const isExpanded = expandedId === c.id;
            return (
              <div key={c.id} className="bg-white">
                {isEditing ? (
                  <div className="p-3 space-y-3 bg-slate-50/60">
                    {fieldRow(editForm, setEditForm)}
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setEditingId(null)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-white disabled:opacity-50"
                      >
                        Annulla
                      </button>
                      <button
                        onClick={() => c.id && handleSaveEdit(c.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      >
                        <Save size={14} /> Salva
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: String(c.color || DEFAULT_COLOR) }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-800 truncate">{String(c.name || '—')}</div>
                      <div className="text-xs text-slate-400">{macroLabel(c.macro_group)} · {String(c.code || '')}</div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : (c.id || null))}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 whitespace-nowrap"
                      title="Mostra fornitori collegati"
                    >
                      <Users size={13} /> {linked.length} fornitor{linked.length === 1 ? 'e' : 'i'}
                      <ChevronDown size={13} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                    <span className="text-xs text-slate-400 whitespace-nowrap hidden sm:inline">{invoiceCount} fattur{invoiceCount === 1 ? 'a' : 'e'}</span>
                    {canEdit && (
                      <button
                        onClick={() => startEdit(c)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                        title="Modifica categoria"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                  </div>
                )}

                {/* Fornitori collegati */}
                {isExpanded && !isEditing && (
                  <div className="px-3 pb-3 pt-0 pl-6 space-y-2">
                    {linked.length === 0 ? (
                      <div className="text-xs text-slate-400">Nessun fornitore collegato a questa categoria.</div>
                    ) : canEdit ? (
                      <>
                        <div className="text-xs text-slate-400">Seleziona i fornitori da spostare in un'altra categoria (riallinea tutte le loro fatture):</div>
                        <div className="flex flex-col gap-1">
                          {linked.map(s => {
                            const sid = s.id || '';
                            const checked = selectedSup.has(sid);
                            return (
                              <button
                                key={sid}
                                onClick={() => sid && toggleSup(sid)}
                                className="inline-flex items-center gap-2 text-left text-xs text-slate-600 hover:text-slate-900"
                              >
                                {checked ? <CheckSquare size={14} className="text-blue-600 flex-shrink-0" /> : <Square size={14} className="text-slate-300 flex-shrink-0" />}
                                <span className="truncate">{String(s.ragione_sociale || s.name || 'N/D')}</span>
                              </button>
                            );
                          })}
                        </div>
                        {selectedSup.size > 0 && (
                          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100">
                            <span className="text-xs text-slate-500">Sposta {selectedSup.size} selezionat{selectedSup.size === 1 ? 'o' : 'i'} in:</span>
                            <select
                              value={moveTarget}
                              onChange={e => setMoveTarget(e.target.value)}
                              className="px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                            >
                              <option value="">Scegli categoria…</option>
                              {categories.filter(t => t.id !== c.id).map(t => (
                                <option key={t.id} value={t.id}>{String(t.name || '')}</option>
                              ))}
                            </select>
                            <button
                              onClick={handleMoveSuppliers}
                              disabled={busy || !moveTarget}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              <ArrowRightLeft size={13} /> Sposta
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {linked.map(s => (
                          <span key={s.id} className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-xs text-slate-600">
                            {String(s.ragione_sociale || s.name || 'N/D')}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-slate-700 text-sm font-medium hover:bg-slate-50"
          >
            <X size={14} /> Chiudi
          </button>
        </div>
      </div>
    </Modal>
  );
}
