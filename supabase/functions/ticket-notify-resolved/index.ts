// Edge Function: ticket-notify-resolved
//
// Manda a chi ha aperto una segnalazione la mail «la tua segnalazione è
// stata risolta». La chiama il trigger notify_ticket_resolved (migration 225)
// subito dopo aver creato la notifica in app, con net.http_post e il segreto
// condiviso x-autofix-cron (vault autofix_cron_secret), come il report serale
// delle chiusure. Dal browser non si può usare: le uniche autorizzazioni
// valide sono la service key o quel segreto.
//
// Body POST: { "notification_id": "<uuid>" }
// Response : { ok: true, id: "<resend-id>" } | { ok: true, skipped: "..." }
//
// Secret già presenti sui tre tenant (usati dal report serale):
//   RESEND_API_KEY, DISTINTA_EMAIL_FROM.
// Il link alla segnalazione usa daily_report_settings.app_url dell'azienda:
// nessun valore di tenant nel codice. Senza app_url la mail parte senza link.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

function jsonError(status: number, message: string, code = "TICKET_NOTIFY_ERROR") {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

type Commento = { autore?: string; origine?: string; testo?: string; creato_il?: string };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // ── Autorizzazione: service role oppure segreto condiviso del cron ──
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isServiceRole = token.length > 0 && token === supabaseServiceKey;
    let trusted = isServiceRole;
    if (!trusted) {
      const cronHeader = req.headers.get("x-autofix-cron") ?? "";
      if (!cronHeader) return jsonError(401, "Non autorizzato", "UNAUTHORIZED");
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String(cronSecret[0]?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
      if (!trusted) return jsonError(403, "Segreto x-autofix-cron non valido", "FORBIDDEN");
    }

    const body = await req.json().catch(() => ({}));
    const notificationId = String(body?.notification_id ?? "").trim();
    if (!notificationId) return jsonError(400, "notification_id mancante", "BAD_REQUEST");

    // ── Notifica, ticket, destinatario ──
    const { data: notif, error: notifErr } = await admin
      .from("notifications")
      .select("id, company_id, user_id, category, reference_id, emailed_at")
      .eq("id", notificationId)
      .maybeSingle();
    if (notifErr) return jsonError(500, notifErr.message);
    if (!notif) return jsonOk({ ok: true, skipped: "notification_not_found" });
    if (notif.category !== "ticket" || !notif.reference_id) return jsonOk({ ok: true, skipped: "not_a_ticket_notification" });
    if (notif.emailed_at) return jsonOk({ ok: true, skipped: "already_emailed" });
    if (!notif.user_id) return jsonOk({ ok: true, skipped: "no_recipient" });

    const [{ data: ticket }, { data: profile }, { data: settings }] = await Promise.all([
      admin.from("tickets").select("id, titolo, modulo, commenti, note_fix, risolto_il").eq("id", notif.reference_id).maybeSingle(),
      admin.from("user_profiles").select("email, first_name").eq("id", notif.user_id).maybeSingle(),
      admin.from("daily_report_settings").select("app_url").eq("company_id", notif.company_id).maybeSingle(),
    ]);
    if (!ticket) return jsonOk({ ok: true, skipped: "ticket_not_found" });
    const to = String(profile?.email ?? "").trim();
    if (!to) return jsonOk({ ok: true, skipped: "no_email" });

    // ── Cosa è stato fatto: ultimo commento AutoFix, altrimenti le note di risoluzione ──
    const commenti: Commento[] = Array.isArray(ticket.commenti) ? (ticket.commenti as unknown as Commento[]) : [];
    const ultimoAi = commenti
      .filter((c) => c?.origine === "ai" && String(c?.testo ?? "").trim().length > 0)
      .sort((a, b) => String(a.creato_il ?? "").localeCompare(String(b.creato_il ?? "")))
      .slice(-1)[0]?.testo?.trim();
    const spiegazione = ultimoAi || String(ticket.note_fix ?? "").trim();

    const titolo = String(ticket.titolo ?? "").trim() || "Segnalazione";
    const nome = String(profile?.first_name ?? "").trim();
    const baseUrl = String(settings?.app_url ?? "").trim().replace(/\/+$/, "");
    const link = baseUrl ? `${baseUrl}/ticket/${ticket.id}` : "";

    const testo = [
      nome ? `Ciao ${nome},` : "Ciao,",
      "",
      `la segnalazione che avevi aperto è stata risolta: «${titolo}».`,
      ...(spiegazione ? ["", "Cosa è stato fatto:", spiegazione] : []),
      ...(link ? ["", `Puoi aprirla e verificare da qui: ${link}`] : []),
      "",
      "Se il problema non è risolto, riaprila con un commento sulla segnalazione stessa.",
      "",
      "Gestionale",
    ].join("\n");
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#0f172a;line-height:1.5">
<p>${nome ? `Ciao ${esc(nome)},` : "Ciao,"}</p>
<p>la segnalazione che avevi aperto è stata risolta: <strong>«${esc(titolo)}»</strong>.</p>
${spiegazione ? `<p style="margin:0 0 4px"><strong>Cosa è stato fatto</strong></p><p style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px">${esc(spiegazione)}</p>` : ""}
${link ? `<p><a href="${esc(link)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px">Apri la segnalazione</a></p>` : ""}
<p style="color:#475569;font-size:13px">Se il problema non è risolto, riaprila con un commento sulla segnalazione stessa.</p>
</div>`;

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DISTINTA_EMAIL_FROM");
    if (!resendKey || !from) return jsonError(503, "Invio email non configurato (RESEND_API_KEY / DISTINTA_EMAIL_FROM)", "EMAIL_NOT_CONFIGURED");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: `Segnalazione risolta: ${titolo}`.slice(0, 200), text: testo, html }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error(`[ticket-notify-resolved] Resend ${r.status}:`, errText);
      return jsonError(502, "Invio email non riuscito", "RESEND_API_ERROR");
    }
    const data = await r.json().catch(() => ({}));
    const id = String(data?.id ?? "");
    await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).eq("id", notif.id);
    console.log(`[ticket-notify-resolved] sent id=${id} ticket=${ticket.id}`);
    return jsonOk({ ok: true, id });
  } catch (error) {
    console.error("[ticket-notify-resolved] Error:", error);
    return jsonError(500, (error as Error).message);
  }
});
