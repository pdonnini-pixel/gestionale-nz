// cash-closing-photo-import — importa una foto di chiusura in una chiusura di
// cassa esistente (bucket privato 'cash-closings' + riga in
// outlet_daily_closing_attachments), come se l'avesse scattata la cassiera.
// Serve ai caricamenti amministrativi (es. foto raccolte a mano prima che i
// negozi usino l'app). Non modifica importi né stato della chiusura.
//
// Autorizzazione: service key (Bearer) oppure segreto condiviso x-autofix-cron
// (stesso meccanismo di closing-photo-extract e ticket-resolve-now).
// Body POST: { closing_id: uuid, image_base64: string, mime_type?: string,
//              target?: 'totale'|'versamento'|'altro', extract?: boolean }
// Response:  { data: { attachment_id, storage_path, extraction? } }
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-autofix-cron",
};

function jsonError(status: number, message: string, code = "ERROR"): Response {
  return new Response(JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const KIND_FOR_TARGET: Record<string, string> = { totale: "rt_chiusura", versamento: "ricevuta_versamento", altro: "altro" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    let trusted = token.length > 0 && token === supabaseServiceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
    }
    if (!trusted) return jsonError(403, "Non autorizzato", "FORBIDDEN");

    const body = await req.json().catch(() => ({}));
    const closingId = String(body.closing_id ?? "");
    const b64 = String(body.image_base64 ?? "");
    const mime = String(body.mime_type ?? "image/jpeg");
    const target = String(body.target ?? "totale");
    if (!/^[0-9a-f-]{36}$/i.test(closingId)) return jsonError(400, "closing_id non valido", "BAD_REQUEST");
    if (b64.length < 100) return jsonError(400, "image_base64 mancante", "BAD_REQUEST");
    if (!(target in KIND_FOR_TARGET)) return jsonError(400, "target non valido", "BAD_REQUEST");
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return jsonError(400, "mime_type non supportato", "BAD_REQUEST");

    const { data: closing, error: cErr } = await admin.from("outlet_daily_closings")
      .select("id, company_id, outlet_id, closing_date").eq("id", closingId).maybeSingle();
    if (cErr || !closing) return jsonError(404, "Chiusura non trovata", "NOT_FOUND");

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const fileId = crypto.randomUUID();
    const path = `${closing.company_id}/${closing.outlet_id}/${closing.closing_date}/${fileId}.${ext}`;
    const { error: upErr } = await admin.storage.from("cash-closings").upload(path, bytes, { contentType: mime, upsert: false });
    if (upErr) return jsonError(500, `Upload non riuscito: ${upErr.message}`, "STORAGE_ERROR");

    const { data: att, error: aErr } = await admin.from("outlet_daily_closing_attachments").insert({
      closing_id: closing.id, company_id: closing.company_id, outlet_id: closing.outlet_id,
      kind: KIND_FOR_TARGET[target], target, storage_path: path, mime_type: mime, size_bytes: bytes.length,
    }).select("id").single();
    if (aErr || !att) {
      await admin.storage.from("cash-closings").remove([path]);
      return jsonError(500, `Allegato non registrato: ${aErr?.message ?? "?"}`, "DB_ERROR");
    }

    let extraction: unknown = null;
    if (body.extract === true) {
      const r = await fetch(`${supabaseUrl}/functions/v1/closing-photo-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${supabaseServiceKey}` },
        body: JSON.stringify({ attachment_id: att.id }),
      });
      extraction = await r.json().catch(() => ({ status: r.status }));
    }
    return new Response(JSON.stringify({ data: { attachment_id: att.id, storage_path: path, extraction } }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[cash-closing-photo-import] Error:", error);
    return jsonError(500, error instanceof Error ? error.message : String(error), "IMPORT_ERROR");
  }
});
