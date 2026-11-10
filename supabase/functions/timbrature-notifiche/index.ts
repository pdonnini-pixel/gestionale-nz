// Edge Function: timbrature-notifiche
// Avvisi sul telefono dell'app New Zago (migration 367), al posto di WhatsApp.
//   - RITARDO: il turno e' cominciato da N minuti (15 di partenza) e l'entrata
//     non c'e'.
//   - USCITA NON TIMBRATA: fine turno + margine (30 di partenza) e risulta
//     ancora dentro.
// Destinatari, configurabili per negozio in Dipendenti → Presenze: il
// dipendente, il responsabile del negozio (outlets.referente_employee_id),
// chi conferma il negozio (attendance_confermatori, notifica nel gestionale,
// migration 382), l'ufficio (notifica nel gestionale).
//
// Chi la chiama: il cron timbrature-avvisi-tick ogni 5 minuti, con il segreto
// condiviso x-autofix-cron, solo se c'e' qualcuno da avvisare.
//
// Le notifiche passano da Firebase Cloud Messaging (API HTTP v1), che
// recapita su Android e su iPhone. L'account di servizio Firebase (JSON) sta
// nel Vault come fcm_service_account e lo legge solo questa funzione.
// Ogni avviso si registra in attendance_alerts, riuscito o no: lo stesso
// turno non riceve mai un secondo avviso dello stesso tipo.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface Riga {
  company_id: string; outlet_id: string; employee_id: string; shift_id: string | null;
  data: string; ora_turno: string; tipo: "ritardo" | "uscita_mancante";
  nome: string; negozio: string; responsabile_id: string | null;
  avvisa_dipendente: boolean; avvisa_responsabile: boolean; avvisa_ufficio: boolean;
  /** Dalla migration 382: assente prima. */
  avvisa_confermatori?: boolean;
}

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

// ─── Firebase: token d'accesso OAuth dal service account (JWT RS256) ──────
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

// ─── Testi (quello che legge chi riceve) ──────────────────────────────────
function testo(r: Riga, per: "dipendente" | "responsabile"): { titolo: string; corpo: string } {
  const ora = r.ora_turno.slice(0, 5);
  const nome = r.nome.split(" ")[0] || r.nome;
  if (r.tipo === "ritardo") {
    return per === "dipendente"
      ? { titolo: "Non risulta la tua entrata", corpo: `Il tuo turno a ${r.negozio} è cominciato alle ${ora}. Se sei già in negozio, timbra con il QR o segna l'ora dall'app.` }
      : { titolo: `${nome}: entrata non timbrata`, corpo: `${r.nome} doveva entrare alle ${ora} a ${r.negozio} e non ha ancora timbrato.` };
  }
  return per === "dipendente"
    ? { titolo: "Non risulta la tua uscita", corpo: `Il turno a ${r.negozio} è finito alle ${ora}. Se hai già finito, apri l'app e segna l'ora d'uscita.` }
    : { titolo: `${nome}: uscita non timbrata`, corpo: `Il turno di ${r.nome} a ${r.negozio} è finito alle ${ora} e l'uscita non c'è.` };
}

async function mandaATelefoni(
  admin: SupabaseClient, sa: ServiceAccount | null, accessToken: () => Promise<string>,
  employeeId: string, msg: { titolo: string; corpo: string }, tipo: string,
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
          data: { tipo, scheda: "oggi" },
          android: { priority: "high", notification: { channel_id: "presenze" } },
          apns: { payload: { aps: { sound: "default" } } },
        },
      }),
    });
    if (res.ok) { ok++; continue; }
    const txt = await res.text();
    errore = `FCM ${res.status}: ${txt.slice(0, 200)}`;
    // Telefono disinstallato o token scaduto: non si riprova piu'
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

    const { data: righe, error: rErr } = await admin.rpc("timbrature_avvisi_da_mandare");
    if (rErr) throw rErr;
    const lista = (righe ?? []) as Riga[];
    if (!lista.length) return json(200, { avvisi: 0 });

    let sa: ServiceAccount | null = null;
    const { data: saTxt } = await admin.rpc("get_fcm_service_account");
    if (saTxt) {
      try { sa = JSON.parse(String(saTxt)) as ServiceAccount; } catch { sa = null; }
    }
    let cache: string | null = null;
    const accessToken = async () => (cache ??= await tokenFirebase(sa!));

    let fatti = 0;
    for (const r of lista) {
      const registra = async (destinatario: string, destId: string | null, e: { esito: string; telefoni: number; errore: string | null }) => {
        const { error } = await admin.from("attendance_alerts").upsert({
          company_id: r.company_id, outlet_id: r.outlet_id, employee_id: r.employee_id, shift_id: r.shift_id,
          data: r.data, ora_turno: r.ora_turno, tipo: r.tipo, destinatario, destinatario_employee_id: destId,
          telefoni: e.telefoni, esito: e.esito, errore: e.errore,
        }, { onConflict: "employee_id,data,ora_turno,tipo,destinatario", ignoreDuplicates: true });
        if (error) console.error("[timbrature-notifiche] registro:", error.message);
        fatti++;
      };

      if (r.avvisa_dipendente) {
        await registra("dipendente", r.employee_id, await mandaATelefoni(admin, sa, accessToken, r.employee_id, testo(r, "dipendente"), r.tipo));
      }
      // Il responsabile non riceve l'avviso su se stesso: gli arriva gia' come dipendente
      if (r.avvisa_responsabile && r.responsabile_id && r.responsabile_id !== r.employee_id) {
        await registra("responsabile", r.responsabile_id, await mandaATelefoni(admin, sa, accessToken, r.responsabile_id, testo(r, "responsabile"), r.tipo));
      }
      if (r.avvisa_ufficio) {
        const m = testo(r, "responsabile");
        const { error } = await admin.from("notifications").insert({
          company_id: r.company_id, user_id: null, title: m.titolo, message: m.corpo, category: "info", severity: "warning",
          action_url: "/dipendenti?view=presenze", action_label: "Apri le presenze", reference_type: "attendance_alert",
        });
        await registra("ufficio", null, { esito: error ? "non_riuscito" : "nel_gestionale", telefoni: 0, errore: error?.message ?? null });
      }
      // Chi conferma il negozio (382): notifica nel gestionale a ognuno, tranne
      // a chi e' la persona stessa (collegata come dipendente)
      let confermatori = 0;
      if (r.avvisa_confermatori) {
        const [{ data: conf }, { data: io }] = await Promise.all([
          admin.from("attendance_confermatori").select("user_id").eq("outlet_id", r.outlet_id),
          admin.from("responsabile_dipendente").select("user_id").eq("employee_id", r.employee_id),
        ]);
        const { data: emp } = await admin.from("employees").select("user_id").eq("id", r.employee_id).maybeSingle();
        const esclusi = new Set<string>([...((io ?? []) as { user_id: string }[]).map((x) => x.user_id), ...(emp?.user_id ? [emp.user_id as string] : [])]);
        const utenti = [...new Set(((conf ?? []) as { user_id: string }[]).map((x) => x.user_id))].filter((u) => !esclusi.has(u));
        if (utenti.length) {
          const m = testo(r, "responsabile");
          const { error } = await admin.from("notifications").insert(utenti.map((u) => ({
            company_id: r.company_id, user_id: u, title: m.titolo, message: m.corpo, category: "info", severity: "warning",
            action_url: "/dipendenti?view=presenze", action_label: "Apri le presenze", reference_type: "attendance_alert",
          })));
          await registra("confermatori", null, { esito: error ? "non_riuscito" : "nel_gestionale", telefoni: 0, errore: error?.message ?? null });
          confermatori = utenti.length;
        }
      }
      // Nessun destinatario acceso: si registra lo stesso, cosi' non si ricalcola ogni 5 minuti
      if (!r.avvisa_dipendente && !(r.avvisa_responsabile && r.responsabile_id && r.responsabile_id !== r.employee_id) && !r.avvisa_ufficio && !confermatori) {
        await registra("dipendente", r.employee_id, { esito: "nessun_telefono", telefoni: 0, errore: "Nessun destinatario acceso" });
      }
    }
    return json(200, { avvisi: fatti });
  } catch (error) {
    console.error("[timbrature-notifiche] Error:", error);
    return json(500, { error: "Errore negli avvisi", code: "NOTIFICHE_ERROR", timestamp: new Date().toISOString() });
  }
});
