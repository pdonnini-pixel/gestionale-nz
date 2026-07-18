// Edge Function: admin-manage-user
// Gestione REALE degli utenti/accessi (login) per la sezione Impostazioni → Utenti.
// Unico punto che tocca l'autenticazione: usa l'Admin API con service role.
//
// Sicurezza:
//   - Chiamante autenticato con ruolo super_advisor (app_metadata.role).
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
//
// Body: { action, email?, first_name?, last_name?, role?, user_id?, active?, redirectTo? }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BAN_FOREVER = "876000h"; // ~100 anni = accesso bloccato
const ASSIGNABLE_ROLES = ["super_advisor", "cfo", "coo", "contabile", "store_manager", "operatrice", "viewer"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // 1. Autenticazione chiamante
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");

    // 2. Ruolo SOLO da app_metadata (mai user_metadata). Solo super_advisor.
    const roleData = userData.user.app_metadata?.role;
    const roles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
    if (!roles.includes("super_advisor")) {
      return jsonError(403, "Solo un super_advisor può gestire gli utenti.");
    }

    // 3. Azienda del chiamante (dal profilo)
    const { data: myProf } = await admin.from("user_profiles").select("company_id").eq("id", userData.user.id).maybeSingle();
    const myCompany = (myProf as { company_id?: string } | null)?.company_id ?? null;
    if (!myCompany) return jsonError(403, "Utente senza azienda associata.");

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "";

    // Helper: verifica che l'utente target appartenga alla MIA azienda
    const assertSameCompany = async (targetId: string): Promise<boolean> => {
      const { data } = await admin.from("user_profiles").select("company_id").eq("id", targetId).maybeSingle();
      return (data as { company_id?: string } | null)?.company_id === myCompany;
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
      const role = String(body.role ?? "operatrice");
      if (!email) return jsonError(400, "Email obbligatoria");
      if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(400, `Ruolo non valido: ${role}`);
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
        role,
      }, { onConflict: "id" });

      return jsonOk({ ok: true, user_id: inv.user.id, invited: email });
    }

    // Da qui in poi serve un user_id target della propria azienda
    const targetId = String(body.user_id ?? "");
    if (!targetId) return jsonError(400, "user_id obbligatorio");
    if (targetId === userData.user.id && (action === "delete" || (action === "set_active" && body.active === false))) {
      return jsonError(400, "Non puoi bloccare o eliminare te stesso.");
    }
    if (!(await assertSameCompany(targetId))) return jsonError(403, "Utente non appartiene alla tua azienda.");

    // ───────── SET_ROLE ─────────
    if (action === "set_role") {
      const role = String(body.role ?? "");
      if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(400, `Ruolo non valido: ${role}`);
      await admin.auth.admin.updateUserById(targetId, { app_metadata: { role } });
      await admin.from("user_profiles").update({ role }).eq("id", targetId);
      return jsonOk({ ok: true });
    }

    // ───────── SET_ACTIVE (blocca/sblocca accesso) ─────────
    if (action === "set_active") {
      const active = body.active !== false;
      await admin.auth.admin.updateUserById(targetId, { ban_duration: active ? "none" : BAN_FOREVER });
      return jsonOk({ ok: true, active });
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

function jsonOk(p: unknown): Response {
  return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
