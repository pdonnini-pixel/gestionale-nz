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
//                    Con delivery="password" non manda email: crea il login gia'
//                    confermato con una password generata, restituita UNA volta
//                    (serve quando l'email di invito non arriva o la casella
//                    non e' letta, es. account di negozio).
//   - "set_role"   → cambia ruolo (app_metadata.role + user_profiles.role)
//   - "set_active" → blocca/sblocca l'accesso (ban dell'utente auth)
//   - "delete"     → revoca il login (elimina l'utente auth + user_profiles)
//   - "recover"    → PUBBLICA (nessun login richiesto): "password dimenticata".
//                    Manda all'utente il link per reimpostare la password.
//                    Risponde sempre ok, anche se l'email non esiste, per non
//                    rivelare chi ha un accesso; al massimo una mail al minuto
//                    per utente.
//   - "set_password" → genera una nuova password (12 caratteri, senza simboli
//                    ambigui) e la imposta sul login. La password viene
//                    restituita UNA sola volta al chiamante, che la comunica
//                    all'utente (es. account di negozio senza email attiva):
//                    nessuna email automatica.
//
// Email di invito e di recupero: se il tenant ha i secret RESEND_API_KEY e
// DISTINTA_EMAIL_FROM (gli stessi del report incassi), il link lo genera
// Supabase (generateLink, nessuna mail) e la mail parte da Resend con il
// nome dell'azienda, in italiano. Senza quei secret si ripiega sulla mail
// standard di Supabase Auth, come prima.
//
// Body: { action, delivery?, email?, first_name?, last_name?, phone?, role?, user_id?, active?, redirectTo?, outlet_id?, company_id? }
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

    // ───────── RECOVER (pubblica: "password dimenticata" dalla pagina di login) ─────────
    if (action === "recover") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const redirectTo = safeRedirect(body.redirectTo);
      if (!email || !email.includes("@")) return jsonOk({ ok: true });
      const { data: prof } = await admin.from("user_profiles")
        .select("id, company_id").ilike("email", escapeLike(email)).limit(1).maybeSingle();
      const p = prof as { id?: string; company_id?: string } | null;
      if (!p?.id) return jsonOk({ ok: true });
      const { data: au } = await admin.auth.admin.getUserById(p.id);
      const u = au?.user as { email?: string; recovery_sent_at?: string; banned_until?: string } | undefined;
      if (!u?.email) return jsonOk({ ok: true });
      if (u.banned_until && new Date(u.banned_until).getTime() > Date.now()) return jsonOk({ ok: true });
      if (u.recovery_sent_at && Date.now() - new Date(u.recovery_sent_at).getTime() < 60_000) return jsonOk({ ok: true });

      if (!resendConfigured()) {
        // Ripiego: mail standard di Supabase Auth
        const anon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
        await anon.auth.resetPasswordForEmail(u.email, redirectTo ? { redirectTo } : undefined);
        return jsonOk({ ok: true });
      }
      const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
        type: "recovery", email: u.email, ...(redirectTo ? { options: { redirectTo } } : {}),
      });
      if (linkErr || !link?.properties?.action_link) {
        console.error("[admin-manage-user] recover generateLink:", linkErr?.message);
        return jsonOk({ ok: true });
      }
      const companyName = await getCompanyName(admin, p.company_id ?? null);
      const sent = await sendAuthEmail("recovery", u.email, link.properties.action_link, companyName, redirectTo);
      if (!sent) console.error("[admin-manage-user] recover: invio Resend non riuscito");
      return jsonOk({ ok: true });
    }

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
          invited_at: (au?.user as { invited_at?: string } | null)?.invited_at ?? null,
        });
      }
      return jsonOk({ users: list });
    }

    // ───────── INVITE (crea login + email di invito, oppure password generata) ─────────
    if (action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const role = String(body.role ?? "operatore_cassa");
      if (!email) return jsonError(400, "Email obbligatoria");
      if (!ASSIGNABLE_ROLES.includes(role)) return jsonError(400, `Ruolo non valido: ${role}`);
      if (role === "operatore_cassa" && !String(body.outlet_id ?? "").trim()) {
        return jsonError(400, "Per l'operatore di cassa serve il punto vendita (outlet_id).");
      }
      const redirectTo = String(body.redirectTo ?? "");
      const userMeta = { first_name: body.first_name ?? "", last_name: body.last_name ?? "" };
      const withPassword = body.delivery === "password";

      let newUserId: string;
      let password: string | null = null;
      let inviteLink: string | null = null;
      if (withPassword) {
        password = generatePassword();
        const { data: cr, error: crErr } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: userMeta,
        });
        if (crErr || !cr?.user) return jsonError(400, `Creazione utente non riuscita: ${crErr?.message ?? "sconosciuto"}`);
        newUserId = cr.user.id;
      } else if (resendConfigured()) {
        // Link di invito generato da Supabase (nessuna mail), mail nostra via Resend
        const { data: gl, error: glErr } = await admin.auth.admin.generateLink({
          type: "invite", email,
          options: { data: userMeta, ...(redirectTo ? { redirectTo } : {}) },
        });
        if (glErr || !gl?.user || !gl.properties?.action_link) {
          return jsonError(400, `Invito non riuscito: ${glErr?.message ?? "sconosciuto"}`);
        }
        newUserId = gl.user.id;
        inviteLink = gl.properties.action_link;
      } else {
        const { data: inv, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: userMeta,
          ...(redirectTo ? { redirectTo } : {}),
        });
        if (invErr || !inv?.user) return jsonError(400, `Invito non riuscito: ${invErr?.message ?? "sconosciuto"}`);
        newUserId = inv.user.id;
      }

      // Ruolo nel JWT (app_metadata) + profilo aziendale
      await admin.auth.admin.updateUserById(newUserId, { app_metadata: { role } });
      await admin.from("user_profiles").upsert({
        id: newUserId,
        company_id: myCompany,
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        email,
        phone: body.phone ?? null,
        role,
      }, { onConflict: "id" });

      const outletErr = await assignOutlet(newUserId, role, body.outlet_id);
      if (outletErr) return jsonError(400, outletErr);

      // Mail di invito nostra: se Resend non risponde l'utente esiste gia',
      // lo si dice al chiamante (puo' generare la password con la chiave).
      let mail: "sent" | "failed" | undefined;
      if (inviteLink) {
        const companyName = await getCompanyName(admin, myCompany);
        mail = (await sendAuthEmail("invite", email, inviteLink, companyName, redirectTo, String(body.first_name ?? ""))) ? "sent" : "failed";
      }

      return jsonOk({ ok: true, user_id: newUserId, invited: email, ...(password ? { password } : {}), ...(mail ? { mail } : {}) });
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

// ───────── Email di accesso (invito / password dimenticata) via Resend ─────────

function resendConfigured(): boolean {
  return !!(Deno.env.get("RESEND_API_KEY") && Deno.env.get("DISTINTA_EMAIL_FROM"));
}

// Solo URL https verso /reset-password: il link nella mail non deve poter
// portare altrove. Supabase lo ricontrolla comunque con i Redirect URLs.
function safeRedirect(v: unknown): string {
  try {
    const u = new URL(String(v ?? ""));
    return u.protocol === "https:" && u.pathname === "/reset-password" ? u.toString() : "";
  } catch {
    return "";
  }
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// deno-lint-ignore no-explicit-any
async function getCompanyName(admin: any, companyId: string | null): Promise<string> {
  if (companyId) {
    const { data } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
    const name = (data as { name?: string } | null)?.name;
    if (name) return name;
  }
  // Profilo senza azienda: ogni tenant ha un solo progetto Supabase, quindi
  // se c'e' una sola azienda e' quella.
  const { data: all } = await admin.from("companies").select("name").limit(2);
  const rows = (all ?? []) as Array<{ name?: string }>;
  return rows.length === 1 && rows[0].name ? rows[0].name : "Gestionale";
}

// Mittente delle email di accesso: accessi@ sullo stesso dominio (gia'
// verificato su Resend) del mittente delle distinte, con il nome dell'azienda
// come nome visibile. Se il dominio non si legge, si usa il mittente com'e'.
function accessiFrom(baseFrom: string, companyName: string): string {
  const m = baseFrom.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  if (!m) return baseFrom;
  const display = `Gestionale ${companyName}`.replace(/["<>\r\n]/g, "").trim();
  return `"${display}" <accessi@${m[1]}>`;
}

async function sendAuthEmail(
  kind: "invite" | "recovery", to: string, link: string, companyName: string, redirectTo: string, firstName = "",
): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  const baseFrom = Deno.env.get("DISTINTA_EMAIL_FROM");
  if (!key || !baseFrom) return false;
  const from = accessiFrom(baseFrom, companyName);

  const site = redirectTo ? new URL(redirectTo).host : "";
  const name = escapeHtml(companyName);
  const hello = firstName.trim() ? `Ciao ${escapeHtml(firstName.trim())},` : "Ciao,";
  const subject = kind === "invite"
    ? `Il tuo accesso al gestionale ${companyName}`
    : `Reimposta la password del gestionale ${companyName}`;
  const intro = kind === "invite"
    ? `ti è stato creato un accesso al gestionale di <strong>${name}</strong>. Per entrare scegli la tua password dal pulsante qui sotto.`
    : `abbiamo ricevuto una richiesta per reimpostare la password del gestionale di <strong>${name}</strong>. Scegli la nuova password dal pulsante qui sotto.`;
  const button = kind === "invite" ? "Scegli la password" : "Reimposta la password";
  const note = kind === "invite"
    ? "Il link si può usare una sola volta e scade dopo un po' di tempo: se non funziona più, chiedi all'amministrazione di mandarti un nuovo accesso. Dopo, entra con la tua email e la password che hai scelto."
    : "Il link si può usare una sola volta e scade dopo un po' di tempo: se non funziona più, ripeti la richiesta da \"Password dimenticata?\". Se non hai chiesto tu di cambiare password, ignora questa email: la password attuale resta valida.";

  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
<tr><td style="background:#1e3a8a;padding:20px 28px;color:#ffffff">
<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Gestionale</div>
<div style="font-size:20px;font-weight:700;margin-top:2px">${name}</div></td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font-size:15px">${hello}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.55">${intro}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#2563eb">
<a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${button}</a>
</td></tr></table>
<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#475569">${note}</p>
<p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#94a3b8">Se il pulsante non funziona, copia questo indirizzo nel browser:<br><span style="word-break:break-all">${escapeHtml(link)}</span></p>
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8">${site ? escapeHtml(site) + " · " : ""}Email automatica, non rispondere.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${firstName.trim() ? `Ciao ${firstName.trim()},` : "Ciao,"}\n\n${intro.replace(/<[^>]+>/g, "")}\n\n${button}: ${link}\n\n${note}`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!resp.ok) {
      console.error(`[admin-manage-user] Resend ${resp.status}:`, (await resp.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[admin-manage-user] Resend:", e);
    return false;
  }
}
