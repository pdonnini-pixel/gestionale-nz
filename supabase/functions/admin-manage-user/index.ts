// Edge Function: admin-manage-user
// Gestione REALE degli utenti/accessi (login) per la sezione Impostazioni → Utenti.
// Unico punto che tocca l'autenticazione: usa l'Admin API con service role.
//
// Sicurezza:
//   - Chiamante autenticato con ruolo super_advisor (app_metadata.role), oppure
//     segreto condiviso x-autofix-cron + body.company_id (provisioning amministrativo).
//   - Isolamento tenant: si possono gestire SOLO utenti della PROPRIA azienda
//     (user_profiles.company_id == azienda del chiamante).
//
// Azioni (body.action):
//   - "list"       → elenco utenti dell'azienda (profilo + email + stato accesso)
//   - "invite"     → crea un login e invia l'email di invito (l'utente imposta la
//                    password su /reset-password). Crea/aggiorna user_profiles.
//   - "set_role"   → cambia ruolo (app_metadata.role + user_profiles.role)
//   - "set_active" → blocca/sblocca l'accesso (ban dell'utente auth)
//   - "delete"     → revoca il login (elimina l'utente auth + user_profiles)
//   - "set_password" → genera una nuova password (12 caratteri, senza simboli
//                    ambigui) e la imposta sul login. La password viene
//                    restituita UNA sola volta al chiamante, che la comunica
//                    all'utente (es. account di negozio senza email attiva):
//                    nessuna email automatica.
//
// Body: { action, email?, first_name?, last_name?, phone?, role?, user_id?, active?, redirectTo?, outlet_id?, company_id? }
//
// outlet_id (solo per il ruolo operatore_cassa = account di negozio): l'outlet
// su cui l'account compila la chiusura di cassa. Viene scritto in
// user_outlet_access con can_write=true; e' da li' che la RLS delle chiusure
// (migrazione 173) e la visibilita' degli outlet ricavano il perimetro.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

const BAN_FOREVER = "876000h"; // ~100 anni = accesso bloccato
// Solo valori dell'enum public.user_role: "store_manager"/"operatrice" non
// esistevano nel DB e l'invito falliva a meta' (login creato, profilo no).
const ASSIGNABLE_ROLES = ["super_advisor", "ceo", "cfo", "coo", "contabile", "budget_approver", "viewer", "operatore_cassa"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "";

    // 1. Autenticazione chiamante: JWT di un super_advisor, oppure il segreto
    //    condiviso x-autofix-cron (stesso meccanismo di closing-photo-extract e
    //    cash-closing-photo-import) per i provisioning amministrativi lanciati
    //    fuori dall'app; in quel caso l'azienda arriva da body.company_id e deve
    //    esistere. Un chiamante con segreto non ha un user id, quindi il
    //    controllo "non cancellare se stesso" non si applica.
    let myCompany: string | null = null;
    let callerId: string | null = null;
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    let trustedBySecret = false;
    if (cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trustedBySecret = expected.length > 0 && cronHeader === expected;
      if (!trustedBySecret) return jsonError(403, "Segreto x-autofix-cron non valido");
    }
    if (trustedBySecret) {
      const cid = String(body.company_id ?? "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(cid)) return jsonError(400, "company_id obbligatorio con il segreto condiviso");
      const { data: co } = await admin.from("companies").select("id").eq("id", cid).maybeSingle();
      if (!co) return jsonError(404, "Azienda non trovata");
      myCompany = cid;
    } else {
      if (!token) return jsonError(401, "Missing authorization");
      const { data: userData, error: userErr } = await admin.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");

      // 2. Ruolo SOLO da app_metadata (mai user_metadata). Solo super_advisor.
      const roleData = userData.user.app_metadata?.role;
      const roles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      if (!roles.includes("super_advisor")) {
        return jsonError(403, "Solo un super_advisor può gestire gli utenti.");
      }
      callerId = userData.user.id;

      // 3. Azienda del chiamante (dal profilo)
      const { data: myProf } = await admin.from("user_profiles").select("company_id").eq("id", userData.user.id).maybeSingle();
      myCompany = (myProf as { company_id?: string } | null)?.company_id ?? null;
      if (!myCompany) return jsonError(403, "Utente senza azienda associata.");
    }

    // Helper: verifica che l'utente target appartenga alla MIA azienda
    const assertSameCompany = async (targetId: string): Promise<boolean> => {
      const { data } = await admin.from("user_profiles").select("company_id").eq("id", targetId).maybeSingle();
      return (data as { company_id?: string } | null)?.company_id === myCompany;
    };

    // Helper: assegna l'outlet all'account di negozio (operatore_cassa).
    // Un account = un outlet: le righe precedenti dell'utente vengono sostituite.
    // Per gli altri ruoli l'outlet_id viene ignorato.
    const assignOutlet = async (targetId: string, role: string, outletId: unknown): Promise<string | null> => {
      if (role !== "operatore_cassa") return null;
      const oid = String(outletId ?? "").trim();
      if (!oid) return "Per l'operatore di cassa serve il punto vendita (outlet_id).";
      const { data: outlet } = await admin.from("outlets").select("id, company_id").eq("id", oid).maybeSingle();
      if (!outlet || (outlet as { company_id?: string }).company_id !== myCompany) return "Punto vendita non valido per la tua azienda.";
      await admin.from("user_outlet_access").delete().eq("user_id", targetId);
      const { error } = await admin.from("user_outlet_access").insert({ user_id: targetId, outlet_id: oid, can_write: true, company_id: myCompany });
      return error ? `Assegnazione outlet non riuscita: ${error.message}` : null;
    };

    // ───────── LIST ─────────
    if (action === "list") {
      const { data: profs } = await admin
        .from("user_profiles")
        .select("id, first_name, last_name, role, email")
        .eq("company_id", myCompany);
      const list = [];
      for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
        const { data: au } = await admin.auth.admin.getUserById(p.id as string);
        const bannedUntil = (au?.user as { banned_until?: string } | null)?.banned_until ?? null;
        const active = !bannedUntil || new Date(bannedUntil).getTime() <= Date.now();
        list.push({
          id: p.id, first_name: p.first_name, last_name: p.last_name, role: p.role,
          email: p.email ?? au?.user?.email ?? null,
          active,
          last_sign_in_at: au?.user?.last_sign_in_at ?? null,
        });
      }
      return jsonOk({ users: list });
    }

    // ───────── INVITE (crea login + email di invito) ─────────
    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "operatore_cassa");
      if (!email) return jsonError(400, "Email obbligatoria");
      if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(400, `Ruolo non valido: ${role}`);
      if (role === "operatore_cassa" && !String(body.outlet_id ?? "").trim()) {
        return jsonError(400, "Per l'operatore di cassa serve il punto vendita (outlet_id).");
      }
      const redirectTo = String(body.redirectTo ?? "");

      const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { first_name: body.first_name ?? "", last_name: body.last_name ?? "" },
        ...(redirectTo ? { redirectTo } : {}),
      });
      if (invErr || !inv?.user) return jsonError(400, `Invito non riuscito: ${invErr?.message ?? "sconosciuto"}`);

      // Ruolo nel JWT (app_metadata) + profilo aziendale
      await admin.auth.admin.updateUserById(inv.user.id, { app_metadata: { role } });
      await admin.from("user_profiles").upsert({
        id: inv.user.id,
        company_id: myCompany,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        email,
        phone: body.phone ?? null,
        role,
      }, { onConflict: "id" });

      const outletErr = await assignOutlet(inv.user.id, role, body.outlet_id);
      if (outletErr) return jsonError(400, outletErr);

      return jsonOk({ ok: true, user_id: inv.user.id, invited: email });
    }

    // Da qui in poi serve un user_id target della propria azienda
    const targetId = String(body.user_id ?? "");
    if (!targetId) return jsonError(400, "user_id obbligatorio");
    if (callerId && targetId === callerId && (action === "delete" || (action === "set_active" && body.active === false))) {
      return jsonError(400, "Non puoi bloccare o eliminare te stesso.");
    }
    if (!(await assertSameCompany(targetId))) return jsonError(403, "Utente non appartiene alla tua azienda.");

    // ───────── SET_ROLE ─────────
    if (action === "set_role") {
      const role = String(body.role ?? "");
      if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(400, `Ruolo non valido: ${role}`);
      await admin.auth.admin.updateUserById(targetId, { app_metadata: { role } });
      await admin.from("user_profiles").update({ role }).eq("id", targetId);
      const outletErr = await assignOutlet(targetId, role, body.outlet_id);
      if (outletErr) return jsonError(400, outletErr);
      return jsonOk({ ok: true });
    }

    // ───────── SET_ACTIVE (blocca/sblocca accesso) ─────────
    if (action === "set_active") {
      const active = body.active !== false;
      await admin.auth.admin.updateUserById(targetId, { ban_duration: active ? "none" : BAN_FOREVER });
      return jsonOk({ ok: true, active });
    }

    // ───────── SET_PASSWORD (nuova password comunicata a voce/mail dall'amministrazione) ─────────
    if (action === "set_password") {
      const password = generatePassword();
      const { error: pwErr } = await admin.auth.admin.updateUserById(targetId, { password });
      if (pwErr) return jsonError(400, `Impostazione password non riuscita: ${pwErr.message}`);
      return jsonOk({ ok: true, password });
    }

    // ───────── DELETE (revoca login) ─────────
    if (action === "delete") {
      await admin.from("user_profiles").delete().eq("id", targetId);
      const { error: delErr } = await admin.auth.admin.deleteUser(targetId);
      if (delErr) return jsonError(400, `Eliminazione non riuscita: ${delErr.message}`);
      return jsonOk({ ok: true });
    }

    return jsonError(400, `Azione non riconosciuta: ${action}`);
  } catch (e) {
    return jsonError(500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// Password leggibile da dettare al telefono: 12 caratteri tra lettere e cifre,
// senza 0/O, 1/l/I che si confondono. Generata con il CSPRNG di Deno.
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function jsonOk(p: unknown): Response {
  return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
