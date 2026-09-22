// Edge Function: cash-closing-reopen-request
//
// Il negozio chiede di riaprire una chiusura già confermata (punto sbagliato,
// numero da correggere). Fino al 21/09/2026 la richiesta creava solo un avviso
// dentro il gestionale: quel giorno Valmontone l'ha mandata alle 9:31 e nessuno
// l'ha vista, così al negozio è sembrato che la riapertura fosse impossibile.
// Ora la stessa richiesta arriva anche per mail all'amministrazione.
//
// Cosa fa, in quest'ordine:
//   1. chiama request_cash_closing_reopen CON IL JWT DEL NEGOZIO, così restano
//      in piedi i controlli della funzione SQL (stessa azienda, accesso a quel
//      punto vendita) e l'avviso in-app viene creato come prima;
//   2. con il service role legge chiusura, punto vendita e destinatari, e manda
//      la mail via Resend.
// Se la mail non è configurata o non parte, la richiesta resta valida: l'avviso
// in-app c'è comunque e la risposta lo dice (mail: "skipped" / "failed").
//
// Destinatari: daily_report_settings.reopen_recipients; se vuoto, i destinatari
// del report serale (recipients). Nessun indirizzo nel codice: mai valori di un
// tenant qui dentro.
//
// Secret della function: RESEND_API_KEY, DISTINTA_EMAIL_FROM (come send-distinta-email).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(status: number, message: string, code = "REOPEN_REQUEST_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
function dateIt(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MESI[m - 1]} ${y}`;
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  const abs = Math.round(Math.abs(v) * 100);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${int},${String(abs % 100).padStart(2, "0")} €`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const body = await req.json().catch(() => ({}));
    const closingId = String(body.closing_id ?? "");
    const reason = String(body.reason ?? "").slice(0, 500).trim();
    if (!/^[0-9a-f-]{36}$/i.test(closingId)) return jsonError(400, "closing_id mancante", "BAD_REQUEST");

    // 1. La richiesta la fa l'utente: i controlli di permesso restano quelli della funzione SQL.
    const asUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: userData } = await asUser.auth.getUser();
    const user = userData?.user;
    if (!user) return jsonError(401, "Invalid JWT");
    const { error: rpcErr } = await asUser.rpc("request_cash_closing_reopen", { p_closing_id: closingId, p_reason: reason || undefined });
    if (rpcErr) return jsonError(403, rpcErr.message, "FORBIDDEN");

    // 2. Mail all'amministrazione (il service role resta qui dentro).
    const { data: closing } = await admin.from("outlet_daily_closings")
      .select("id, company_id, outlet_id, closing_date, status, total_receipts, cash_float_declared, cash_pending_declared, cash_difference, closed_by_name")
      .eq("id", closingId).maybeSingle();
    if (!closing) return jsonOk({ data: { ok: true, mail: "skipped", reason: "chiusura non trovata dopo la richiesta" } });

    const [{ data: outlet }, { data: settings }] = await Promise.all([
      admin.from("outlets").select("name").eq("id", closing.outlet_id).maybeSingle(),
      admin.from("daily_report_settings").select("recipients, reopen_recipients, app_url").eq("company_id", closing.company_id).maybeSingle(),
    ]);
    const configured = ((settings?.reopen_recipients as string[] | null) ?? []).filter(Boolean);
    const fallback = ((settings?.recipients as string[] | null) ?? []).filter(Boolean);
    const recipients = configured.length > 0 ? configured : fallback;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DISTINTA_EMAIL_FROM");
    if (recipients.length === 0 || !resendKey || !from) {
      console.log(`[cash-closing-reopen-request] closing=${closingId} mail=skipped recipients=${recipients.length}`);
      return jsonOk({ data: { ok: true, mail: "skipped", recipients } });
    }

    const outletName = (outlet?.name as string | null) ?? "punto vendita";
    const dateLabel = dateIt(String(closing.closing_date));
    const appUrl = (settings?.app_url as string | null) ?? null;
    const link = appUrl ? `${appUrl.replace(/\/$/, "")}/incassi-giornalieri?outlet=${closing.outlet_id}&date=${closing.closing_date}` : null;
    const subject = `Riapertura chiusura cassa: ${outletName} del ${dateLabel}`;
    const righe = [
      `Totale corrispettivi: ${eur(Number(closing.total_receipts))}`,
      `Fondo cassa contato: ${eur(closing.cash_float_declared == null ? null : Number(closing.cash_float_declared))}`,
      `Contanti da versare contati: ${eur(closing.cash_pending_declared == null ? null : Number(closing.cash_pending_declared))}`,
      closing.cash_difference != null && Math.abs(Number(closing.cash_difference)) >= 0.005
        ? `Differenza di cassa: ${eur(Number(closing.cash_difference))}` : null,
    ].filter(Boolean) as string[];

    const text = [
      `${outletName} chiede di riaprire la chiusura di cassa del ${dateLabel}.`,
      "",
      reason ? `Motivo scritto dal negozio: «${reason}»` : "Il negozio non ha scritto un motivo.",
      closing.closed_by_name ? `Chiusura fatta da: ${closing.closed_by_name}` : "",
      `Richiesta inviata da: ${user.email ?? "utente del negozio"}`,
      "",
      "Come è adesso la giornata:",
      ...righe.map((r) => `- ${r}`),
      "",
      "Per riaprirla: Incassi giornalieri, apri la giornata del punto vendita e usa «Riapri la chiusura». Possono farlo super advisor e contabile.",
      link ? `\n${link}` : "",
    ].join("\n");

    const html = `<!doctype html><html lang="it"><body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px">
<h2 style="margin:0 0 6px;font-size:18px">Richiesta di riapertura: ${esc(outletName)}</h2>
<p style="margin:0 0 14px;font-size:14px;color:#475569">Chiusura di cassa del <strong>${esc(dateLabel)}</strong></p>
<p style="margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;font-size:14px">
${reason ? `Motivo scritto dal negozio: <strong>«${esc(reason)}»</strong>` : "Il negozio non ha scritto un motivo."}</p>
<p style="margin:0 0 6px;font-size:13px;color:#475569">Come è adesso la giornata:</p>
<ul style="margin:0 0 14px;padding-left:18px;font-size:13px;line-height:1.6">${righe.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
<p style="margin:0 0 14px;font-size:13px;color:#475569">
${closing.closed_by_name ? `Chiusura fatta da ${esc(closing.closed_by_name)}. ` : ""}Richiesta inviata da ${esc(user.email ?? "utente del negozio")}.</p>
<p style="margin:0 0 14px;font-size:13px">Per riaprirla: Incassi giornalieri, apri la giornata del punto vendita e usa «Riapri la chiusura». Possono farlo super advisor e contabile.</p>
${link ? `<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600">Apri la giornata</a></p>` : ""}
<p style="margin:16px 0 0;font-size:11px;color:#94a3b8">Mail automatica del gestionale: l'ha generata la richiesta del negozio, non una persona.</p>
</div></body></html>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: recipients, subject, html, text }),
    });
    if (!r.ok) {
      const errText = (await r.text()).slice(0, 500);
      console.error(`[cash-closing-reopen-request] Resend ${r.status}:`, errText);
      return jsonOk({ data: { ok: true, mail: "failed", error: `Resend ${r.status}`, recipients } });
    }
    console.log(`[cash-closing-reopen-request] closing=${closingId} outlet=${outletName} mail=sent to=${recipients.length}`);
    return jsonOk({ data: { ok: true, mail: "sent", recipients } });
  } catch (error) {
    console.error(`[cash-closing-reopen-request] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
