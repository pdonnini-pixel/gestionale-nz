// Edge Function: ticket-notify-resolved
//
// Manda all'autore la mail "la tua segnalazione è stata risolta".
// Invocata SOLO dal cron `ticket-notify-resolved-10min` (migrazione 157), che
// passa le notifiche di categoria 'ticket' non ancora spedite. Nessun accesso
// dal browser: l'unica autorizzazione valida è la service key o il segreto
// condiviso 'autofix_cron_secret' nell'header x-ticket-notify.
//
// Perché serve: col badge "Segnalazioni" che conta solo i ticket aperti, un
// ticket risolto spegne il badge. Senza questa mail nessuno avvisa l'autore
// che il problema è stato sistemato.
//
// Body POST: { "notification_id": "<uuid>" }
// Response : { ok: true, id: "<resend-id>" } | { ok: true, skipped: "..." }
//
// Secret richiesti (impostati a mano su TUTTI E 3 i tenant — vedi Regola #0):
//   RESEND_API_KEY      = "re_..."                 (già presente: send-distinta-email)
//   DISTINTA_EMAIL_FROM = "New Zago <amministrazione@miamor-shop.it>"  (già presente)
//   TICKET_EMAIL_FROM   = mittente dedicato, OPZIONALE (fallback: DISTINTA_EMAIL_FROM)
//   APP_BASE_URL        = "https://gestionale-nz.netlify.app" (per tenant)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ticket-notify",
};

function jsonError(status: number, message: string, code = "TICKET_NOTIFY_ERROR") {
  return new Response(
    JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ── Auth: service_role oppure segreto del cron. Mai il browser. ──
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const isServiceRole = token.length > 0 && token === supabaseServiceKey;
    let isCron = false;
    const cronHeader = req.headers.get("x-ticket-notify") ?? "";
    if (cronHeader) {
      const { data: cronSecret } = await supabase.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String(cronSecret[0]?.secret ?? "") : "";
      isCron = expected.length > 0 && cronHeader === expected;
      if (!isCron) return jsonError(403, "Segreto x-ticket-notify non valido");
    }
    if (!isServiceRole && !isCron) return jsonError(401, "Non autorizzato");

    const body = await req.json().catch(() => ({}));
    const notificationId: string = (body.notification_id ?? "").toString().trim();
    if (!notificationId) return jsonError(400, "notification_id mancante");

    // ── Notifica ──
    const { data: notif, error: notifErr } = await supabase
      .from("notifications")
      .select("id, user_id, category, reference_type, reference_id, message")
      .eq("id", notificationId)
      .maybeSingle();
    if (notifErr) return jsonError(500, notifErr.message);
    if (!notif) return jsonOk({ ok: true, skipped: "notification_not_found" });
    if (notif.category !== "ticket") return jsonOk({ ok: true, skipped: "not_a_ticket_notification" });
    if (!notif.reference_id) return jsonOk({ ok: true, skipped: "no_ticket_reference" });

    // ── Ticket ──
    const { data: ticket } = await supabase
      .from("tickets")
      .select("id, titolo, commenti")
      .eq("id", notif.reference_id)
      .maybeSingle();
    if (!ticket) return jsonOk({ ok: true, skipped: "ticket_not_found" });

    // ── Destinatario ──
    if (!notif.user_id) return jsonOk({ ok: true, skipped: "no_recipient" });
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("email, first_name")
      .eq("id", notif.user_id)
      .maybeSingle();
    const to = (profile?.email ?? "").toString().trim();
    // Nessuna email a profilo: non è un errore, semplicemente non si spedisce.
    if (!to) return jsonOk({ ok: true, skipped: "no_email" });

    // ── Cosa è stato fatto: ultimo commento AI sul ticket ──
    type Commento = { autore?: string; origine?: string; testo?: string; creato_il?: string };
    const commenti: Commento[] = Array.isArray(ticket.commenti) ? (ticket.commenti as unknown as Commento[]) : [];
    const spiegazione = commenti
      .filter((c) => c?.origine === "ai" && (c?.testo ?? "").trim().length > 0)
      .sort((a, b) => String(a.creato_il ?? "").localeCompare(String(b.creato_il ?? "")))
      .slice(-1)[0]?.testo?.trim();

    const titolo = (ticket.titolo ?? "").toString().trim() || "Segnalazione";
    const baseUrl = (Deno.env.get("APP_BASE_URL") ?? "").replace(/\/+$/, "");
    const link = baseUrl ? `${baseUrl}/ticket/${ticket.id}` : "";
    const nome = (profile?.first_name ?? "").toString().trim();

    // Testo semplice, per una persona che non è tecnica: niente nomi di file,
    // niente gergo, nessun dato sensibile oltre al titolo e alla spiegazione.
    const righe = [
      nome ? `Ciao ${nome},` : "Ciao,",
      "",
      `la segnalazione che avevi aperto è stata risolta: "${titolo}".`,
    ];
    if (spiegazione) {
      righe.push("", "Cosa è stato fatto:", spiegazione);
    }
    if (link) {
      righe.push("", `Puoi aprirla e verificare da qui: ${link}`);
    }
    righe.push(
      "",
      "Se il problema non è risolto, puoi riaprirla scrivendo un commento sulla segnalazione stessa.",
      "",
      "Gestionale",
    );

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("TICKET_EMAIL_FROM") ?? Deno.env.get("DISTINTA_EMAIL_FROM");
    if (!resendKey) return jsonError(503, "Invio email non configurato (RESEND_API_KEY assente)", "EMAIL_NOT_CONFIGURED");
    if (!from) return jsonError(503, "Mittente non configurato (TICKET_EMAIL_FROM / DISTINTA_EMAIL_FROM assenti)", "EMAIL_NOT_CONFIGURED");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `La tua segnalazione è stata risolta: ${titolo}`.slice(0, 200),
        text: righe.join("\n"),
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[ticket-notify-resolved] Resend ${r.status}:`, errText);
      return jsonError(502, "Invio email non riuscito", "RESEND_API_ERROR");
    }

    const data = await r.json().catch(() => ({}));
    const id: string = (data?.id ?? "").toString();
    console.log(`[ticket-notify-resolved] sent id=${id} ticket=${ticket.id}`);
    return jsonOk({ ok: true, id });
  } catch (error) {
    console.error("[ticket-notify-resolved] Error:", error);
    return jsonError(500, (error as Error).message);
  }
});
