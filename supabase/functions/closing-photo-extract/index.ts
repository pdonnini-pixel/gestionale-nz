// Edge Function: closing-photo-extract
//
// Fase 1b della chiusura di cassa: legge UNA foto allegata a una chiusura
// (scontrino di chiusura del registratore telematico, chiusura POS, scontrino
// di una spesa, ricevuta di versamento) con Claude vision e salva i dati letti
// in outlet_daily_closing_attachments.extracted, con uno stato di lettura.
//
// IMPORTANTE (stessa regola di extract-distinta): questa function fa SOLO
// lettura. Non scrive importi nella chiusura: il frontend propone i valori
// letti alla cassiera ("dalla foto: …") e la quadratura resta quella del DB.
//
// Sicurezza:
// - Chiave Anthropic nel Vault (RPC get_anthropic_api_key), mai nel frontend.
// - Auth: JWT valido di un utente che VEDE l'allegato (verificato con un
//   client a nome dell'utente, quindi con la RLS), oppure service key,
//   oppure segreto condiviso x-autofix-cron (riletture lanciate dal DB).
// - L'immagine si scarica dal bucket privato 'cash-closings' con la service
//   key, e non esce mai dalla function se non verso Anthropic.
//
// Body POST: { "attachment_id": "<uuid>" }
// Response:  { data: { attachment_id, status, extracted } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Modelli in ordine di preferenza: se il primo non e' disponibile per la
// chiave del tenant (404 not_found) si passa al successivo.
const MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"];
const BUCKET = "cash-closings";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type Target = "totale" | "canale" | "spesa" | "versamento" | "altro";

function jsonError(status: number, message: string, code = "CLOSING_PHOTO_EXTRACT_ERROR") {
  return new Response(
    JSON.stringify({ error: message, code, timestamp: new Date().toISOString() }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
function jsonOk(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getSecret(supabase: SupabaseClient, rpcName: string, key: string): Promise<string> {
  const { data, error } = await supabase.rpc(rpcName);
  if (error || !data || !data[0] || !data[0][key]) {
    throw new Error(`${rpcName} failed: ${error?.message ?? "no value"}`);
  }
  return data[0][key] as string;
}

// ─── Prompt per tipo di foto ───────────────────────────────────────────
const COMMON_RULES = `Rispondi ESCLUSIVAMENTE con un oggetto JSON valido (nessun testo prima o dopo, niente markdown, niente \`\`\`).
REGOLE:
- Gli importi sono in euro con punto decimale (1.234,56 → 1234.56), MAI arrotondati o inventati. Se un numero non si legge con certezza, mettilo a null e spiega in "notes".
- Le date in formato YYYY-MM-DD, gli orari HH:MM. Se mancano, null.
- "uncertain": true se la foto e' sfocata, tagliata, o se hai dovuto tirare a indovinare anche un solo importo.
- "document_ok": true se la foto e' davvero il documento atteso, false se e' un'altra cosa (spiega in "notes").
- Non aggiungere chiavi diverse da quelle dello schema.`;

function promptFor(target: Target, kind: string): string {
  switch (target) {
    case "totale":
      return `Sei un lettore di SCONTRINI DI CHIUSURA GIORNALIERA di registratori telematici italiani (RT: Epson, Custom, Olivetti, Ditron, RCH…). Il documento tipico riporta: "CHIUSURA GIORNALIERA" o "RAPPORTO FINANZIARIO" o "TRASMISSIONE TELEMATICA", data e ora, matricola/RT, "TOTALE GIORNALIERO"/"TOTALE VENDITE"/"CORRISPETTIVI", i totali per forma di pagamento ("CONTANTI", "PAGAMENTO ELETTRONICO", "TICKET", "NON RISCOSSO"), numero documenti commerciali, resi/annullamenti, "GRAN TOTALE" progressivo, "NUMERO AZZERAMENTI"/"N. CHIUSURA", righe IVA (aliquota, imponibile, imposta), ed eventuale esito trasmissione ("TRASMISSIONE EFFETTUATA", "ESITO OK").
Schema:
{
  "document_type": "chiusura_rt"|"rapporto_finanziario"|"trasmissione"|"altro",
  "document_ok": boolean,
  "date": string|null,
  "time": string|null,
  "serial": string|null,            // matricola del registratore
  "total_sales": number|null,       // TOTALE GIORNALIERO / totale vendite / corrispettivi del giorno (il numero chiave)
  "cash": number|null,              // pagato in contanti
  "electronic": number|null,        // pagamento elettronico (carte)
  "other_payments": number|null,    // ticket, non riscosso, altro
  "documents_count": number|null,   // numero documenti commerciali/scontrini emessi
  "returns_total": number|null,     // resi
  "cancellations_total": number|null, // annulli
  "grand_total": number|null,       // GRAN TOTALE progressivo
  "closure_number": number|null,    // numero azzeramenti / numero chiusura
  "vat_lines": [ { "rate": number|null, "taxable": number|null, "tax": number|null } ],
  "transmission_ok": boolean|null,  // esito trasmissione se presente, altrimenti null
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`;
    case "canale":
      return kind === "pos_chiusura"
        ? `Sei un lettore di SCONTRINI DI CHIUSURA POS (terminali bancari italiani: Nexi, MPS, BCC, Ingenico, Verifone, SumUp, American Express). Riportano tipicamente: "CHIUSURA", "TOTALI", data/ora, "TERMINALE"/"TID"/"POS ID", codice esercente, numero transazioni (spesso divise per circuito: Visa, Mastercard, PagoBancomat, Amex), e il TOTALE incassato.
Schema:
{
  "document_ok": boolean,
  "date": string|null,
  "time": string|null,
  "terminal_id": string|null,       // TID / identificativo terminale, come scritto
  "merchant": string|null,          // esercente / codice esercente
  "transactions_count": number|null,
  "total": number|null,             // TOTALE incassato dal POS (il numero chiave)
  "by_circuit": [ { "circuit": string, "count": number|null, "amount": number|null } ],
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`
        : `Sei un lettore di documenti di incasso di un negozio (ricevute, distinte, conferme di pagamento). Estrai cio' che giustifica l'importo incassato.
Schema:
{
  "document_ok": boolean,
  "date": string|null,
  "description": string|null,
  "total": number|null,             // importo incassato (il numero chiave)
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`;
    case "spesa":
      return `Sei un lettore di SCONTRINI e RICEVUTE di piccole spese pagate in contanti da un negozio (cancelleria, pulizie, bar, corriere, ferramenta…).
Schema:
{
  "document_ok": boolean,
  "merchant": string|null,          // esercente / negozio dove e' stata fatta la spesa
  "date": string|null,
  "time": string|null,
  "description": string|null,       // cosa e' stato comprato, in 3-6 parole
  "total": number|null,             // TOTALE pagato (il numero chiave)
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`;
    case "versamento":
      return `Sei un lettore di RICEVUTE DI VERSAMENTO CONTANTI in banca (sportello ATM evoluto/cassa continua o cassa: MPS, BCC, Intesa, Unicredit…) fatte da un negozio.
Schema:
{
  "document_ok": boolean,
  "bank": string|null,
  "date": string|null,
  "time": string|null,
  "account_hint": string|null,      // ultime cifre del conto/IBAN o riferimento se visibili
  "amount": number|null,            // IMPORTO versato (il numero chiave)
  "reference": string|null,         // numero operazione / ricevuta
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`;
    default:
      return `Descrivi brevemente questo documento allegato a una chiusura di cassa di un negozio.
Schema:
{
  "document_ok": boolean,
  "description": string|null,
  "date": string|null,
  "total": number|null,
  "uncertain": boolean,
  "notes": string|null
}
${COMMON_RULES}`;
  }
}

/** Valore chiave della riga (quello che il frontend confronta col campo). */
function keyAmount(target: Target, o: Record<string, unknown>): number | null {
  const asNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  };
  switch (target) {
    case "totale": return asNum(o.total_sales);
    case "versamento": return asNum(o.amount);
    default: return asNum(o.total);
  }
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
    }
  }
  return null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Sanifica la risposta: solo tipi semplici, numeri veri, niente chiavi extra pericolose. */
function sanitize(v: unknown, depth = 0): unknown {
  if (depth > 3) return null;
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().slice(0, 500) || null;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => sanitize(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) {
      if (/^[a-z_]{1,40}$/.test(k)) out[k] = sanitize(val, depth + 1);
    }
    return out;
  }
  return null;
}

async function callAnthropic(apiKey: string, system: string, imageB64: string, mediaType: string): Promise<{ text: string; model: string }> {
  let lastErr = "";
  for (const model of MODELS) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        system,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imageB64 } },
            { type: "text", text: "Leggi questo documento e rispondi con il JSON dello schema." },
          ],
        }],
      }),
    });
    if (r.ok) {
      const apiData = await r.json();
      const text: string = (apiData?.content ?? [])
        .filter((b: { type?: string }) => b?.type === "text")
        .map((b: { text?: string }) => b?.text ?? "")
        .join("\n").trim();
      return { text, model };
    }
    lastErr = `${r.status} ${await r.text()}`;
    console.error(`[closing-photo-extract] Anthropic ${model}:`, lastErr);
    // Modello non disponibile per questa chiave: prova il successivo. Altri errori: stop.
    if (r.status !== 404 && r.status !== 400) break;
  }
  throw new Error(`Anthropic API error: ${lastErr}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");

    const body = await req.json().catch(() => ({}));
    const attachmentId: string = String(body.attachment_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) return jsonError(400, "attachment_id mancante o non valido", "BAD_REQUEST");

    // Autorizzazione: con il JWT dell'utente si legge l'allegato attraverso la
    // RLS; se non lo vede, non puo' farlo leggere. La service key salta il
    // check, come il segreto condiviso 'autofix_cron_secret' nell'header
    // x-autofix-cron (stesso meccanismo di ticket-resolve-now, migration 156):
    // serve alle riletture lanciate dal DB (pg_cron / verifiche serali).
    let trusted = token === supabaseServiceKey;
    const cronHeader = req.headers.get("x-autofix-cron") ?? "";
    if (!trusted && cronHeader) {
      const { data: cronSecret } = await admin.rpc("get_autofix_cron_secret");
      const expected = Array.isArray(cronSecret) ? String((cronSecret[0] as { secret?: string } | undefined)?.secret ?? "") : "";
      trusted = expected.length > 0 && cronHeader === expected;
      if (!trusted) return jsonError(403, "Segreto x-autofix-cron non valido", "FORBIDDEN");
    }
    if (!trusted) {
      const asUser = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: visible, error: visErr } = await asUser
        .from("outlet_daily_closing_attachments").select("id").eq("id", attachmentId).maybeSingle();
      if (visErr || !visible) return jsonError(403, "Allegato non trovato o non accessibile", "FORBIDDEN");
    }

    const { data: att, error: attErr } = await admin
      .from("outlet_daily_closing_attachments")
      .select("id, closing_id, target, kind, storage_path, mime_type, extraction_status")
      .eq("id", attachmentId).maybeSingle();
    if (attErr || !att) return jsonError(404, "Allegato non trovato", "NOT_FOUND");

    const target = (att.target ?? "altro") as Target;
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(att.storage_path);
    if (dlErr || !blob) {
      await admin.from("outlet_daily_closing_attachments").update({ extraction_status: "fallita", extracted: { error: "download" }, extracted_at: new Date().toISOString() }).eq("id", att.id);
      return jsonError(500, "Immagine non scaricabile", "DOWNLOAD_ERROR");
    }
    if (blob.size > MAX_IMAGE_BYTES) return jsonError(413, "Immagine troppo grande", "TOO_LARGE");
    const mediaType = (blob.type || att.mime_type || "image/jpeg").split(";")[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(mediaType)) return jsonError(415, `Formato non supportato: ${mediaType}`, "UNSUPPORTED");
    const imageB64 = toBase64(await blob.arrayBuffer());

    const anthropicKey = await getSecret(admin, "get_anthropic_api_key", "api_key");
    const system = promptFor(target, att.kind ?? "altro");

    let status: "letta" | "da_rivedere" | "fallita" = "fallita";
    let extracted: Record<string, unknown> = {};
    let model: string | null = null;
    try {
      const res = await callAnthropic(anthropicKey, system, imageB64, mediaType);
      model = res.model;
      const jsonStr = extractJson(res.text);
      const parsed = jsonStr ? (JSON.parse(jsonStr) as Record<string, unknown>) : null;
      if (parsed && typeof parsed === "object") {
        extracted = (sanitize(parsed) as Record<string, unknown>) ?? {};
        const amount = keyAmount(target, extracted);
        extracted.amount = amount;
        const docOk = extracted.document_ok !== false;
        const uncertain = extracted.uncertain === true;
        status = amount != null && docOk && !uncertain ? "letta" : "da_rivedere";
      } else {
        extracted = { error: "parse", raw: res.text.slice(0, 500) };
        status = "fallita";
      }
    } catch (e) {
      console.error(`[closing-photo-extract] lettura fallita per ${att.id}:`, e);
      extracted = { error: "api", message: String((e as Error).message).slice(0, 300) };
      status = "fallita";
    }

    const { error: updErr } = await admin.from("outlet_daily_closing_attachments").update({
      extraction_status: status,
      extracted,
      extraction_model: model,
      extracted_at: new Date().toISOString(),
    }).eq("id", att.id);
    if (updErr) console.error(`[closing-photo-extract] update fallito:`, updErr);

    console.log(`[closing-photo-extract] att=${att.id} target=${target} status=${status} amount=${extracted.amount ?? "-"} model=${model ?? "-"}`);
    return jsonOk({ data: { attachment_id: att.id, status, extracted, model } });
  } catch (error) {
    console.error(`[closing-photo-extract] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
