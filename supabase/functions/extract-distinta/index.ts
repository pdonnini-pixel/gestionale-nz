// Edge Function: extract-distinta
//
// Estrazione delle RIGHE di una DISTINTA di ricevute bancarie (RiBa) da un
// documento PDF. Il frontend estrae il TESTO del PDF (pdfjs, lato client) e lo
// invia qui; questa function chiede a Claude di restituire l'elenco delle righe
// (fornitore, numero fattura, IMPORTO, scadenza) come JSON.
//
// IMPORTANTISSIMO (regola Patrizio): questa function fa SOLO estrazione del
// testo. NON decide cosa chiudere: il riscontro AL CENTESIMO e la conferma
// avvengono lato DB (rpc_automatch_riba_distinta / rpc_confirm_riba_distinta),
// che confrontano gli importi esatti con le scadenze RiBa. Nulla si chiude "a
// fiducia" sulla base di questa estrazione.
//
// Sicurezza (come extract-scadenza / help-chat):
// - Chiave Anthropic nel Vault (RPC get_anthropic_api_key), mai nel frontend.
// - Auth: qualsiasi utente autenticato del tenant (JWT valido).
// - Sola LETTURA: non tocca il DB.
//
// Body POST: { "text": "…testo del PDF…" }
// Response:  { data: { declaredTotal: number|null, lines: [
//                { supplier, invoice, amount, dueDate }
//             ] } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TEXT_CHARS = 32000;

function jsonError(status: number, message: string, code = "EXTRACT_DISTINTA_ERROR") {
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

function buildSystemPrompt(): string {
  return `Sei un estrattore di dati da DISTINTE di ricevute bancarie (RiBa) / effetti / disposizioni italiane (es. "Distinta Di Ritiro Effetti Pagati" di banche come MPS). Ricevi il TESTO grezzo e devi estrarre l'ELENCO DELLE DISPOSIZIONI, una riga per ogni effetto.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido (nessun testo prima o dopo, niente markdown, niente \`\`\`). Schema:
{
  "declaredTotal": number|null,   // "Totale distinta" se indicato, punto decimale
  "lines": [
    {
      "supplier": string|null,    // ragione sociale/nominativo del CREDITORE (beneficiario) dell'effetto
      "vat": string|null,         // il valore dopo "cod.fiscale/P.iva creditore:" — P.IVA o CODICE FISCALE, solo cifre/lettere, senza spazi ne' "IT"
      "invoice": string|null,     // riferimento fattura/documento della riga, se presente (anche sporco: "FT 73", "Rif- 5.7 8.962", "DOC.N...")
      "amount": number|null,      // IMPORTO dell'effetto (colonna Importo) — punto decimale, niente separatore migliaia
      "dueDate": string|null      // scadenza (colonna Scad.) in formato YYYY-MM-DD, se presente
    }
  ]
}

REGOLE:
- Ogni disposizione ha: colonne Creaz./Scad./Stato/Importo e un blocco "Dati Beneficiario" col nome, "cod.fiscale/P.iva creditore: <valore>", "Domiciliataria: ..." e un riferimento. Estrai UNA riga per disposizione.
- Abbina con cura ogni IMPORTO al SUO beneficiario: nel testo grezzo importi e beneficiari possono comparire in blocchi separati, rispettane l'ORDINE (il 1° importo col 1° beneficiario, ecc.).
- Il campo piu' importante e' "amount": riportalo ESATTO. Formato italiano 1.234,56 => 1234.56. Mai arrotondare o inventare.
- "vat": prendi ESATTAMENTE il valore dopo "cod.fiscale/P.iva creditore:" (puo' essere una P.IVA di 11 cifre o un codice fiscale alfanumerico di 16). Niente spazi, niente "IT".
- Non includere righe di totale/subtotale tra le "lines": il totale va in "declaredTotal".
- Se un campo non c'e', mettilo a null. Non inventare.
- Rispondi SOLO col JSON.`;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    if (token !== supabaseServiceKey) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
    }

    const body = await req.json().catch(() => ({}));
    const rawText: string = (body.text ?? "").toString();
    const text = rawText.replace(/ /g, " ").trim().slice(0, MAX_TEXT_CHARS);
    if (text.length < 20) {
      return jsonError(400, "Testo della distinta assente o troppo corto per l'estrazione.", "NO_TEXT");
    }

    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: `TESTO DELLA DISTINTA:\n\n${text}` }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[extract-distinta] Anthropic API ${r.status}:`, errText);
      return jsonError(502, "Estrazione non disponibile al momento. Riprova o inserisci i dati a mano.", "ANTHROPIC_API_ERROR");
    }

    const apiData = await r.json();
    const raw: string = (apiData?.content ?? [])
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b?.text ?? "")
      .join("\n")
      .trim();

    const jsonStr = extractJson(raw);
    if (!jsonStr) return jsonError(502, "Non sono riuscito a leggere le righe della distinta.", "PARSE_ERROR");

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(jsonStr); }
    catch { return jsonError(502, "Risposta non interpretabile.", "PARSE_ERROR"); }

    const asStr = (v: unknown): string | null => {
      const s = (v == null ? "" : String(v)).trim();
      return s ? s : null;
    };
    const asNum = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const isISODate = (s: string | null): string | null =>
      s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

    const rawLines = Array.isArray((parsed as { lines?: unknown }).lines)
      ? (parsed as { lines: unknown[] }).lines : [];
    const lines = rawLines
      .map((it) => {
        const o = (it ?? {}) as { supplier?: unknown; vat?: unknown; invoice?: unknown; amount?: unknown; dueDate?: unknown };
        return {
          supplier: asStr(o.supplier),
          vat: (() => { const v = asStr(o.vat); return v ? v.replace(/[^0-9A-Za-z]/g, '').replace(/^IT/i, '') || null : null; })(),
          invoice: asStr(o.invoice),
          amount: asNum(o.amount),
          dueDate: isISODate(asStr(o.dueDate)),
        };
      })
      .filter((l) => l.amount != null); // una riga senza importo non e' utile al riscontro

    const data = {
      declaredTotal: asNum((parsed as { declaredTotal?: unknown }).declaredTotal),
      lines,
    };

    console.log(`[extract-distinta] righe=${lines.length} totale=${data.declaredTotal ?? "-"}`);
    return jsonOk({ data });
  } catch (error) {
    console.error(`[extract-distinta] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
