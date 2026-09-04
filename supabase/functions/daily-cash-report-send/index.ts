// Edge Function: daily-cash-report-send
//
// Fase 2 dello specchietto incassi: compone e invia via mail (Resend) il
// riepilogo serale delle chiusure di cassa di un giorno per tutti i punti
// vendita dell'azienda: una riga per outlet, mancanti in evidenza, anomalie
// (giornate che non quadrano, foto mancanti, letture automatiche diverse da
// quanto scritto), totale azienda e progressivo del mese.
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

interface Outlet { id: string; name: string }
interface Channel { id: string; outlet_id: string; label: string; kind: string; counts_in_total: boolean }
interface Closing {
  id: string; outlet_id: string; status: string; is_closed_day: boolean; total_receipts: number; channels_total: number;
  receipts_difference: number; cash_expenses: number; customer_refunds: number; cash_deposit: number;
  cash_float_declared: number | null; cash_float_expected: number | null; cash_difference: number | null;
  closed_by_name: string | null; notes: string | null; confirmed_at: string | null;
}
interface Line { closing_id: string; channel_id: string; amount: number; id: string }
interface Expense { id: string; closing_id: string; kind: string; amount: number; description: string | null }
interface Attachment { closing_id: string; target: string; line_id: string | null; expense_id: string | null; extraction_status: string; extracted: Record<string, unknown> | null }

const num = (v: unknown) => (v == null ? 0 : Number(v));
const extractedAmount = (e: Record<string, unknown> | null): number | null => {
  const v = e?.amount; return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
};

interface ReportData {
  companyName: string; date: string; outlets: Outlet[]; rows: RowData[]; missing: Outlet[]; anomalies: string[];
  totals: { total: number; cash: number; pos: number; other: number; expenses: number; refunds: number; deposit: number };
  monthToDate: number; monthLabel: string; appUrl: string | null;
}
interface RowData {
  outlet: Outlet; closing: Closing | null; cash: number; pos: number; other: number; status: string;
}

async function buildReport(admin: SupabaseClient, companyId: string, date: string, appUrl: string | null): Promise<ReportData> {
  const [{ data: company }, { data: outletsRaw }, { data: channelsRaw }] = await Promise.all([
    admin.from("companies").select("name").eq("id", companyId).maybeSingle(),
    admin.from("outlets").select("id, name, outlet_type, is_active").eq("company_id", companyId).order("name"),
    admin.from("outlet_payment_channels").select("id, outlet_id, label, kind, counts_in_total").eq("company_id", companyId).eq("is_active", true),
  ]);
  const outlets: Outlet[] = (outletsRaw ?? [])
    .filter((o) => (o.is_active ?? true) && !NON_SELLING.includes(String(o.outlet_type ?? "outlet").toLowerCase()))
    .map((o) => ({ id: o.id, name: o.name }));
  const channels = (channelsRaw ?? []) as Channel[];
  const outletIds = outlets.map((o) => o.id);

  const monthStart = `${date.slice(0, 7)}-01`;
  const { data: closingsRaw } = outletIds.length
    ? await admin.from("outlet_daily_closings")
      .select("id, outlet_id, closing_date, status, is_closed_day, total_receipts, channels_total, receipts_difference, cash_expenses, customer_refunds, cash_deposit, cash_float_declared, cash_float_expected, cash_difference, closed_by_name, notes, confirmed_at")
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

  for (const o of outlets) {
    const c = todays.find((x) => x.outlet_id === o.id) ?? null;
    if (!c) { missing.push(o); rows.push({ outlet: o, closing: null, cash: 0, pos: 0, other: 0, status: "manca" }); continue; }
    let cash = 0, pos = 0, other = 0;
    for (const l of lines.filter((l) => l.closing_id === c.id)) {
      const ch = chById.get(l.channel_id);
      if (!ch || !ch.counts_in_total) continue;
      if (ch.kind === "contanti") cash += num(l.amount);
      else if (ch.kind === "pos" || ch.kind === "pos_amex") pos += num(l.amount);
      else other += num(l.amount);
    }
    const status = c.is_closed_day ? "chiuso" : c.status === "bozza" ? "bozza" : "confermata";
    rows.push({ outlet: o, closing: c, cash, pos, other, status });
    if (!c.is_closed_day) {
      totals.total += num(c.total_receipts); totals.cash += cash; totals.pos += pos; totals.other += other;
      totals.expenses += num(c.cash_expenses); totals.refunds += num(c.customer_refunds); totals.deposit += num(c.cash_deposit);
      if (c.status === "bozza") anomalies.push(`${o.name}: chiusura ancora in bozza, non confermata`);
      if (Math.abs(num(c.receipts_difference)) >= 0.005) anomalies.push(`${o.name}: totale corrispettivi e somma dei mezzi di pagamento non quadrano (differenza ${eur(num(c.receipts_difference))})`);
      if (c.cash_difference != null && Math.abs(num(c.cash_difference)) >= 0.005) anomalies.push(`${o.name}: fondo cassa ${num(c.cash_difference) > 0 ? "in eccedenza" : "in ammanco"} di ${eur(Math.abs(num(c.cash_difference)))}`);
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
  const [y, m] = date.split("-").map(Number);
  return {
    companyName: (company?.name as string) ?? "", date, outlets, rows, missing, anomalies, totals, monthToDate,
    monthLabel: `${MESI[m - 1]} ${y}`, appUrl,
  };
}

function renderHtml(r: ReportData): { subject: string; html: string; text: string } {
  const subject = `Incassi ${dateIt(r.date, false)} · ${r.companyName}: ${r.rows.length - r.missing.length}/${r.rows.length} chiusure, totale ${eur(r.totals.total)}`;
  const td = (v: string, align = "right", extra = "") => `<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:${align};font-variant-numeric:tabular-nums;${extra}">${v}</td>`;
  const th = (v: string, align = "right") => `<th style="padding:6px 8px;border-bottom:2px solid #cbd5e1;text-align:${align};font-size:12px;color:#475569;white-space:nowrap">${v}</th>`;
  const link = (path: string) => r.appUrl ? `${r.appUrl.replace(/\/$/, "")}${path}` : null;
  const rowsHtml = r.rows.map((row) => {
    const c = row.closing;
    if (!c) return `<tr style="background:#fef2f2">${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td(`<span style="color:#b91c1c;font-weight:600">manca</span>`, "left")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}${td("—")}</tr>`;
    if (c.is_closed_day) return `<tr style="background:#f8fafc;color:#64748b">${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td("negozio chiuso", "left")}${td("0,00 €")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}${td("")}</tr>`;
    const diff = c.cash_difference == null ? "—" : eur(num(c.cash_difference));
    const diffStyle = c.cash_difference != null && Math.abs(num(c.cash_difference)) >= 0.005 ? "color:#b91c1c;font-weight:600" : "";
    const st = c.status === "bozza" ? `<span style="color:#b45309;font-weight:600">bozza</span>` : `<span style="color:#047857">confermata</span>`;
    return `<tr>${td(`<strong>${esc(row.outlet.name)}</strong>`, "left")}${td(st, "left")}${td(`<strong>${eur(num(c.total_receipts))}</strong>`)}${td(eur(row.cash))}${td(eur(row.pos))}${td(eur(row.other))}${td(eur(num(c.cash_expenses) + num(c.customer_refunds)))}${td(eur(num(c.cash_deposit)))}${td(c.cash_float_declared == null ? "—" : eur(num(c.cash_float_declared)))}${td(diff, "right", diffStyle)}</tr>`;
  }).join("");
  const t = r.totals;
  const totalRow = `<tr style="background:#f1f5f9;font-weight:700">${td("Totale azienda", "left")}${td(`${r.rows.length - r.missing.length}/${r.rows.length}`, "left")}${td(eur(t.total))}${td(eur(t.cash))}${td(eur(t.pos))}${td(eur(t.other))}${td(eur(t.expenses + t.refunds))}${td(eur(t.deposit))}${td("")}${td("")}</tr>`;
  const anomaliesHtml = r.anomalies.length
    ? `<h3 style="margin:20px 0 6px;font-size:14px;color:#b45309">Da controllare (${r.anomalies.length})</h3><ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5">${r.anomalies.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`
    : `<p style="margin:20px 0 6px;font-size:13px;color:#047857">Nessuna anomalia: tutte le chiusure confermate quadrano e hanno la foto dello scontrino di chiusura.</p>`;
  const missingHtml = r.missing.length
    ? `<p style="margin:12px 0 0;font-size:13px;color:#b91c1c"><strong>Chiusure mancanti (${r.missing.length}):</strong> ${r.missing.map((o) => esc(o.name)).join(", ")}</p>` : "";
  const pageLink = link(`/incassi-giornalieri?date=${r.date}`);
  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:900px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px">Incassi di ${esc(dateIt(r.date))}</h2>
<p style="margin:0 0 14px;font-size:13px;color:#475569">${esc(r.companyName)} · ${r.rows.length - r.missing.length} chiusure su ${r.rows.length} punti vendita · totale giornata <strong>${eur(t.total)}</strong> · progressivo ${esc(r.monthLabel)} <strong>${eur(r.monthToDate)}</strong></p>
<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr>${th("Punto vendita", "left")}${th("Stato", "left")}${th("Totale")}${th("Contanti")}${th("POS")}${th("Altri")}${th("Spese e rimborsi")}${th("Versamento")}${th("Fondo cassa")}${th("Diff. cassa")}</tr></thead>
<tbody>${rowsHtml}${totalRow}</tbody></table></div>
${missingHtml}
${anomaliesHtml}
${pageLink ? `<p style="margin:20px 0 0;font-size:13px"><a href="${esc(pageLink)}" style="color:#1d4ed8">Apri Incassi giornalieri</a> per il dettaglio e le foto.</p>` : ""}
<p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Mail automatica del gestionale. I numeri sono quelli scritti dalle cassiere alla chiusura; le anomalie sono segnalazioni da verificare, non correzioni.</p>
</div></body></html>`;
  const text = [
    `Incassi di ${dateIt(r.date)} · ${r.companyName}`,
    `Totale giornata ${eur(t.total)} · progressivo ${r.monthLabel} ${eur(r.monthToDate)}`,
    "",
    ...r.rows.map((row) => row.closing
      ? (row.closing.is_closed_day ? `${row.outlet.name}: negozio chiuso` : `${row.outlet.name}: ${eur(num(row.closing.total_receipts))} (contanti ${eur(row.cash)}, POS ${eur(row.pos)}, altri ${eur(row.other)}, versamento ${eur(num(row.closing.cash_deposit))}) ${row.closing.status === "bozza" ? "[BOZZA]" : ""}`)
      : `${row.outlet.name}: MANCA`),
    "",
    r.anomalies.length ? `Da controllare:\n${r.anomalies.map((a) => `- ${a}`).join("\n")}` : "Nessuna anomalia.",
    pageLink ? `\n${pageLink}` : "",
  ].join("\n");
  return { subject, html, text };
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
    const recipients: string[] = testTo ?? ((settings?.recipients as string[] | null) ?? []);
    const appUrl = (settings?.app_url as string | null) ?? null;

    const finish = async (status: "sent" | "failed" | "skipped", extra: Record<string, unknown>) => {
      const row = { company_id: companyId, report_date: reportDate, kind, status, recipients, ...extra, sent_at: status === "sent" ? new Date().toISOString() : null };
      if (logId) await admin.from("daily_report_log").update(row).eq("id", logId);
      else await admin.from("daily_report_log").insert(row);
    };

    if (recipients.length === 0) {
      await finish("skipped", { error: "nessun destinatario" });
      return jsonError(400, "Nessun destinatario configurato", "NO_RECIPIENTS");
    }

    const report = await buildReport(admin, companyId, reportDate, appUrl);
    const summary = { closings: report.rows.length - report.missing.length, outlets: report.rows.length, total: report.totals.total, anomalies: report.anomalies.length, month_to_date: report.monthToDate };
    const noData = report.rows.length - report.missing.length === 0;
    if (noData && kind === "report" && settings && settings.send_on_empty === false) {
      await finish("skipped", { summary, error: "nessuna chiusura registrata e invio senza dati disattivato" });
      return jsonOk({ data: { status: "skipped", summary } });
    }

    const { subject, html, text } = renderHtml(report);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DISTINTA_EMAIL_FROM");
    if (!resendKey || !from) {
      await finish("failed", { subject, summary, error: "RESEND_API_KEY o DISTINTA_EMAIL_FROM assenti" });
      return jsonError(503, "Invio email non configurato (RESEND_API_KEY / DISTINTA_EMAIL_FROM)", "EMAIL_NOT_CONFIGURED");
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject: kind === "test" ? `[PROVA] ${subject}` : subject, html, text }),
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 500);
      console.error(`[daily-cash-report-send] Resend ${r.status}:`, errText);
      await finish("failed", { subject, summary, error: `Resend ${r.status}: ${errText}` });
      return jsonError(502, "Invio email non riuscito", "RESEND_API_ERROR");
    }
    await finish("sent", { subject, summary });
    console.log(`[daily-cash-report-send] company=${companyId} date=${reportDate} kind=${kind} to=${recipients.length} closings=${summary.closings}/${summary.outlets}`);
    return jsonOk({ data: { status: "sent", subject, summary, recipients } });
  } catch (error) {
    console.error(`[daily-cash-report-send] Error:`, error);
    if (logId) await admin.from("daily_report_log").update({ status: "failed", error: String((error as Error).message).slice(0, 500) }).eq("id", logId);
    return jsonError(500, (error as Error).message);
  }
});
