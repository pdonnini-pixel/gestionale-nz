// Edge Function: app-dipendente-attiva
// Attiva l'app del dipendente (pagina /app) con il codice di 8 caratteri che
// l'HR vede in Dipendenti → Presenze → Accessi (migration 348).
//
// Cosa fa, in ordine:
//   1. trova il dipendente dal codice (valido 30 giorni);
//   2. se non ha ancora un utente lo crea (ruolo dipendente, nessuna mail:
//      l'indirizzo e' interno e non riceve posta) e lo lega a employees.user_id;
//   3. consuma il codice: il segreto del QR cambia, il telefono di prima smette
//      di funzionare;
//   4. genera un link di accesso (generateLink, nessuna mail) e ne restituisce
//      il token_hash: il telefono lo scambia con una sessione (verifyOtp).
//
// Sicurezza: chiamata pubblica (chiave anon), protetta dal codice monouso e
// dal limite ai tentativi (app_attivazione_bloccata, migration 349).
// Body: { codice } → { token_hash, segreto, employee_id, nome }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonError(status: number, error: string, code: string): Response {
  return json(status, { error, code, timestamp: new Date().toISOString() });
}

function passwordCasuale(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed", "METHOD");

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const codice = String(body.codice ?? "").trim().toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z2-9]{8}$/.test(codice)) return jsonError(400, "Il codice è di 8 caratteri, lettere e numeri.", "BAD_CODE");

    // Limite ai tentativi (migration 349): oltre 20 errori in 10 minuti si
    // ferma tutto per 10 minuti, cosi' il codice non si indovina a forza.
    const { data: bloccata } = await admin.rpc("app_attivazione_bloccata");
    if (bloccata === true) return jsonError(429, "Troppi tentativi sbagliati. Riprova fra 10 minuti.", "TOO_MANY");
    const segnaErrore = () => admin.from("employee_app_activation_attempts").insert({ esito: "errato" });

    // 1. Il codice esiste ed e' valido?
    const { data: acc, error: accErr } = await admin.from("employee_app_access")
      .select("employee_id, company_id, codice_scade").eq("codice", codice).maybeSingle();
    if (accErr) throw accErr;
    if (!acc || !acc.codice_scade || new Date(acc.codice_scade) <= new Date()) {
      await segnaErrore();
      return jsonError(400, "Codice non valido o scaduto. Chiedi un codice nuovo a chi segue il personale.", "CODE_NOT_FOUND");
    }

    const { data: emp, error: empErr } = await admin.from("employees")
      .select("id, company_id, user_id, nome, cognome, first_name, last_name, is_active").eq("id", acc.employee_id).maybeSingle();
    if (empErr) throw empErr;
    if (!emp || emp.is_active === false) {
      await segnaErrore();
      return jsonError(400, "Codice non valido o scaduto. Chiedi un codice nuovo a chi segue il personale.", "CODE_NOT_FOUND");
    }

    const nome = String(emp.nome ?? emp.first_name ?? "").trim();
    const cognome = String(emp.cognome ?? emp.last_name ?? "").trim();
    // Indirizzo interno, non riceve posta: serve solo a Supabase Auth.
    const email = `${emp.id}@dipendenti.local`;

    // 2. Utente del dipendente
    let userId: string | null = emp.user_id ?? null;
    if (!userId) {
      const { data: cr, error: crErr } = await admin.auth.admin.createUser({
        email, password: passwordCasuale(), email_confirm: true,
        app_metadata: { role: "dipendente" },
        user_metadata: { first_name: nome, last_name: cognome, employee_id: emp.id },
      });
      if (crErr || !cr?.user) {
        // Utente gia' creato in un tentativo precedente non andato a buon fine
        const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        const esistente = lista?.users?.find((u) => u.email === email);
        if (!esistente) throw new Error(`Creazione utente non riuscita: ${crErr?.message ?? "sconosciuto"}`);
        userId = esistente.id;
      } else {
        userId = cr.user.id;
      }
      const { error: profErr } = await admin.from("user_profiles").upsert({
        id: userId, company_id: emp.company_id, first_name: nome || null, last_name: cognome || null,
        email, role: "dipendente", is_active: true,
      }, { onConflict: "id" });
      if (profErr) throw profErr;
      const { error: linkErr } = await admin.from("employees").update({ user_id: userId }).eq("id", emp.id);
      if (linkErr) throw linkErr;
    }

    // 3. Consuma il codice e prende il segreto nuovo
    const { data: righe, error: consErr } = await admin.rpc("app_dipendente_consuma_codice", { p_codice: codice });
    if (consErr) throw consErr;
    const riga = Array.isArray(righe) ? righe[0] as { segreto?: string } | undefined : undefined;
    if (!riga?.segreto) return jsonError(400, "Codice già usato. Chiedi un codice nuovo.", "CODE_USED");

    // 4. Sessione per il telefono
    const { data: gl, error: glErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = gl?.properties?.hashed_token;
    if (glErr || !tokenHash) throw new Error(`Accesso non generato: ${glErr?.message ?? "sconosciuto"}`);

    await admin.from("employee_app_activation_attempts").insert({ esito: "ok" });
    return json(200, {
      token_hash: tokenHash,
      segreto: riga.segreto,
      employee_id: emp.id,
      nome: [nome, cognome].filter(Boolean).join(" "),
    });
  } catch (error) {
    console.error("[app-dipendente-attiva] Error:", error);
    return jsonError(500, "Attivazione non riuscita. Riprova fra poco; se il problema resta chiedi un codice nuovo.", "ACTIVATION_ERROR");
  }
});
