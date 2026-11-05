// Guardia comune per le Edge Function che girano con la service role.
//
// Perché esiste (05/11/2026, dopo la migration 360): su NZ e Zago la
// registrazione libera di Supabase Auth era aperta. Un account autoregistrato
// ha un JWT valido ma nessuna riga in user_profiles. La RLS lo ferma sulle
// tabelle, però le funzioni che usano la service role la scavalcano: senza
// questo controllo bastava `auth.getUser(token)` per spedire mail col mittente
// aziendale, consumare la chiave Anthropic o lanciare la sincronizzazione SDI.
//
// Cosa fa, in ordine:
//   1. token assente                      → 401
//   2. token = service role key           → ammesso (chiamate interne, cron)
//   3. auth.getUser(token) fallisce        → 401
//   4. nessun profilo, o is_active = false → 403 NO_PROFILE
//   5. ruolo fuori dall'elenco ammesso     → 403 ROLE_NOT_ALLOWED
//
// Il profilo si legge con il client service role passato dal chiamante, così
// non dipende dalla RLS di user_profiles.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

/** Ruoli amministrativi: chi gestisce pagamenti, distinte e fatture. */
export const RUOLI_AMMINISTRATIVI = ["super_advisor", "contabile", "ceo", "cfo", "coo"] as const;

/** Estrazione dei PDF nello Scadenzario: i ruoli amministrativi più l'approvatore
 *  del budget (deciso da Patrizio il 05/11/2026). Solo lettura, nessun invio. */
export const RUOLI_ESTRAZIONE = [...RUOLI_AMMINISTRATIVI, "budget_approver"] as const;

export type Chiamante =
  | { ok: true; serviceRole: true; userId: null; companyId: null; role: null; email: null }
  | { ok: true; serviceRole: false; userId: string; companyId: string; role: string; email: string | null }
  | { ok: false; status: 401 | 403 | 500; code: string; message: string };

export interface OpzioniVerifica {
  /** Ruoli ammessi. Se omesso basta un profilo attivo, qualunque ruolo. */
  ruoli?: readonly string[];
  /** Ammette il token della service role (default: sì). */
  ammettiServiceRole?: boolean;
}

export function tokenDaRichiesta(req: Request): string {
  const authHeader = req.headers.get("Authorization") ?? "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

export async function verificaProfilo(
  admin: SupabaseClient,
  token: string,
  serviceKey: string,
  opzioni: OpzioniVerifica = {},
): Promise<Chiamante> {
  const { ruoli, ammettiServiceRole = true } = opzioni;
  if (!token) return { ok: false, status: 401, code: "MISSING_AUTH", message: "Missing authorization" };

  if (ammettiServiceRole && serviceKey && token === serviceKey) {
    return { ok: true, serviceRole: true, userId: null, companyId: null, role: null, email: null };
  }

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, code: "INVALID_JWT", message: "Invalid JWT" };
  }
  const user = userData.user;

  const { data: prof, error: profErr } = await admin
    .from("user_profiles")
    .select("company_id, role, is_active")
    .eq("id", user.id)
    .maybeSingle();
  if (profErr) {
    console.error("[verificaProfilo] lettura profilo fallita:", profErr.message);
    return { ok: false, status: 500, code: "PROFILE_LOOKUP_ERROR", message: "Verifica del profilo non riuscita" };
  }
  if (!prof || !prof.company_id || prof.is_active === false) {
    console.warn(`[verificaProfilo] accesso negato: utente ${user.id} senza profilo attivo`);
    return { ok: false, status: 403, code: "NO_PROFILE", message: "Account non abilitato al gestionale" };
  }
  const role = String(prof.role ?? "");
  if (ruoli && !ruoli.includes(role)) {
    console.warn(`[verificaProfilo] accesso negato: utente ${user.id} ruolo ${role}`);
    return { ok: false, status: 403, code: "ROLE_NOT_ALLOWED", message: "Il tuo ruolo non può usare questa funzione" };
  }
  return {
    ok: true,
    serviceRole: false,
    userId: user.id,
    companyId: String(prof.company_id),
    role,
    email: user.email ?? null,
  };
}
