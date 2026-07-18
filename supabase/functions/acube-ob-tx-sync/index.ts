// Edge Function: acube-ob-tx-sync
// Scarica e persistenza transazioni: GET /business-registry/{fiscalId}/transactions?account={uuid}&since=YYYY-MM-DD
// Upsert su `acube_transactions` (dedup_hash) e bridge su `bank_transactions`.
//
// Body:
//   {
//     "stage": "sandbox" | "production",
//     "fiscalId": "07362100484",
//     "companyId": "00000000-0000-0000-0000-000000000001",
//     "accountUuid": "<opt: scarica solo per un account>",
//     "since": "YYYY-MM-DD"   (opt: default 60 giorni fa)
//   }
//
// Risposta:
//   { fetched, acube_inserted, bank_inserted, duplicates }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OB_BASE_URL: Record<string, string> = {
  sandbox: "https://ob-sandbox.api.acubeapi.com",
  production: "https://ob.api.acubeapi.com",
};

const ACUBE_LOGIN_URLS: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/login",
  production: "https://common.api.acubeapi.com/login",
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

async function refreshAcubeJwt(supabase: SupabaseClient, stage: string): Promise<{ jwt?: string; error?: string }> {
  const { data: creds, error: credsErr } = await supabase.rpc("get_acube_credentials", { p_stage: stage });
  if (credsErr || !creds || !creds[0]) return { error: `get_acube_credentials failed: ${credsErr?.message ?? "no row"}` };
  const { email, password } = creds[0] as { email: string; password: string };
  const loginUrl = ACUBE_LOGIN_URLS[stage];
  if (!loginUrl) return { error: `Invalid stage: ${stage}` };
  const resp = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) return { error: `A-Cube login HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}` };
  const data = await resp.json() as { token?: string; jwt?: string; access_token?: string; expires_at?: string; expires_in?: number };
  const newJwt = data.token ?? data.jwt ?? data.access_token;
  if (!newJwt) return { error: "A-Cube login response missing token" };
  let expiresAt: string;
  if (data.expires_at) expiresAt = new Date(data.expires_at).toISOString();
  else if (data.expires_in) expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  else expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
  await supabase.from("acube_tokens").upsert(
    { stage, jwt: newJwt, expires_at: expiresAt, updated_at: new Date().toISOString() },
    { onConflict: "stage" },
  );
  return { jwt: newJwt };
}

async function getCachedJwt(supabase: SupabaseClient, stage: string): Promise<string> {
  const { data } = await supabase.from("acube_tokens").select("jwt, expires_at").eq("stage", stage).maybeSingle();
  if (data?.jwt && data?.expires_at && new Date(data.expires_at as string).getTime() > Date.now() + 60_000) return data.jwt as string;
  const refresh = await refreshAcubeJwt(supabase, stage);
  if (refresh.error || !refresh.jwt) throw new Error(`JWT refresh failed: ${refresh.error}`);
  return refresh.jwt;
}

// Hash per acube_transactions (deduplica chiamate identiche all'API A-Cube).
function dedupHash(accountUuid: string, txid: string, madeOn: string, amount: number): string {
  return `${accountUuid}|${txid}|${madeOn}|${amount.toFixed(2)}`;
}

// Hash canonical per bank_transactions (deve essere IDENTICO a public.bank_transaction_canonical_hash
// in Postgres - migration 051). Indipendente da txid (A-Cube lo ribatte tra paginate) e da source
// (uniforme per edge function + cron RPC). MD5 esadecimale.
function canonicalBankHash(bankAccountId: string, date: string, amount: number, description: string): string {
  const amountStr = amount.toFixed(2); // FM999999990.00 in PG, 2 decimali sempre
  const descTrunc = (description || "").slice(0, 40);
  const input = `${bankAccountId}|${date}|${amountStr}|${descTrunc}`;
  return createHash("md5").update(input).digest("hex");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const isServiceRole = token === supabaseServiceKey;
    let callerCompanyId: string | null = null;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      const roleData = userData.user.app_metadata?.role; // SOLO app_metadata: user_metadata e modificabile dal client (privilege escalation)
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      const allowed = ["super_advisor", "contabile", "cfo"];
      if (!userRoles.some((r) => allowed.includes(r))) return jsonError(403, `Roles [${userRoles.join(", ")}] not allowed.`);
      const { data: prof } = await supabase.from("user_profiles").select("company_id").eq("id", userData.user.id).maybeSingle();
      callerCompanyId = (prof as { company_id?: string } | null)?.company_id ?? null;
      if (!callerCompanyId) return jsonError(403, "Utente senza azienda associata");
    }

    const body = await req.json().catch(() => ({}));
    const stage: string = body.stage ?? "sandbox";
    const fiscalId: string = (body.fiscalId ?? "").toString().trim();
    let companyId: string = (body.companyId ?? "").toString().trim();
    const accountUuidFilter: string | null = body.accountUuid ?? null;
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const since: string = body.since ?? sixtyDaysAgo;
    // Isolamento tenant: un utente non può scrivere movimenti su un'azienda diversa
    // dalla propria. Il company_id viene SEMPRE dal profilo del chiamante; il body è
    // solo indicativo. I job service-role (cron) restano fidati col companyId passato.
    if (!isServiceRole) {
      if (companyId && companyId !== callerCompanyId) return jsonError(403, "companyId non corrisponde alla tua azienda");
      companyId = callerCompanyId!;
    }
    if (!fiscalId || !companyId) return jsonError(400, "Missing fiscalId or companyId");
    const baseUrl = OB_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    let jwt = await getCachedJwt(supabase, stage);

    const params = new URLSearchParams();
    if (accountUuidFilter) params.set("account", accountUuidFilter);
    if (since) params.set("madeOn[strictly_after]", since);
    params.set("itemsPerPage", "100");
    params.set("page", "1");

    const buildUrl = (relPath?: string | null) => {
      if (relPath) return relPath.startsWith("http") ? relPath : `${baseUrl}${relPath}`;
      return `${baseUrl}/business-registry/${encodeURIComponent(fiscalId)}/transactions?${params.toString()}`;
    };

    const doGet = async (url: string, j: string) => fetch(url, { headers: { Authorization: `Bearer ${j}`, Accept: "application/ld+json" } });

    let nextUrl: string | null = buildUrl(null);
    const txs: any[] = [];
    let pages = 0;
    while (nextUrl && pages < 50) {
      let resp = await doGet(nextUrl, jwt);
      if (resp.status === 401) {
        const r = await refreshAcubeJwt(supabase, stage);
        if (!r.jwt) return jsonError(500, `Refresh fallito: ${r.error}`);
        jwt = r.jwt;
        resp = await doGet(nextUrl, jwt);
      }
      if (!resp.ok) return jsonError(resp.status, `A-Cube transactions HTTP ${resp.status} pagina ${pages + 1}: ${(await resp.text()).slice(0, 300)}`);
      const data = await resp.json();
      const items: any[] = data["hydra:member"] ?? data.data ?? data.transactions ?? (Array.isArray(data) ? data : []);
      txs.push(...items);
      const nextRel: string | undefined = data["hydra:view"]?.["hydra:next"] ?? data.next ?? null;
      nextUrl = nextRel ? buildUrl(nextRel) : null;
      pages++;
      if (items.length === 0) break;
    }

    // Lookup map: acube_account_uuid → bank_accounts.id (per insert in bank_transactions)
    const { data: bankRows } = await supabase.from("bank_accounts")
      .select("id, acube_account_uuid")
      .eq("company_id", companyId).not("acube_account_uuid", "is", null);
    const acubeToBankId = new Map<string, string>();
    for (const row of (bankRows ?? []) as Array<{ id: string; acube_account_uuid: string }>) {
      acubeToBankId.set(row.acube_account_uuid, row.id);
    }

    let acubeIns = 0;
    let bankIns = 0;
    let dups = 0;

    for (const t of txs) {
      const txid: string = t.id ?? t.uuid ?? t.transactionId;
      if (!txid) continue;
      const accountUuid: string = t.account?.uuid ?? t.accountId ?? t.account_uuid ?? "";
      if (!accountUuid) continue;
      const madeOn: string = t.madeOn ?? t.made_on ?? t.date ?? t.bookingDate ?? "";
      if (!madeOn) continue;
      const amount: number = Number(t.amount ?? 0);
      const currency: string = (t.currencyCode ?? t.currency_code ?? t.currency ?? "EUR").toUpperCase();
      const description: string = t.description ?? t.label ?? t.merchant ?? "";
      const payer: string | null = t.payer ?? null;
      const payee: string | null = t.payee ?? null;
      const status: string = (t.status ?? "BOOKED").toString().toUpperCase();
      const hash = dedupHash(accountUuid, txid, madeOn, amount);

      const { data: ex } = await supabase.from("acube_transactions").select("id").eq("dedup_hash", hash).maybeSingle();
      if (ex) { dups++; continue; }

      const { error: ae } = await supabase.from("acube_transactions").insert({
        acube_transaction_id: txid,
        acube_account_uuid: accountUuid,
        dedup_hash: hash,
        amount,
        currency_code: currency,
        made_on: madeOn,
        posting_date: t.postingDate ?? t.posting_date ?? null,
        description,
        payer,
        payee,
        status,
        category: t.category ?? null,
        categorization_confidence: t.categorizationConfidence ?? t.categorization_confidence ?? null,
        mcc: t.mcc ?? null,
        merchant_id: t.merchantId ?? t.merchant_id ?? null,
        end_to_end_id: t.endToEndId ?? t.end_to_end_id ?? null,
        closing_balance: t.closingBalance ?? t.closing_balance ?? null,
        additional: t.additional ?? null,
        duplicated: false,
        fetched_at: new Date().toISOString(),
        acube_created_at: t.createdAt ?? t.created_at ?? null,
        acube_updated_at: t.updatedAt ?? t.updated_at ?? null,
        extra: t,
      });
      if (ae) continue;
      acubeIns++;

      // Bridge: insert in bank_transactions se esiste bank_account corrispondente.
      // Usa canonical hash (migration 051): indipendente da txid che A-Cube ribatte tra paginate,
      // identico al hash di cron RPC acube_ob_sync_all_production, protetto da UNIQUE INDEX.
      const bankAccountId = acubeToBankId.get(accountUuid);
      if (!bankAccountId) continue;
      const bankHash = canonicalBankHash(bankAccountId, madeOn, amount, description);
      const { error: be } = await supabase.from("bank_transactions").insert({
        company_id: companyId,
        bank_account_id: bankAccountId,
        transaction_date: madeOn,
        booking_date: madeOn,
        value_date: t.postingDate ?? t.posting_date ?? madeOn,
        amount,
        currency,
        description,
        counterpart_name: amount < 0 ? payee : payer,
        merchant_name: t.merchant ?? null,
        category: t.category ?? null,
        status: status === "BOOKED" ? "booked" : status.toLowerCase(),
        source: "acube_ob",
        acube_dedup_hash: bankHash,
        raw_data: t,
        is_reconciled: false,
      });
      // Codice 23505 = unique_violation: significa che il movimento esiste gia' (canonical hash collide)
      // -> non e' un errore, e' la protezione anti-dup. Tutti gli altri errori vengono ignorati silenziosamente
      // come prima (consistente con comportamento legacy).
      if (!be) bankIns++;
      else if (be.code === "23505") dups++;
    }

    // Aggiorna balance_updated_at sui bank_accounts toccati (anche con 0 nuove tx).
    // Questo rappresenta "ultima volta che abbiamo verificato i dati con A-Cube".
    // Senza questo update, la UI mostra sempre il timestamp dell'ultimo accounts-sync
    // e l'utente vede "4h fa" anche dopo aver cliccato "Aggiorna movimenti".
    const touchedBankIds = accountUuidFilter
      ? (acubeToBankId.get(accountUuidFilter) ? [acubeToBankId.get(accountUuidFilter)!] : [])
      : Array.from(acubeToBankId.values());
    if (touchedBankIds.length > 0) {
      await supabase.from("bank_accounts")
        .update({ balance_updated_at: new Date().toISOString() })
        .in("id", touchedBankIds);
    }

    return jsonOk({ fetched: txs.length, acube_inserted: acubeIns, bank_inserted: bankIns, duplicates: dups, since, account_filter: accountUuidFilter, bank_accounts_touched: touchedBankIds.length });
  } catch (e) {
    return jsonError(500, `Internal error: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
