// Edge Function: consuntivo-mese-avviso
//
// Dal primo del mese alle 9 il gestionale scrive da solo il consuntivo del mese
// appena chiuso dalle chiusure di cassa (migration 428, fn_consuntivo_mese_chiuso).
// Un negozio con chiusure ancora in BOZZA aspetta: questa funzione manda a chi è
// in elenco (daily_report_settings.consuntivo_avviso_recipients, oggi Lilian)
// l'elenco delle bozze da confermare. Il giro si ripete ogni giorno alle 9 finché
// le bozze restano.
//
// Chi la chiama: pg_cron → fn_consuntivo_mese_chiuso_tick() con il segreto
// condiviso x-autofix-cron, body { run_id, company_id, esito }. Accetta anche il
// service role (prove). Nessun utente loggato.
//
// Sicurezza: service role solo qui dentro, RESEND_API_KEY e DISTINTA_EMAIL_FROM nei
// secret delle function, nessun valore di tenant nel codice.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

type Attesa = { outlet: string; cost_center: string; bozze: string[] };
type Scritto = { outlet: string; netto: number; lordo: number };
type Esito = { anno: number; mese: number; in_attesa?: Attesa[]; scritti?: Scritto[] };

function jsonError(status: number, message: string, code = "CONSUNTIVO_AVVISO_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.round(Math.abs(n) * 100);
  const int = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${int},${String(abs % 100).padStart(2, "0")} €`;
}
function dataIt(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function componi(e: Esito, appUrl: string | null) {
  const meseNome = `${MESI[e.mese - 1]} ${e.anno}`;
  const attese = e.in_attesa ?? [];
  const scritti = e.scritti ?? [];
  const nBozze = attese.reduce((s, a) => s + a.bozze.length, 0);
  const subject = `Consuntivo di ${meseNome}: ${nBozze} ${nBozze === 1 ? "chiusura" : "chiusure"} in bozza da confermare`;
  const link = appUrl ? `${appUrl.replace(/\/$/, "")}/incassi-giornalieri` : null;

  const righeTxt = attese.map((a) => `- ${a.outlet}: ${a.bozze.map(dataIt).join(", ")}`).join("\n");
  const scrittiTxt = scritti.map((s) => `- ${s.outlet}: ${eur(s.netto)} netto IVA (${eur(s.lordo)} lordo)`).join("\n");
  const text = [
    `Il consuntivo di ${meseNome} non è ancora stato scritto per questi negozi, perché hanno chiusure di cassa in bozza:`,
    "",
    righeTxt,
    "",
    "Appena le chiusure sono confermate, il gestionale scrive il consuntivo da solo alle 9 del giorno dopo.",
    scritti.length ? `\nScritti oggi:\n${scrittiTxt}` : "",
    link ? `\nIncassi giornalieri: ${link}` : "",
  ].filter((x) => x !== "").join("\n");

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1e293b">
<p>Il consuntivo di <strong>${esc(meseNome)}</strong> non è ancora stato scritto per questi negozi, perché hanno chiusure di cassa in bozza:</p>
<ul>${attese.map((a) => `<li><strong>${esc(a.outlet)}</strong>: ${a.bozze.map(dataIt).join(", ")}</li>`).join("")}</ul>
<p>Appena le chiusure sono confermate, il gestionale scrive il consuntivo da solo alle 9 del giorno dopo.</p>
${scritti.length ? `<p>Scritti oggi:</p><ul>${scritti.map((s) => `<li>${esc(s.outlet)}: ${eur(s.netto)} netto IVA (${eur(s.lordo)} lordo)</li>`).join("")}</ul>` : ""}
${link ? `<p><a href="${esc(link)}">Apri Incassi giornalieri</a></p>` : ""}
</div>`;
  return { subject, text, html };
}

async function inviaMail(to: string[], subject: string, html: string, text: string): Promise<string | null> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("DISTINTA_EMAIL_FROM");
  if (!key || !from) return "RESEND_API_KEY o DISTINTA_EMAIL_FROM assenti";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!r.ok) {
    const err = (await r.text()).slice(0, 400);
    console.error(`[consuntivo-mese-avviso] Resend ${r.status}:`, err);
    return `Resend ${r.status}: ${err}`;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Metodo non consentito", "METHOD_NOT_ALLOWED");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return jsonError(500, "Ambiente incompleto", "ENV_MISSING");
  const admin = createClient(supabaseUrl, serviceKey);

  let runId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    let trusted = token === serviceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
    }
    if (!trusted) return jsonError(403, "Chiamata non autorizzata", "FORBIDDEN");

    const body = await req.json().catch(() => ({})) as { run_id?: string; company_id?: string; esito?: Esito };
    runId = body.run_id ? String(body.run_id) : null;
    const companyId = String(body.company_id ?? "");
    const esito = body.esito;
    if (!companyId || !esito || !Array.isArray(esito.in_attesa) || esito.in_attesa.length === 0) {
      return jsonError(400, "company_id o elenco delle bozze mancante", "BAD_REQUEST");
    }

    const { data: s } = await admin.from("daily_report_settings")
      .select("consuntivo_avviso_recipients, app_url").eq("company_id", companyId).maybeSingle();
    const to = ((s as { consuntivo_avviso_recipients?: string[] } | null)?.consuntivo_avviso_recipients ?? []).filter(Boolean);
    if (to.length === 0) {
      if (runId) await admin.from("budget_consuntivo_runs").update({ mail_status: "nessun_destinatario" }).eq("id", runId);
      return jsonOk({ inviata: false, motivo: "nessun destinatario" });
    }

    const { subject, text, html } = componi(esito, (s as { app_url?: string | null } | null)?.app_url ?? null);
    const err = await inviaMail(to, subject, html, text);
    if (runId) {
      await admin.from("budget_consuntivo_runs")
        .update({ mail_status: err ? "errore" : "inviata", mail_error: err }).eq("id", runId);
    }
    if (err) return jsonError(502, err, "MAIL_ERROR");
    return jsonOk({ inviata: true, destinatari: to.length, subject });
  } catch (error) {
    console.error("[consuntivo-mese-avviso] Error:", error);
    if (runId) {
      await admin.from("budget_consuntivo_runs")
        .update({ mail_status: "errore", mail_error: (error as Error).message?.slice(0, 400) ?? "errore" }).eq("id", runId);
    }
    return jsonError(500, (error as Error).message ?? "Errore", "CONSUNTIVO_AVVISO_ERROR");
  }
});
