// Netlify Scheduled Function — SDI Sync (automatica ogni 6 ore)
//
// Sincronizza fatture passive e corrispettivi dall'Agenzia delle Entrate
// via mTLS. Eseguita automaticamente tramite cron Netlify.
//
// Schedule: ogni 6 ore (cron: 0 every-6h)
//
// NOTA: Questa e' una Netlify Serverless Function (Node.js) con schedule().

import { schedule } from "@netlify/functions";
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

const syncHandler = async () => {
  console.log("[sdi-sync-scheduled] Starting scheduled sync...");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("[sdi-sync-scheduled] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return { statusCode: 500 };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const dateFrom = getDefaultDateFrom(7); // ultimi 7 giorni per scheduled
  const dateTo = getToday();
  const startTime = Date.now();

  console.log(`[sdi-sync-scheduled] Period: ${dateFrom} → ${dateTo}`);

  try {
    const agent = createMtlsAgent();

    const fattureResult = await syncFatture(agent, supabaseAdmin, dateFrom, dateTo);
    const corrispettiviResult = await syncCorrispettivi(agent, supabaseAdmin, dateFrom, dateTo);

    const durationMs = Date.now() - startTime;
    const allErrors = [...fattureResult.errors, ...corrispettiviResult.errors];

    // Log risultato
    try {
      await supabaseAdmin.from("sdi_sync_log").insert({
        company_id: COMPANY_ID,
        trigger: "scheduled",
        triggered_by: "cron_6h",
        date_from: dateFrom,
        date_to: dateTo,
        fatture_count: fattureResult.count,
        corrispettivi_count: corrispettiviResult.count,
        errors: allErrors.length > 0 ? allErrors : null,
        duration_ms: durationMs,
        status: allErrors.some((e) => e.startsWith("FATAL"))
          ? "error"
          : allErrors.length > 0
          ? "partial"
          : "success",
      });
    } catch (logErr: any) {
      console.error("[sdi-sync-scheduled] Failed to log:", logErr.message);
    }

    console.log(
      `[sdi-sync-scheduled] Done: ${fattureResult.count} fatture, ${corrispettiviResult.count} corrispettivi, ${allErrors.length} errors, ${durationMs}ms`
    );

    return { statusCode: 200 };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[sdi-sync-scheduled] Fatal:`, err.message);

    try {
      await supabaseAdmin.from("sdi_sync_log").insert({
        company_id: COMPANY_ID,
        trigger: "scheduled",
        triggered_by: "cron_6h",
        date_from: dateFrom,
        date_to: dateTo,
        fatture_count: 0,
        corrispettivi_count: 0,
        errors: [`FATAL: ${err.message}`],
        duration_ms: durationMs,
        status: "error",
      });
    } catch (logErr: any) {
      console.error("[sdi-sync-scheduled] Failed to log error:", logErr.message);
    }

    return { statusCode: 500 };
  }
};

// Ogni 6 ore: 0 */6 * * *
export const handler = schedule("0 */6 * * *", syncHandler);
