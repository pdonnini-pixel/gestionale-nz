// Edge Function: timbrature-avvisi
// Avviso WhatsApp «uscita non timbrata» (Patrizio, 05/11/2026): a fine turno
// + margine (30 minuti di default) la persona risulta ancora dentro → un
// messaggio, una volta sola per turno. Entro il margine niente avviso e niente
// straordinario.
//
// Chi la chiama: il cron timbrature-avvisi-tick (migration 348) con il segreto
// condiviso x-autofix-cron, solo se timbrature_da_avvisare() ha righe. Gli
// avvisi partono solo nei negozi con attendance_settings.avvisi_whatsapp acceso.
//
// WhatsApp via Twilio, come il report incassi (migration 201): fuori dalla
// finestra di 24 ore Meta accetta solo un modello approvato. Il modello delle
// timbrature sta nel Vault come twilio_whatsapp_timbrature_content_sid, con
// tre variabili: {{1}} nome, {{2}} negozio, {{3}} ora di fine turno.
// Ogni tentativo, riuscito o no, si registra in attendance_notifications: lo
// stesso turno non riceve mai un secondo messaggio (niente invii a raffica).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface DaAvvisare {
  company_id: string; outlet_id: string; employee_id: string; shift_id: string;
  data: string; fine: string; nome: string | null; telefono: string; negozio: string;
}

function numeroWhatsApp(n: string): string | null {
  let s = n.replace(/[\s.\-()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^3\d{8,9}$/.test(s)) s = "+39" + s; // cellulare italiano scritto senza prefisso
  return /^\+\d{8,15}$/.test(s) ? `whatsapp:${s}` : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let trusted = token.length > 0 && token === serviceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
    }
    if (!trusted) return json(403, { error: "Non autorizzato", code: "FORBIDDEN" });

    const { data: righe, error: rErr } = await admin.rpc("timbrature_da_avvisare");
    if (rErr) throw rErr;
    const lista = (righe ?? []) as DaAvvisare[];
    if (!lista.length) return json(200, { inviati: 0, falliti: 0 });

    const { data: cfgRows } = await admin.rpc("get_twilio_whatsapp_config");
    const cfg = (Array.isArray(cfgRows) ? cfgRows[0] : cfgRows) as { account_sid?: string; auth_token?: string; from_number?: string } | null;
    const { data: contentSid } = await admin.rpc("get_twilio_timbrature_template");

    let inviati = 0;
    let falliti = 0;
    for (const r of lista) {
      const ora = r.fine.slice(0, 5);
      const to = numeroWhatsApp(r.telefono);
      let esito: "sent" | "failed" = "failed";
      let errore: string | null = null;

      if (!cfg?.account_sid || !cfg.auth_token || !cfg.from_number) {
        errore = "Twilio non configurato nel Vault";
      } else if (!contentSid) {
        errore = "Modello WhatsApp delle timbrature non ancora nel Vault (twilio_whatsapp_timbrature_content_sid)";
      } else if (!to) {
        errore = "Numero WhatsApp non valido";
      } else {
        const from = cfg.from_number.startsWith("whatsapp:") ? cfg.from_number : `whatsapp:${cfg.from_number}`;
        const params = new URLSearchParams({
          From: from, To: to, ContentSid: String(contentSid),
          ContentVariables: JSON.stringify({ "1": (r.nome ?? "").trim() || "ciao", "2": r.negozio, "3": ora }),
        });
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.account_sid)}/Messages.json`, {
          method: "POST",
          headers: { "Authorization": "Basic " + btoa(`${cfg.account_sid}:${cfg.auth_token}`), "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        if (res.ok) esito = "sent";
        else {
          errore = `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}`;
          console.error(`[timbrature-avvisi] Twilio ${res.status} employee=${r.employee_id}`);
        }
      }

      const { error: insErr } = await admin.from("attendance_notifications").upsert({
        company_id: r.company_id, employee_id: r.employee_id, shift_id: r.shift_id,
        data: r.data, fine_turno: r.fine, tipo: "uscita_mancante", canale: "whatsapp",
        telefono: r.telefono, esito, errore,
      }, { onConflict: "shift_id,tipo", ignoreDuplicates: true });
      if (insErr) console.error("[timbrature-avvisi] registro avviso:", insErr.message);
      if (esito === "sent") inviati++; else falliti++;
    }
    return json(200, { inviati, falliti });
  } catch (error) {
    console.error("[timbrature-avvisi] Error:", error);
    return json(500, { error: (error as Error).message, code: "AVVISI_ERROR", timestamp: new Date().toISOString() });
  }
});
