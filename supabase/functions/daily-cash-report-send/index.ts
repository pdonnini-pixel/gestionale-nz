// Edge Function: daily-cash-report-send
//
// Fase 2 dello specchietto incassi: compone e invia via mail (Resend) il
// riepilogo serale delle chiusure di cassa di un giorno per tutti i punti
// vendita dell'azienda: una riga per outlet, mancanti in evidenza, anomalie
// (giornate che non quadrano, foto mancanti, letture automatiche diverse da
// quanto scritto), totale azienda e progressivo del mese, confronto con
// l'obiettivo del budget ricavi (Inserimento rapido): obiettivo del giorno,
// scostamento +/- e andamento del mese.
//
// Chi la chiama:
// - pg_cron → daily_cash_report_tick() (migration 176) con il segreto
//   condiviso x-autofix-cron: body { log_id, company_id, report_date, kind }
// - Impostazioni → «Invia una prova a me»: JWT di super_advisor/contabile,
//   body { kind: 'test' }: la mail va SOLO all'indirizzo di chi la chiede.
//
// Sicurezza: service role solo qui dentro; la RESEND_API_KEY sta nei secret
// delle function (come send-distinta-email); nessun valore di tenant nel
// codice: l'URL dell'app arriva da daily_report_settings.app_url.
//
// WhatsApp (opzionale, daily_report_settings.whatsapp_enabled): lo stesso
// report in versione breve ai numeri in whatsapp_recipients, via Twilio con
// un modello approvato da Meta (fuori dalla finestra di 24 ore è l'unico modo).
// Credenziali nel Vault del tenant, lette con get_twilio_whatsapp_config()
// (migration 201). body.channel = 'whatsapp' nella prova manda solo WhatsApp.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

const NON_SELLING = ["sede", "magazzino", "warehouse", "hq", "ufficio"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

function jsonError(status: number, message: string, code = "DAILY_REPORT_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ─── Formattazione it-IT senza dipendere dai dati ICU del runtime ─────
function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.round(Math.abs(n) * 100);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${int},${String(abs % 100).padStart(2, "0")} €`;
}
function dateIt(iso: string, weekday = true): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = `${d} ${MESI[m - 1]} ${y}`;
  return weekday ? `${GIORNI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${base}` : base;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function romeToday(): string {
  // Data di oggi nel fuso italiano (il report parte la sera stessa).
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

interface Outlet { id: string; name: string; cost_center_key: string | null }
interface Channel { id: string; outlet_id: string; label: string; kind: string; counts_in_total: boolean }
interface Closing {
  id: string; outlet_id: string; status: string; is_closed_day: boolean; total_receipts: number; channels_total: number;
  receipts_difference: number; cash_expenses: number; customer_refunds: number; cash_deposit: number;
  cash_float_declared: number | null; cash_float_expected: number | null; cash_difference: number | null;
  invoices_total: number | null; cash_pending_declared: number | null;
  closed_by_name: string | null; notes: string | null; confirmed_at: string | null;
}
interface Line { closing_id: string; channel_id: string; amount: number; id: string }
interface Expense { id: string; closing_id: string; kind: string; amount: number; description: string | null }
interface Attachment { closing_id: string; target: string; line_id: string | null; expense_id: string | null; extraction_status: string; extracted: Record<string, unknown> | null }

const num = (v: unknown) => (v == null ? 0 : Number(v));
const extractedAmount = (e: Record<string, unknown> | null): number | null => {
  const v = e?.amount; return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
};

interface Budget {
  // Obiettivo dal budget ricavi mensile dell'Inserimento rapido (netto IVA → lordo con l'aliquota impostata)
  monthNet: number; monthGross: number; dayTarget: number; toDateTarget: number;
  mtd: number;          // incassato nel mese fino a oggi (chiusure non in bozza, giornata di oggi compresa)
  mtdDays: number;      // giorni con chiusura (non bozza, non chiuso) nel mese
  projection: number;   // proiezione fine mese: media giornaliera sui giorni trascorsi × giorni del mese
}
interface ReportData {
  companyName: string; date: string; outlets: Outlet[]; rows: RowData[]; missing: Outlet[]; anomalies: string[];
  totals: { total: number; cash: number; pos: number; other: number; expenses: number; refunds: number; deposit: number };
  monthToDate: number; monthLabel: string; appUrl: string | null;
  budget: {
    vatRate: number; dayOfMonth: number; daysInMonth: number; withBudget: number;
    dayTarget: number; toDateTarget: number; monthGross: number; mtd: number; projection: number;
  };
}
interface RowData {
  outlet: Outlet; closing: Closing | null; cash: number; pos: number; other: number; status: string; budget: Budget | null;
}

async function buildReport(admin: SupabaseClient, companyId: string, date: string, appUrl: string | null, vatRate: number): Promise<ReportData> {
  const [{ data: company }, { data: outletsRaw }, { data: channelsRaw }] = await Promise.all([
    admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    admin.from("outlets").select("id, name, outlet_type, is_active, cost_center_key").eq("company_id", companyId).order("name"),
    admin.from("outlet_payment_channels").select("id, outlet_id, label, kind, counts_in_total").eq("company_id", companyId).eq("is_active", true),
  ]);
  const outlets: Outlet[] = (outletsRaw ?? [])
    .filter((o) => (o.is_active ?? true) && !NON_SELLING.includes(String(o.outlet_type ?? "outlet").toLowerCase()))
    .map((o) => ({ id: o.id, name: o.name, cost_center_key: (o.cost_center_key as string | null) ?? null }));
  const channels = (channelsRaw ?? []) as Channel[];
  const outletIds = outlets.map((o) => o.id);

  // Budget ricavi del mese per outlet (Inserimento rapido → budget_confronto.rev_monthly, netto IVA),
  // sommato sui conti ricavo del centro di costo dell'outlet.
  const [y, m, d] = date.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const { data: budgetRaw } = await admin.from("budget_confronto").select("cost_center, amount")
    .eq("company_id", companyId).eq("year", y).eq("month", m).eq("entry_type", "rev_monthly");
  const budgetNetByCc = new Map<string, number>();
  for (const b of (budgetRaw ?? []) as Array<{ cost_center: string; amount: number }>) {
    budgetNetByCc.set(b.cost_center, (budgetNetByCc.get(b.cost_center) ?? 0) + num(b.amount));
  }
  const grossFactor = 1 + Math.max(0, vatRate) / 100;

  const monthStart = `${date.slice(0, 7)}-01`;
  const { data: closingsRaw } = outletIds.length
    ? await admin.from("outlet_daily_closings")
      .select("id, outlet_id, closing_date, status, is_closed_day, total_receipts, channels_total, receipts_difference, cash_expenses, customer_refunds, cash_deposit, cash_float_declared, cash_float_expected, cash_difference, invoices_total, cash_pending_declared, closed_by_name, notes, confirmed_at")
      .eq("company_id", companyId).in("outlet_id", outletIds).gte("closing_date", monthStart).lte("closing_date", date)
    : { data: [] };
  const allClosings = (closingsRaw ?? []) as Array<Closing & { closing_date: string }>;
  const todays = allClosings.filter((c) => c.closing_date === date);
  const monthToDate = allClosings.filter((c) => c.status !== "bozza").reduce((s, c) => s + num(c.total_receipts), 0);
  const closingIds = todays.map((c) => c.id);

  const [{ data: linesRaw }, { data: expRaw }, { data: attRaw }] = closingIds.length
    ? await Promise.all([
      admin.from("outlet_daily_closing_lines").select("id, closing_id, channel_id, amount").in("closing_id", closingIds),
      admin.from("outlet_daily_closing_expenses").select("id, closing_id, kind, amount, description").in("closing_id", closingIds),
      admin.from("outlet_daily_closing_attachments").select("closing_id, target, line_id, expense_id, extraction_status, extracted").in("closing_id", closingIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const lines = (linesRaw ?? []) as Line[];
  const expenses = (expRaw ?? []) as Expense[];
  const atts = (attRaw ?? []) as Attachment[];
  const chById = new Map(channels.map((c) => [c.id, c]));

  const rows: RowData[] = [];
  const missing: Outlet[] = [];
  const anomalies: string[] = [];
  const totals = { total: 0, cash: 0, pos: 0, other: 0, expenses: 0, refunds: 0, deposit: 0 };
  const bTot = { withBudget: 0, dayTarget: 0, toDateTarget: 0, monthGross: 0, mtd: 0, projection: 0 };

  for (const o of outlets) {
    const c = todays.find((x) => x.outlet_id === o.id) ?? null;
    // Obiettivo dell'outlet: solo se ha un budget ricavi per il mese
    let budget: Budget | null = null;
    const net = o.cost_center_key ? budgetNetByCc.get(o.cost_center_key) : undefined;
    if (net != null && net > 0) {
      const monthGross = net * grossFactor;
      const dayTarget = monthGross / daysInMonth;
      const mine = allClosings.filter((x) => x.outlet_id === o.id && x.status !== "bozza" && !x.is_closed_day);
      const mtd = mine.reduce((sum, x) => sum + num(x.total_receipts), 0);
      const mtdDays = mine.length;
      budget = { monthNet: net, monthGross, dayTarget, toDateTarget: dayTarget * d, mtd, mtdDays, projection: mtdDays > 0 ? (mtd / d) * daysInMonth : 0 };
      bTot.withBudget += 1; bTot.dayTarget += dayTarget; bTot.toDateTarget += budget.toDateTarget; bTot.monthGross += monthGross; bTot.mtd += mtd; bTot.projection += budget.projection;
    }
    if (!c) { missing.push(o); rows.push({ outlet: o, closing: null, cash: 0, pos: 0, other: 0, status: "manca", budget }); continue; }
    let cash = 0, pos = 0, other = 0;
    for (const l of lines.filter((l) => l.closing_id === c.id)) {
      const ch = chById.get(l.channel_id);
      if (!ch || !ch.counts_in_total) continue;
      if (ch.kind === "fattura") continue; // le fatture si sommano ai corrispettivi, non sono un mezzo di pagamento
      if (ch.kind === "contanti") cash += num(l.amount);
      else if (ch.kind === "pos" || ch.kind === "pos_amex") pos += num(l.amount);
      else other += num(l.amount);
    }
    const status = c.is_closed_day ? "chiuso" : c.status === "bozza" ? "bozza" : "confermata";
    rows.push({ outlet: o, closing: c, cash, pos, other, status, budget });
    if (!c.is_closed_day) {
      totals.total += num(c.total_receipts); totals.cash += cash; totals.pos += pos; totals.other += other;
      totals.expenses += num(c.cash_expenses); totals.refunds += num(c.customer_refunds); totals.deposit += num(c.cash_deposit);
      if (c.status === "bozza") anomalies.push(`${o.name}: chiusura ancora in bozza, non confermata`);
      if (Math.abs(num(c.receipts_difference)) >= 0.005) anomalies.push(`${o.name}: totale incassato (corrispettivi${num(c.invoices_total) ? " + fatture" : ""}) e somma dei mezzi di pagamento non quadrano (differenza ${eur(num(c.receipts_difference))})`);
      if (c.cash_difference != null && Math.abs(num(c.cash_difference)) >= 0.005) anomalies.push(`${o.name}: contante in cassa (fondo + da versare) ${num(c.cash_difference) > 0 ? "in eccedenza" : "in ammanco"} di ${eur(Math.abs(num(c.cash_difference)))}`);
      const myAtts = atts.filter((a) => a.closing_id === c.id);
      if (!myAtts.some((a) => a.target === "totale")) anomalies.push(`${o.name}: manca la foto dello scontrino di chiusura`);
      for (const a of myAtts) {
        const read = extractedAmount(a.extracted);
        if (read == null || !["letta", "da_rivedere"].includes(a.extraction_status)) continue;
        let declared: number | null = null; let what = "";
        if (a.target === "totale") { declared = num(c.total_receipts); what = "totale corrispettivi"; }
        else if (a.target === "versamento") { declared = num(c.cash_deposit); what = "versamento"; }
        else if (a.target === "canale") { const l = lines.find((x) => x.id === a.line_id); if (l) { declared = num(l.amount); what = chById.get(l.channel_id)?.label ?? "canale"; } }
        else if (a.target === "spesa") { const e = expenses.find((x) => x.id === a.expense_id); if (e) { declared = num(e.amount); what = `spesa ${e.description ?? ""}`.trim(); } }
        if (declared != null && Math.abs(declared - read) >= 0.005) anomalies.push(`${o.name}: ${what} scritto ${eur(declared)} ma dalla foto risulta ${eur(read)}`);
      }
      if (c.notes) anomalies.push(`${o.name}: nota della cassiera «${c.notes}»`);
    }
  }
  return {
    companyName: (company?.name as string) ?? "", date, outlets, rows, missing, anomalies, totals, monthToDate,
    monthLabel: `${MESI[m - 1]} ${y}`, appUrl,
    budget: { vatRate, dayOfMonth: d, daysInMonth, ...bTot },
  };
}

// Scostamento con segno: "+1.234,00 €" / "-56,00 €"
function delta(n: number): string { return (n >= 0 ? "+" : "") + eur(n); }
function deltaStyle(n: number): string { return Math.abs(n) < 0.005 ? "" : n > 0 ? "color:#047857;font-weight:600" : "color:#b91c1c;font-weight:600"; }
function pct(part: number, whole: number): string { return whole > 0 ? `${Math.round((part / whole) * 100)} %` : "—"; }

function renderHtml(r: ReportData): { subject: string; html: string; text: string } {
  const b = r.budget;
  const hasBudget = b.withBudget > 0;
  const dayDelta = r.totals.total - b.dayTarget;
  const mtdDelta = b.mtd - b.toDateTarget;
  const subject = `Incassi ${dateIt(r.date, false)} · ${r.companyName}: ${r.rows.length - r.missing.length}/${r.rows.length} chiusure, totale ${eur(r.totals.total)}${hasBudget ? ` (${delta(dayDelta)} vs obiettivo)` : ""}`;
  const td = (v: string, align = "right", extra = "") => `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:${align};font-variant-numeric:tabular-nums;${extra}">${v}</td>`;
  const th = (v: string, align = "right") => `<th style="padding:6px 8px;border-bottom:2px solid #cbd5e1;text-align:${align};font-size:12px;color:#475569;white-space:nowrap">${v}</th>`;
  const link = (path: string) => r.appUrl ? `${r.appUrl.replace(/\/$/, "")}${path}` : null;
  const rowsHtml = r.rows.map((row) => {
    const c = row.closing;
    const tgt = row.budget ? eur(row.budget.dayTarget) : "—";
    if (!c) return `<tr style="background:#fef2f2">${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td(`<span style="color:#b91c1c;font-weight:600">manca</span>`, "left")}${td("—")}${td(tgt)}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}</tr>`;
    if (c.is_closed_day) return `<tr style="background:#f8fafc;color:#64748b">${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td("negozio chiuso", "left")}${td("0,00 €")}${td(tgt)}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}</tr>`;
    const dd = row.budget ? num(c.total_receipts) - row.budget.dayTarget : null;
    const diff = c.cash_difference == null ? "—" : eur(num(c.cash_difference));
    const diffStyle = c.cash_difference != null && Math.abs(num(c.cash_difference)) >= 0.005 ? "color:#b91c1c;font-weight:600" : "";
    const st = c.status === "bozza" ? `<span style="color:#b45309;font-weight:600">bozza</span>` : `<span style="color:#047857">confermata</span>`;
    return `<tr>${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td(st, "left")}${td(`<strong>${eur(num(c.total_receipts))}</strong>${num(c.invoices_total) ? `<br><span style="font-size:11px;color:#64748b">+ fatture ${eur(num(c.invoices_total))}</span>` : ""}`)}${td(tgt)}${td(dd == null ? "—" : delta(dd), "right", dd == null ? "" : deltaStyle(dd))}${td(eur(row.cash))}${td(eur(row.pos))}${td(eur(row.other))}${td(eur(num(c.cash_expenses) + num(c.customer_refunds)))}${td(eur(num(c.cash_deposit)))}${td(c.cash_float_declared == null ? "—" : `${eur(num(c.cash_float_declared))}${c.cash_pending_declared != null && num(c.cash_pending_declared) > 0 ? `<br><span style="font-size:11px;color:#64748b">+ da versare ${eur(num(c.cash_pending_declared))}</span>` : ""}`)}${td(diff, "right", diffStyle)}</tr>`;
  }).join("");
  const t = r.totals;
  const totalRow = `<tr style="background:#f1f5f9;font-weight:700">${td("Totale azienda", "left")}${td(`${r.rows.length - r.missing.length}/${r.rows.length}`, "left")}${td(eur(t.total))}${td(hasBudget ? eur(b.dayTarget) : "—")}${td(hasBudget ? delta(dayDelta) : "—", "right", hasBudget ? deltaStyle(dayDelta) : "")}${td(eur(t.cash))}${td(eur(t.pos))}${td(eur(t.other))}${td(eur(t.expenses + t.refunds))}${td(eur(t.deposit))}${td("")}${td("")}</tr>`;
  const anomaliesHtml = r.anomalies.length
    ? `<h3 style="margin:20px 0 6px;font-size:14px;color:#b45309">Da controllare (${r.anomalies.length})</h3><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${r.anomalies.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
    : `<p style="margin:20px 0 6px;font-size:13px;color:#047857">Nessuna anomalia: tutte le chiusure confermate quadrano e hanno la foto dello scontrino di chiusura.</p>`;
  const missingHtml = r.missing.length
    ? `<p style="margin:12px 0 0;font-size:13px;color:#b91c1c"><strong>Chiusure mancanti (${r.missing.length}):</strong> ${r.missing.map((o) => esc(o.name)).join(", ")}</p>` : "";
  const pageLink = link(`/incassi-giornalieri?date=${r.date}`);
  const budgetLink = link(`/budget?tab=rapido`);
  const monthRows = r.rows.filter((row) => row.budget).map((row) => {
    const bb = row.budget!;
    const md = bb.mtd - bb.toDateTarget;
    return `<tr>${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td(eur(bb.monthGross))}${td(eur(bb.toDateTarget))}${td(`<strong>${eur(bb.mtd)}</strong>`)}${td(`${delta(md)} (${pct(bb.mtd, bb.toDateTarget)})`, "right", deltaStyle(md))}${td(pct(bb.mtd, bb.monthGross))}${td(bb.mtdDays > 0 ? eur(bb.projection) : "—")}</tr>`;
  }).join("");
  const noBudgetNames = r.rows.filter((row) => !row.budget).map((row) => esc(row.outlet.name));
  const monthHtml = hasBudget
    ? `<h3 style="margin:22px 0 6px;font-size:14px;color:#0f172a">Mese vs obiettivo · ${esc(r.monthLabel)}, giorno ${b.dayOfMonth} di ${b.daysInMonth}</h3>
<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr>${th("Punto vendita", "left")}${th("Budget mese")}${th("Obiettivo a oggi")}${th("Incassato a oggi")}${th("Vs obiettivo a oggi")}${th("Raggiunto del mese")}${th("Proiezione fine mese")}</tr></thead>
<tbody>${monthRows}<tr style="background:#f1f5f9;font-weight:700">${td("Totale azienda", "left")}${td(eur(b.monthGross))}${td(eur(b.toDateTarget))}${td(eur(b.mtd))}${td(`${delta(mtdDelta)} (${pct(b.mtd, b.toDateTarget)})`, "right", deltaStyle(mtdDelta))}${td(pct(b.mtd, b.monthGross))}${td(eur(b.projection))}</tr></tbody></table></div>
<p style="margin:6px 0 0;font-size:11px;color:#64748b">Budget mese = budget ricavi del mese dell'Inserimento rapido (netto IVA) + IVA ${String(b.vatRate).replace(".", ",")} %; obiettivo a oggi = budget mese ÷ ${b.daysInMonth} giorni × giorni trascorsi. «Vs obiettivo a oggi» dice se si è in linea con il ritmo del mese; «Raggiunto del mese» è la quota del budget mese già incassata. Incassato = chiusure non in bozza, oggi compreso. Proiezione = media dei giorni trascorsi × giorni del mese.${noBudgetNames.length ? ` Senza budget per questo mese: ${noBudgetNames.join(", ")}.` : ""}${budgetLink ? ` <a href="${esc(budgetLink)}" style="color:#1d4ed8">Modifica il budget</a>.` : ""}</p>`
    : `<p style="margin:20px 0 0;font-size:12px;color:#64748b">Nessun budget ricavi per ${esc(r.monthLabel)} nell'Inserimento rapido: il confronto con l'obiettivo non è disponibile.${budgetLink ? ` <a href="${esc(budgetLink)}" style="color:#1d4ed8">Inserisci il budget</a>.` : ""}</p>`;
  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:900px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px">Incassi di ${esc(dateIt(r.date))}</h2>
<p style="margin:0 0 14px;font-size:13px;color:#475569">${esc(r.companyName)} · ${r.rows.length - r.missing.length} chiusure su ${r.rows.length} punti vendita · totale giornata <strong>${eur(t.total)}</strong>${hasBudget ? ` (obiettivo ${eur(b.dayTarget)}, <span style="${deltaStyle(dayDelta)}">${delta(dayDelta)}</span>)` : ""} · progressivo ${esc(r.monthLabel)} <strong>${eur(r.monthToDate)}</strong>${hasBudget ? ` (obiettivo a oggi ${eur(b.toDateTarget)}, <span style="${deltaStyle(mtdDelta)}">${delta(mtdDelta)}</span>)` : ""}</p>
<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr>${th("Punto vendita", "left")}${th("Stato", "left")}${th("Totale")}${th("Obiettivo giorno")}${th("+/- obiettivo")}${th("Contanti")}${th("POS")}${th("Altri")}${th("Spese e rimborsi")}${th("Versamento")}${th("Fondo cassa contato")}${th("Diff. cassa")}</tr></thead>
<tbody>${rowsHtml}${totalRow}</tbody></table></div>
${missingHtml}
${monthHtml}
${anomaliesHtml}
${pageLink ? `<p style="margin:20px 0 0;font-size:13px"><a href="${esc(pageLink)}" style="color:#1d4ed8">Apri Incassi giornalieri</a> per il dettaglio e le foto.</p>` : ""}
<p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Mail automatica del gestionale. I numeri sono quelli scritti dalle cassiere alla chiusura; le anomalie sono segnalazioni da verificare, non correzioni.</p>
</div></body></html>`;
  const text = [
    `Incassi di ${dateIt(r.date)} · ${r.companyName}`,
    `Totale giornata ${eur(t.total)}${hasBudget ? ` · obiettivo ${eur(b.dayTarget)} (${delta(dayDelta)})` : ""} · progressivo ${r.monthLabel} ${eur(r.monthToDate)}${hasBudget ? ` · obiettivo a oggi ${eur(b.toDateTarget)} (${delta(mtdDelta)})` : ""}`,
    "",
    ...r.rows.map((row) => {
      const tgt = row.budget ? ` · obiettivo ${eur(row.budget.dayTarget)}` : "";
      if (!row.closing) return `${row.outlet.name}: MANCA${tgt}`;
      if (row.closing.is_closed_day) return `${row.outlet.name}: negozio chiuso`;
      const dd = row.budget ? ` (${delta(num(row.closing.total_receipts) - row.budget.dayTarget)})` : "";
      const inv = num(row.closing.invoices_total) ? ` + fatture ${eur(num(row.closing.invoices_total))}` : "";
      const pend = row.closing.cash_pending_declared != null && num(row.closing.cash_pending_declared) > 0 ? `, da versare ${eur(num(row.closing.cash_pending_declared))}` : "";
      return `${row.outlet.name}: ${eur(num(row.closing.total_receipts))}${inv}${tgt}${dd} · contanti ${eur(row.cash)}, POS ${eur(row.pos)}, altri ${eur(row.other)}, versamento ${eur(num(row.closing.cash_deposit))}${pend} ${row.closing.status === "bozza" ? "[BOZZA]" : ""}`;
    }),
    "",
    ...(hasBudget ? [`Mese vs obiettivo (giorno ${b.dayOfMonth} di ${b.daysInMonth}):`, ...r.rows.filter((row) => row.budget).map((row) => `- ${row.outlet.name}: incassato ${eur(row.budget!.mtd)} su obiettivo a oggi ${eur(row.budget!.toDateTarget)} (${delta(row.budget!.mtd - row.budget!.toDateTarget)}), budget mese ${eur(row.budget!.monthGross)} raggiunto al ${pct(row.budget!.mtd, row.budget!.monthGross)}`), `- Totale: ${eur(b.mtd)} su ${eur(b.toDateTarget)} (${delta(mtdDelta)}), budget mese ${eur(b.monthGross)}, proiezione ${eur(b.projection)}`, ""] : []),
    r.anomalies.length ? `Da controllare:\n${r.anomalies.map((a) => `- ${a}`).join("\n")}` : "Nessuna anomalia.",
    pageLink ? `\n${pageLink}` : "",
  ].join("\n");
  return { subject, html, text };
}

// ─── WhatsApp: variabili del modello ────────────────────────────────────
// Il modello vive sull'account Twilio (approvato da Meta) e si legge a ogni
// invio dalla Content API: ogni riga con {{n}} ha un'etichetta fissa che dice
// cosa metterci. Esempio (NZ, «incassi_giornalieri_v8», approvato 2026-09-08;
// Meta rifiuta i modelli con poco testo fisso, da qui i nomi nel testo e la riga finale):
//   Report incassi del giorno {{1}}
//   Barberino {{2}}
//   Brugnato {{3}}
//   …
//   Totale giornaliero complessivo di tutti i punti vendita {{9}} euro
//   (nessun piè di pagina: il modello finisce con la riga del totale)
// Regole di riempimento (Meta vieta gli "a capo" e le variabili vuote):
//   - etichetta con «giorno»/«data»/«report» → data gg/mm/aa ([PROVA] nella prova)
//   - etichetta con «totale» → totale della giornata
//   - etichetta = nome di un punto vendita → incasso di quel negozio
//     («manca» se non ha chiuso, «chiuso» se giorno di chiusura, «(bozza)» se non confermato)
//   - riga con la sola {{n}} → prossimo punto vendita non ancora assegnato, in ordine di nome
//   - slot senza corrispondenza → «-»
function eurPlain(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}
function oneLine(s: string): string { const t = s.replace(/\s+/g, " ").trim(); return t || "-"; }
function normName(s: string): string { return s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, ""); }
function rowAmount(row: RowData): string {
  const c = row.closing;
  if (!c) return "manca";
  if (c.is_closed_day) return "chiuso";
  return `${eurPlain(num(c.total_receipts))}${c.status === "bozza" ? " (bozza)" : ""}`;
}
function whatsappVariables(r: ReportData, kind: string, templateBody: string): Record<string, string> {
  const [y, m, d] = r.date.split("-");
  const dateStr = `${d}/${m}/${y.slice(2)}${kind === "test" ? " [PROVA]" : ""}`;
  const vars: Record<string, string> = {};
  const used = new Set<string>();
  const rows = [...r.rows].sort((a, b) => a.outlet.name.localeCompare(b.outlet.name, "it"));
  const bare: string[] = [];
  for (const line of templateBody.split("\n")) {
    const mm = line.match(/\{\{(\d+)\}\}/);
    if (!mm) continue;
    const n = mm[1];
    const label = line.replace(/\{\{\d+\}\}/g, "").replace(/[€:·]/g, "").trim();
    if (!label) { bare.push(n); continue; }
    if (/giorno|data|report/i.test(label)) { vars[n] = dateStr; continue; }
    if (/totale/i.test(label)) { vars[n] = eurPlain(r.totals.total); continue; }
    const row = rows.find((x) => normName(x.outlet.name) === normName(label));
    if (row) { vars[n] = rowAmount(row); used.add(row.outlet.id); } else vars[n] = "-";
  }
  const rest = rows.filter((x) => !used.has(x.outlet.id));
  for (const n of bare) {
    const row = rest.shift();
    vars[n] = row ? `${row.outlet.name} ${rowAmount(row)}` : "-";
  }
  for (const k of Object.keys(vars)) vars[k] = oneLine(vars[k]);
  return vars;
}

type WaResult = { status: "sent" | "partial" | "failed"; error: string | null };
async function sendWhatsApp(admin: SupabaseClient, r: ReportData, to: string[], kind: string): Promise<WaResult> {
  const { data, error } = await admin.rpc("get_twilio_whatsapp_config");
  const cfg = (Array.isArray(data) ? data[0] : data) as { account_sid?: string; auth_token?: string; from_number?: string; content_sid?: string } | null;
  if (error || !cfg?.account_sid || !cfg?.auth_token || !cfg?.from_number || !cfg?.content_sid) {
    return { status: "failed", error: "WhatsApp non configurato: mancano i segreti Twilio nel Vault (twilio_account_sid, twilio_auth_token, twilio_whatsapp_from, twilio_whatsapp_content_sid)" };
  }
  const from = cfg.from_number.startsWith("whatsapp:") ? cfg.from_number : `whatsapp:${cfg.from_number}`;
  const auth = "Basic " + btoa(`${cfg.account_sid}:${cfg.auth_token}`);
  // Corpo del modello dalla Content API: le etichette dicono cosa mettere in ogni variabile.
  let templateBody = "";
  try {
    const t = await fetch(`https://content.twilio.com/v1/Content/${encodeURIComponent(cfg.content_sid)}`, { headers: { "Authorization": auth } });
    if (t.ok) {
      const j = await t.json() as { types?: Record<string, { body?: string }> };
      templateBody = j.types?.["twilio/text"]?.body ?? "";
    }
  } catch (e) {
    console.warn("[daily-cash-report-send] modello WhatsApp non letto:", (e as Error).message);
  }
  if (!templateBody) return { status: "failed", error: "Modello WhatsApp non leggibile dalla Content API (twilio_whatsapp_content_sid)" };
  const vars = JSON.stringify(whatsappVariables(r, kind, templateBody));
  const errors: string[] = [];
  let ok = 0;
  for (const n of to) {
    const body = new URLSearchParams({ From: from, To: n.startsWith("whatsapp:") ? n : `whatsapp:${n}`, ContentSid: cfg.content_sid, ContentVariables: vars });
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.account_sid)}/Messages.json`, {
        method: "POST", headers: { "Authorization": auth, "Content-Type": "application/x-www-form-urlencoded" }, body,
      });
      if (res.ok) { ok++; continue; }
      const t = (await res.text()).slice(0, 300);
      console.error(`[daily-cash-report-send] Twilio ${res.status} to=${n}:`, t);
      errors.push(`${n}: ${res.status} ${t}`);
    } catch (e) {
      errors.push(`${n}: ${(e as Error).message}`);
    }
  }
  return { status: ok === to.length ? "sent" : ok > 0 ? "partial" : "failed", error: errors.length ? errors.join(" | ").slice(0, 500) : null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, supabaseServiceKey);
  let logId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const body = await req.json().catch(() => ({}));

    // ─── Chi chiama ────────────────────────────────────────────────────
    let trusted = token === supabaseServiceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
      if (!trusted) return jsonError(403, "Segreto x-autofix-cron non valido", "FORBIDDEN");
    }
    let companyId: string; let kind: string; let reportDate: string; let testTo: string[] | null = null;
    if (trusted) {
      companyId = String(body.company_id ?? "");
      kind = body.kind === "test" ? "test" : "report";
      reportDate = String(body.report_date ?? romeToday());
      logId = body.log_id ? String(body.log_id) : null;
      if (kind === "test" && Array.isArray(body.to)) testTo = body.to.map(String);
    } else {
      // Utente loggato: solo super_advisor/contabile, solo prova a se stesso.
      const asUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: userData } = await asUser.auth.getUser();
      const user = userData?.user;
      if (!user) return jsonError(401, "Invalid JWT");
      const { data: profile } = await admin.from("user_profiles").select("company_id, role, email").eq("id", user.id).maybeSingle();
      if (!profile || !["super_advisor", "contabile"].includes(String(profile.role))) return jsonError(403, "Solo super advisor e contabile possono inviare la prova", "FORBIDDEN");
      companyId = String(profile.company_id);
      kind = "test";
      reportDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.report_date ?? "")) ? String(body.report_date) : romeToday();
      testTo = [String(user.email ?? profile.email ?? "")].filter(Boolean);
      if (testTo.length === 0) return jsonError(400, "Il tuo utente non ha un indirizzo email", "NO_RECIPIENTS");
    }
    if (!/^[0-9a-f-]{36}$/i.test(companyId)) return jsonError(400, "company_id mancante", "BAD_REQUEST");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return jsonError(400, "report_date non valida", "BAD_REQUEST");

    const { data: settings } = await admin.from("daily_report_settings").select("*").eq("company_id", companyId).maybeSingle();
    // Canale: 'email' (default) oppure 'whatsapp' (prova solo WhatsApp; il cron manda entrambi se whatsapp_enabled).
    const channel: "email" | "whatsapp" = body.channel === "whatsapp" ? "whatsapp" : "email";
    const waRecipients: string[] = ((settings?.whatsapp_recipients as string[] | null) ?? []).filter(Boolean);
    const waEnabled = settings?.whatsapp_enabled === true;
    const recipients: string[] = channel === "whatsapp" ? waRecipients : (testTo ?? ((settings?.recipients as string[] | null) ?? []));
    const appUrl = (settings?.app_url as string | null) ?? null;
    const vatRate = Number.isFinite(Number(settings?.budget_vat_rate)) ? Number(settings?.budget_vat_rate) : 22;

    const finish = async (status: "sent" | "failed" | "skipped", extra: Record<string, unknown>) => {
      const row = { company_id: companyId, report_date: reportDate, kind, status, recipients, ...extra, sent_at: status === "sent" ? new Date().toISOString() : null };
      if (logId) await admin.from("daily_report_log").update(row).eq("id", logId);
      else await admin.from("daily_report_log").insert(row);
    };

    if (recipients.length === 0) {
      await finish("skipped", { error: channel === "whatsapp" ? "nessun numero WhatsApp configurato" : "nessun destinatario" });
      return jsonError(400, channel === "whatsapp" ? "Nessun numero WhatsApp configurato" : "Nessun destinatario configurato", "NO_RECIPIENTS");
    }

    const report = await buildReport(admin, companyId, reportDate, appUrl, vatRate);
    const summary = { closings: report.rows.length - report.missing.length, outlets: report.rows.length, total: report.totals.total, anomalies: report.anomalies.length, month_to_date: report.monthToDate, day_target: report.budget.dayTarget, to_date_target: report.budget.toDateTarget };
    const noData = report.rows.length - report.missing.length === 0;
    if (noData && kind === "report" && settings && settings.send_on_empty === false) {
      await finish("skipped", { summary, error: "nessuna chiusura registrata e invio senza dati disattivato" });
      return jsonOk({ data: { status: "skipped", summary } });
    }

    const { subject, html, text } = renderHtml(report);
    const wantEmail = channel === "email";
    const wantWa = channel === "whatsapp" || (kind === "report" && waEnabled && waRecipients.length > 0);

    let emailError: string | null = null;
    if (wantEmail) {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("DISTINTA_EMAIL_FROM");
      if (!resendKey || !from) {
        emailError = "RESEND_API_KEY o DISTINTA_EMAIL_FROM assenti";
      } else {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: recipients, subject: kind === "test" ? `[PROVA] ${subject}` : subject, html, text }),
        });
        if (!r.ok) {
          const errText = (await r.text()).slice(0, 500);
          console.error(`[daily-cash-report-send] Resend ${r.status}:`, errText);
          emailError = `Resend ${r.status}: ${errText}`;
        }
      }
    }

    // WhatsApp: la mail non blocca WhatsApp e viceversa; l'esito va nel log.
    let wa: WaResult | null = null;
    if (wantWa) wa = await sendWhatsApp(admin, report, waRecipients, kind);

    const failed = wantEmail ? emailError != null : wa?.status === "failed";
    await finish(failed ? "failed" : "sent", { subject, summary, error: emailError, whatsapp_status: wa?.status ?? null, whatsapp_error: wa?.error ?? null });
    if (failed) {
      if (wantEmail && emailError === "RESEND_API_KEY o DISTINTA_EMAIL_FROM assenti") return jsonError(503, "Invio email non configurato (RESEND_API_KEY / DISTINTA_EMAIL_FROM)", "EMAIL_NOT_CONFIGURED");
      return wantEmail ? jsonError(502, "Invio email non riuscito", "RESEND_API_ERROR") : jsonError(502, `WhatsApp non inviato: ${wa?.error ?? "errore"}`, "WHATSAPP_ERROR");
    }
    console.log(`[daily-cash-report-send] company=${companyId} date=${reportDate} kind=${kind} channel=${channel} to=${recipients.length} wa=${wa?.status ?? "-"} closings=${summary.closings}/${summary.outlets}`);
    return jsonOk({ data: { status: "sent", subject, summary, recipients, whatsapp: wa ? { status: wa.status, recipients: waRecipients, error: wa.error } : null } });
  } catch (error) {
    console.error(`[daily-cash-report-send] Error:`, error);
    if (logId) await admin.from("daily_report_log").update({ status: "failed", error: String((error as Error).message).slice(0, 500) }).eq("id", logId);
    return jsonError(500, (error as Error).message);
  }
});
