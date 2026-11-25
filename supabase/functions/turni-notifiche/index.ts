// Edge Function: turni-notifiche (migration 466, Patrizio 25/11/2026)
// Avvisa sul telefono (app New Zago degli store) la persona i cui turni pubblicati sono
// arrivati, cambiati o tolti. Tutto quello che e' cambiato per una persona parte in un
// messaggio solo; toccando la notifica l'app apre la scheda Turni.
// Gli stessi avvisi si leggono nell'app, anche dal computer (app_dipendente_avvisi_turni).
//
// Chi la chiama: il cron turni-avvisi-tick ogni 2 minuti, con il segreto condiviso
// x-autofix-cron, solo se c'e' una persona con avvisi fermi da almeno 2 minuti.
// Firebase come timbrature-notifiche: account di servizio nel Vault (fcm_service_account).
// Ogni avviso si segna come inviato, riuscito o no: non riparte mai due volte.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { riassuntoAvvisi, type AvvisoTurno } from "./riassunto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface Riga extends AvvisoTurno { company_id: string; employee_id: string }
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

function b64url(dati: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof dati === "string" ? new TextEncoder().encode(dati) : new Uint8Array(dati);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function tokenFirebase(sa: ServiceAccount): Promise<string> {
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const chiave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const ora = Math.floor(Date.now() / 1000);
  const testa = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: ora, exp: ora + 3600,
  }));
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chiave, new TextEncoder().encode(`${testa}.${corpo}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${testa}.${corpo}.${b64url(firma)}` }),
  });
  if (!res.ok) throw new Error(`Firebase OAuth ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function mandaATelefoni(
  admin: SupabaseClient, sa: ServiceAccount | null, accessToken: () => Promise<string>,
  employeeId: string, msg: { titolo: string; corpo: string },
): Promise<{ esito: "mandato" | "nessun_telefono" | "non_riuscito"; telefoni: number; errore: string | null }> {
  const { data: tokens } = await admin.from("employee_push_tokens").select("id, token").eq("employee_id", employeeId).eq("attivo", true);
  const lista = (tokens ?? []) as { id: string; token: string }[];
  if (!lista.length) return { esito: "nessun_telefono", telefoni: 0, errore: null };
  if (!sa) return { esito: "non_riuscito", telefoni: lista.length, errore: "Notifiche non configurate: manca fcm_service_account nel Vault" };
  const at = await accessToken();
  let ok = 0;
  let errore: string | null = null;
  for (const t of lista) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${at}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          token: t.token,
          notification: { title: msg.titolo, body: msg.corpo },
          data: { tipo: "turni", scheda: "turni" },
          android: { priority: "high", notification: { channel_id: "presenze" } },
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    });
    if (res.ok) { ok++; continue; }
    const txt = await res.text();
    errore = `FCM ${res.status}: ${txt.slice(0, 200)}`;
    if (res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt)) {
      await admin.from("employee_push_tokens").update({ attivo: false, aggiornato_il: new Date().toISOString() }).eq("id", t.id);
    }
  }
  return { esito: ok > 0 ? "mandato" : "non_riuscito", telefoni: lista.length, errore: ok > 0 ? null : errore };
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

    const { data: righe, error: rErr } = await admin.rpc("turni_avvisi_da_mandare");
    if (rErr) throw rErr;
    const lista = (righe ?? []) as Riga[];
    if (!lista.length) return json(200, { persone: 0 });

    let sa: ServiceAccount | null = null;
    const { data: saTxt } = await admin.rpc("get_fcm_service_account");
    if (saTxt) {
      try { sa = JSON.parse(String(saTxt)) as ServiceAccount; } catch { sa = null; }
    }
    let cache: string | null = null;
    const accessToken = async () => (cache ??= await tokenFirebase(sa!));

    const perPersona = new Map<string, Riga[]>();
    for (const r of lista) perPersona.set(r.employee_id, [...(perPersona.get(r.employee_id) ?? []), r]);

    let persone = 0;
    for (const [employeeId, suoi] of perPersona) {
      const msg = riassuntoAvvisi(suoi);
      let e: { esito: string; telefoni: number; errore: string | null } = { esito: "niente_da_dire", telefoni: 0, errore: null };
      if (msg) {
        try { e = await mandaATelefoni(admin, sa, accessToken, employeeId, msg); }
        catch (err) { e = { esito: "non_riuscito", telefoni: 0, errore: err instanceof Error ? err.message : String(err) }; }
      }
      const { error } = await admin.from("turni_avvisi")
        .update({ inviato_il: new Date().toISOString(), esito: e.esito, telefoni: e.telefoni, errore: e.errore })
        .in("id", suoi.map((x) => x.id));
      if (error) console.error("[turni-notifiche] registro:", error.message);
      persone++;
    }
    return json(200, { persone });
  } catch (error) {
    console.error("[turni-notifiche] Error:", error);
    return json(500, { error: "Errore negli avvisi dei turni", code: "TURNI_NOTIFICHE_ERROR", timestamp: new Date().toISOString() });
  }
});
