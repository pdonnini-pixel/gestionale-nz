// Edge Function: acube-cf-sync-invoices
//
// Scarica le fatture (passive e attive) gia' depositate da A-Cube su
// Cassetto Fiscale via GET /invoices (con paginazione hydra:view).
// Upsert su public.electronic_invoices (gia' usata da SDI webhook).
//
// A-Cube fa il download fisico dal Cassetto Fiscale tramite il job
// /jobs/invoice-download o il schedule giornaliero /schedule/invoice-download/{fid}.
// Questa edge function legge solo i risultati gia' scaricati e li importa
// nel nostro DB.
//
// Body POST: { companyId, stage?: 'sandbox'|'production', since?: 'YYYY-MM-DD', invoiceType?: 'received'|'sent'|'all' }
// Auth: super_advisor O service_role (per cron)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IT_BASE_URL: Record<string, string> = {
  sandbox: "https://it-sandbox.api.acubeapi.com",
  production: "https://it.api.acubeapi.com",
};

const ACUBE_LOGIN_URLS: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/login",
  production: "https://common.api.acubeapi.com/login",
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

async function refreshAcubeJwt(supabase: SupabaseClient, stage: string): Promise<{ jwt?: string; error?: string }> {
  const { data: creds, error: credsErr } = await supabase.rpc("get_acube_credentials", { p_stage: stage });
  if (credsErr || !creds || !creds[0]) return { error: `get_acube_credentials: ${credsErr?.message ?? "no row"}` };
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
  if (!newJwt) return { error: "no token" };
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  let pullId: string | null = null;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: super_advisor o service_role (per cron)
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const isServiceRole = token === supabaseServiceKey;
    let userId: string | null = null;
    let triggeredByCron = false;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      const roleData = userData.user.app_metadata?.role ?? userData.user.user_metadata?.role;
      const userRoles: string[] = Array.isArray(roleData) ? roleData : (roleData ? [roleData] : []);
      if (!userRoles.includes("super_advisor")) return jsonError(403, `Solo super_advisor (ruoli: ${userRoles.join(", ")})`);
      userId = userData.user.id;
    } else {
      triggeredByCron = true;
    }

    const body = await req.json().catch(() => ({}));
    const companyId: string = (body.companyId ?? "").toString().trim();
    const stage: string = (body.stage ?? "sandbox").toString();
    const sinceDefault = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const since: string = (body.since ?? sinceDefault).toString();
    const invoiceType: string = (body.invoiceType ?? "all").toString();
    if (!companyId) return jsonError(400, "Missing companyId");
    const baseUrl = IT_BASE_URL[stage];
    if (!baseUrl) return jsonError(400, `Invalid stage: ${stage}`);

    // Get config
    const { data: configData } = await supabase
      .from("acube_cassetto_fiscale_config" as never)
      .select("id, business_registry_uuid, fiscal_id, status")
      .eq("company_id" as never, companyId as never)
      .eq("stage" as never, stage as never)
      .maybeSingle();
    if (!configData) return jsonError(404, `Config Cassetto Fiscale per company=${companyId} stage=${stage} non trovata. Eseguire prima assign-appointee.`);
    const config = configData as unknown as { id: string; business_registry_uuid: string; fiscal_id: string; status: string };
    if (config.status !== "active") {
      return jsonError(409, `Status config = '${config.status}' (atteso 'active'). Verifica setup Appointee.`);
    }

    // Create pull record (running)
    const { data: pullData } = await supabase
      .from("acube_cassetto_fiscale_pulls" as never)
      .insert({
        config_id: config.id,
        company_id: companyId,
        date_from: since,
        date_to: new Date().toISOString().slice(0, 10),
        invoice_type: invoiceType === "received" ? "passive" : invoiceType === "sent" ? "active" : "both",
        status: "running",
        triggered_by_user_id: userId,
        triggered_by_cron: triggeredByCron,
      } as never)
      .select("id")
      .single();
    pullId = (pullData as { id: string } | null)?.id ?? null;

    let jwt = await getCachedJwt(supabase, stage);

    // GET /invoices con paginazione hydra. Filtri: type=passive|active|all, updated_after=since
    const params = new URLSearchParams();
    params.set("itemsPerPage", "100");
    params.set("page", "1");
    if (since) params.set("updated_after", since);
    if (invoiceType === "received") params.set("type", "passive");
    else if (invoiceType === "sent") params.set("type", "active");
    // Filtro per fiscal_id del tenant
    params.set("fiscal_id", config.fiscal_id);

    const buildUrl = (relPath?: string | null) => {
      if (relPath) return relPath.startsWith("http") ? relPath : `${baseUrl}${relPath}`;
      return `${baseUrl}/invoices?${params.toString()}`;
    };

    const doGet = async (url: string, j: string) => fetch(url, {
      headers: { Authorization: `Bearer ${j}`, Accept: "application/ld+json" },
    });

    let nextUrl: string | null = buildUrl(null);
    const invoices: any[] = [];
    let pages = 0;

    while (nextUrl && pages < 50) {
      let resp = await doGet(nextUrl, jwt);
      if (resp.status === 401) {
        const r = await refreshAcubeJwt(supabase, stage);
        if (!r.jwt) throw new Error(`Refresh fallito: ${r.error}`);
        jwt = r.jwt;
        resp = await doGet(nextUrl, jwt);
      }
      if (!resp.ok) {
        throw new Error(`A-Cube /invoices HTTP ${resp.status} pagina ${pages + 1}: ${(await resp.text()).slice(0, 300)}`);
      }
      const data = await resp.json();
      const items: any[] = data["hydra:member"] ?? data.data ?? data.invoices ?? (Array.isArray(data) ? data : []);
      invoices.push(...items);
      const nextRel: string | undefined = data["hydra:view"]?.["hydra:next"] ?? data.next ?? null;
      nextUrl = nextRel ? buildUrl(nextRel) : null;
      pages++;
      if (items.length === 0) break;
    }

    // Upsert in public.acube_sdi_invoices (tabella unificata fatture A-Cube)
    // Dedup su acube_uuid. Da acube_sdi_invoices i ponti trigger esistenti
    // (vedi migration 029) propagano in electronic_invoices + payables.
    let inserted = 0;
    let duplicates = 0;
    let failed = 0;

    for (const inv of invoices) {
      const invoiceUuid: string = inv.uuid ?? inv.id ?? inv["@id"]?.split("/").pop() ?? "";
      if (!invoiceUuid) { failed++; continue; }

      // Check existing by acube_uuid
      const { data: existing } = await supabase
        .from("acube_sdi_invoices" as never)
        .select("id")
        .eq("acube_uuid" as never, invoiceUuid as never)
        .maybeSingle();
      if (existing) { duplicates++; continue; }

      const direction: string = inv.direction ?? inv.type ?? "passive";
      const marking: string = inv.marking ?? (direction === "active" ? "sent" : "received");

      const payload: Record<string, unknown> = {
        acube_uuid: invoiceUuid,
        business_fiscal_id: config.fiscal_id,
        direction,
        marking,
        sdi_file_id: inv.sdi_file_id ?? inv.sdiFileId ?? null,
        sdi_file_name: inv.sdi_file_name ?? inv.sdiFileName ?? null,
        transmission_format: inv.transmission_format ?? null,
        document_type: inv.document_type ?? inv.tipo_documento ?? null,
        invoice_number: inv.invoice_number ?? inv.number ?? null,
        invoice_date: inv.invoice_date ?? inv.date ?? null,
        currency: inv.currency ?? "EUR",
        total_amount: inv.total_amount ?? inv.totale ?? null,
        to_pa: inv.to_pa ?? false,
        sender_vat: inv.sender?.vat ?? inv.sender_vat ?? null,
        sender_country: inv.sender?.country ?? inv.sender_country ?? "IT",
        sender_name: inv.sender?.name ?? inv.sender_name ?? null,
        recipient_vat: inv.recipient?.vat ?? inv.recipient_vat ?? null,
        recipient_name: inv.recipient?.name ?? inv.recipient_name ?? null,
        recipient_code: inv.recipient?.code ?? inv.recipient_code ?? null,
        signed: inv.signed ?? false,
        legally_stored: inv.legally_stored ?? false,
        downloaded: true,
        downloaded_at: new Date().toISOString(),
        notifications: inv.notifications ?? null,
        payload: inv,
        xml_content: inv.xml_content ?? null,
        acube_created_at: inv.created_at ?? inv.createdAt ?? null,
        fetched_at: new Date().toISOString(),
      };

      const { error: insErr } = await supabase.from("acube_sdi_invoices" as never).insert(payload as never);
      if (insErr) {
        failed++;
        console.warn("insert failed", invoiceUuid, insErr.message);
      } else {
        inserted++;
      }
    }

    // Aggiorna config con last_sync
    await supabase.from("acube_cassetto_fiscale_config" as never)
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_invoices_count: inserted,
      } as never)
      .eq("id" as never, config.id as never);

    // Chiudi pull record
    if (pullId) {
      await supabase.from("acube_cassetto_fiscale_pulls" as never)
        .update({
          status: failed > 0 ? "partial" : "success",
          invoices_fetched: invoices.length,
          invoices_inserted: inserted,
          invoices_duplicates: duplicates,
          invoices_failed: failed,
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, pullId as never);
    }

    return jsonOk({
      ok: true,
      fetched: invoices.length,
      inserted,
      duplicates,
      failed,
      since,
      stage,
    });
  } catch (e) {
    if (pullId) {
      const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await supabase.from("acube_cassetto_fiscale_pulls" as never)
        .update({
          status: "failed",
          error_message: e instanceof Error ? e.message : String(e),
          completed_at: new Date().toISOString(),
        } as never)
        .eq("id" as never, pullId as never);
    }
    return jsonError(500, `Internal: ${e instanceof Error ? e.message : String(e)}`);
  }
});

function jsonOk(p: unknown): Response { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonError(status: number, message: string): Response { return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
