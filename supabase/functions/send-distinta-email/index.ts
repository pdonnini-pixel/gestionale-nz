// Edge Function: send-distinta-email
//
// Invia la mail della distinta pagamenti ai destinatari dell'amministrazione,
// LATO SERVER, così l'invio non dipende più dal fatto che l'operatrice abbia
// Gmail loggato nel browser (prima l'unica via era "Apri in Gmail").
// Invocata dallo Scadenzario (anteprima distinta → "Invia email ai destinatari").
//
// Sicurezza (vedi CLAUDE.md):
// - La API key Resend sta nei secret della function (Deno.env RESEND_API_KEY),
//   MAI nel frontend. Questa function fa da proxy verso Resend.
// - Auth: profilo attivo in user_profiles con ruolo amministrativo
//   (_shared/verificaProfilo.ts). Un JWT valido senza profilo riceve 403.
// - Destinatari: solo quelli salvati nello Scadenzario
//   (companies.settings.email_scadenzario dell'azienda del chiamante) o nel
//   secret DISTINTA_EMAIL_TO. Un indirizzo diverso viene rifiutato: il mittente
//   aziendale non si presta a spedire a chi vuole il chiamante.
// - Il mittente è fisso e verificato lato dominio (DISTINTA_EMAIL_FROM), così
//   l'operatrice non può spedire da un mittente arbitrario.
// - Nessuna scrittura sul DB: solo lettura del profilo per validare il chiamante.
//
// Body POST:
//   {
//     "subject": "Disposizione pagamenti fornitori - 20/07/2026",
//     "body":    "…testo distinta già composto dal frontend…",
//     "to":      "amministrazione@miamor-shop.it, newzago@vicolo.it"  // opzionale
//   }
// Response: { ok: true, id: "<resend-id>" }
//
// Secret richiesti (impostati a mano su TUTTI E 3 i tenant — vedi Regola #0):
//   RESEND_API_KEY        = "re_..."                     (API key Resend)
//   DISTINTA_EMAIL_FROM   = "New Zago <amministrazione@miamor-shop.it>"  (mittente verificato)
//   DISTINTA_EMAIL_TO     = "amministrazione@miamor-shop.it, newzago@vicolo.it"  (fallback destinatari, opzionale)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { RUOLI_AMMINISTRATIVI, tokenDaRichiesta, verificaProfilo } from "../_shared/verificaProfilo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonError(status: number, message: string, code = "SEND_DISTINTA_EMAIL_ERROR") {
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

// Estrae ed valida una lista di indirizzi email da una stringa "a@b.it, c@d.it".
function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: profilo attivo con ruolo amministrativo (vedi _shared/verificaProfilo.ts).
    const chiamante = await verificaProfilo(supabase, tokenDaRichiesta(req), supabaseServiceKey, {
      ruoli: RUOLI_AMMINISTRATIVI,
    });
    if (!chiamante.ok) return jsonError(chiamante.status, chiamante.message, chiamante.code);

    const body = await req.json().catch(() => ({}));
    const subject: string = (body.subject ?? "").toString().slice(0, 300).trim();
    const text: string = (body.body ?? "").toString().slice(0, 100000);
    const toRaw: string = (body.to ?? "").toString();

    if (!subject) return jsonError(400, "Oggetto mancante");
    if (!text.trim()) return jsonError(400, "Corpo della mail mancante");

    // Destinatari: dal frontend se validi, altrimenti dal secret di fallback.
    const fallback = parseRecipients(Deno.env.get("DISTINTA_EMAIL_TO") ?? "");
    let recipients = parseRecipients(toRaw);
    if (recipients.length === 0) recipients = fallback;
    if (recipients.length === 0) {
      return jsonError(400, "Nessun destinatario valido: imposta l'email dei destinatari nello Scadenzario.", "NO_RECIPIENTS");
    }

    // Solo destinatari salvati: quelli dello Scadenzario dell'azienda del
    // chiamante più il fallback del secret. La service role (chiamate interne)
    // resta libera come prima.
    if (!chiamante.serviceRole) {
      const { data: company, error: compErr } = await supabase
        .from("companies")
        .select("settings")
        .eq("id", chiamante.companyId)
        .maybeSingle();
      if (compErr) {
        console.error("[send-distinta-email] lettura destinatari salvati fallita:", compErr.message);
        return jsonError(500, "Non riesco a leggere i destinatari salvati. Riprova.");
      }
      const salvati = parseRecipients(
        ((company?.settings as { email_scadenzario?: string } | null)?.email_scadenzario ?? "").toString(),
      );
      const ammessi = new Set([...salvati, ...fallback].map((e) => e.toLowerCase()));
      const nonAmmessi = recipients.filter((e) => !ammessi.has(e.toLowerCase()));
      if (nonAmmessi.length > 0) {
        return jsonError(
          403,
          "Alcuni destinatari non sono fra quelli salvati: salva prima i destinatari nello Scadenzario («Destinatari Email» → Salva).",
          "RECIPIENT_NOT_SAVED",
        );
      }
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DISTINTA_EMAIL_FROM");
    if (!resendKey) {
      return jsonError(503, "Invio email non ancora configurato (RESEND_API_KEY assente). Usa 'Apri in Gmail' o 'Copia testo' come alternativa.", "EMAIL_NOT_CONFIGURED");
    }
    if (!from) {
      return jsonError(503, "Mittente non configurato (DISTINTA_EMAIL_FROM assente).", "EMAIL_NOT_CONFIGURED");
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text,
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[send-distinta-email] Resend ${r.status}:`, errText);
      return jsonError(502, "Invio email non riuscito. Riprova o usa 'Copia testo'.", "RESEND_API_ERROR");
    }

    const data = await r.json().catch(() => ({}));
    const id: string = (data?.id ?? "").toString();
    console.log(`[send-distinta-email] sent id=${id} to=${recipients.length} recipient(s)`);
    return jsonOk({ ok: true, id, recipients });
  } catch (error) {
    console.error(`[send-distinta-email] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
