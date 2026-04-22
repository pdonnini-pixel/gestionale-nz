/**
 * Netlify Serverless Function — SDI Sync (manuale)
 *
 * Chiamata dal frontend per sincronizzare fatture passive e corrispettivi
 * dall'Agenzia delle Entrate via mTLS.
 *
 * Endpoint: POST /.netlify/functions/sdi-sync
 * Body: { dateFrom?: string, dateTo?: string }
 * Auth: Bearer token (JWT Supabase)
 *
 * NOTA: Questa e' una Netlify Serverless Function (Node.js), NON Edge Function.
 */

import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import {
  createMtlsAgent,
  syncFatture,
  syncCorrispettivi,
  getDefaultDateFrom,
  getToday,
  COMPANY_ID,
} from "./lib/sdi-sync-core";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const handler: Handler = async (event: HandlerEvent, _context: HandlerContext) => {
  // Solo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // CORS headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // Auth — verifica JWT
  const authHeader = event.headers["authorization"] || event.headers["Authorization"] || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Missing authorization token" }),
    };
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("[sdi-sync] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Server configuration error" }),
    };
  }

  // Verifica utente via Supabase
  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Invalid or expired token" }),
    };
  }

  // Parametri dal body
  let dateFrom: string;
  let dateTo: string;

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    dateFrom = body.dateFrom || getDefaultDateFrom(30);
    dateTo = body.dateTo || getToday();
  } catch {
    dateFrom = getDefaultDateFrom(30);
    dateTo = getToday();
  }

  console.log(`[sdi-sync] Manual sync: ${dateFrom} → ${dateTo} (user: ${user.email})`);

  const startTime = Date.now();

  try {
    // Crea agente mTLS con certificati da env vars
    const agent = createMtlsAgent();

    // Sync fatture passive
    const fattureResult = await syncFatture(agent, supabaseAdmin, dateFrom, dateTo);

    // Sync corrispettivi telematici
    const corrispettiviResult = await syncCorrispettivi(agent, supabaseAdmin, dateFrom, dateTo);

    const durationMs = Date.now() - startTime;
    const allErrors = [...fattureResult.errors, ...corrispettiviResult.errors];

    // Log in sdi_sync_log
    await logSyncResult(supabaseAdmin, {
      trigger: "manual",
      triggeredBy: user.email || user.id,
      dateFrom,
      dateTo,
      fattureCount: fattureResult.count,
      corrispettiviCount: corrispettiviResult.count,
      errors: allErrors,
      durationMs,
    });

    console.log(
      `[sdi-sync] Done: ${fattureResult.count} fatture, ${corrispettiviResult.count} corrispettivi, ${allErrors.length} errors, ${durationMs}ms`
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        fatture: fattureResult.count,
        corrispettivi: corrispettiviResult.count,
        errors: allErrors,
        dateFrom,
        dateTo,
        durationMs,
      }),
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err.message || "Unknown error";
    console.error(`[sdi-sync] Fatal error:`, errorMsg);

    // Log errore fatale
    await logSyncResult(supabaseAdmin, {
      trigger: "manual",
      triggeredBy: user.email || user.id,
      dateFrom,
      dateTo,
      fattureCount: 0,
      corrispettiviCount: 0,
      errors: [`FATAL: ${errorMsg}`],
      durationMs,
    });

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: errorMsg,
        fatture: 0,
        corrispettivi: 0,
      }),
    };
  }
};

// ═══════════════════════════════════════════════════════════
// Log sync result in sdi_sync_log
// ═══════════════════════════════════════════════════════════

async function logSyncResult(
  supabase: ReturnType<typeof createClient>,
  data: {
    trigger: string;
    triggeredBy: string;
    dateFrom: string;
    dateTo: string;
    fattureCount: number;
    corrispettiviCount: number;
    errors: string[];
    durationMs: number;
  }
) {
  try {
    await supabase.from("sdi_sync_log").insert({
      company_id: COMPANY_ID,
      trigger: data.trigger,
      triggered_by: data.triggeredBy,
      date_from: data.dateFrom,
      date_to: data.dateTo,
      fatture_count: data.fattureCount,
      corrispettivi_count: data.corrispettiviCount,
      errors: data.errors.length > 0 ? data.errors : null,
      duration_ms: data.durationMs,
      status: data.errors.some((e) => e.startsWith("FATAL")) ? "error" : data.errors.length > 0 ? "partial" : "success",
    });
  } catch (logErr: any) {
    // Non fallire se il log non funziona
    console.error("[sdi-sync] Failed to log sync result:", logErr.message);
  }
}

export { handler };
