// Edge Function: extract-scadenza
//
// Estrazione automatica dei dati di una SCADENZA da un documento PDF caricato
// nel modale "Aggiungi scadenza" dello Scadenzario. Il frontend estrae il TESTO
// del PDF (pdfjs, lato client) e lo invia qui; questa function chiede a Claude di
// restituire i campi strutturati (fornitore, P.IVA, numero/data documento,
// importo da pagare, metodo, IBAN, scadenze) come JSON, che pre-compila il form.
//
// Caratteristiche di sicurezza (vedi CLAUDE.md):
// - La chiave Anthropic sta nel Vault (RPC get_anthropic_api_key), MAI nel
//   frontend. Questa function fa da proxy (stesso pattern di help-chat).
// - Auth: JWT valido E profilo attivo in user_profiles, ruolo amministrativo
//   o budget_approver (_shared/verificaProfilo.ts); senza profilo 403, dal 05/11/2026.
// - Sola LETTURA: non tocca il DB, non propone modifiche/cancellazioni (NO DATA LOSS).
//   Restituisce solo dati da mostrare nel form; l'operatrice conferma e corregge.
//
// Body POST:
//   { "text": "…testo del PDF estratto lato client…" }
// Response:
//   { data: {
//       supplierName, supplierVat, invoiceNumber, invoiceDate, grossAmount,
//       paymentMethod, iban, isCreditNote, documentType, confidence,
//       installments: [{ dueDate, amount }]
//   } }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { RUOLI_ESTRAZIONE, tokenDaRichiesta, verificaProfilo } from "../_shared/verificaProfilo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-haiku-4-5-20251001";
// Limite di caratteri del testo PDF passato al modello (anti-abuso token). Le
// prime ~24k battute contengono sempre la testata del documento (fornitore,
// numero, data, importi, scadenze); il corpo dettagliato oltre non serve.
const MAX_TEXT_CHARS = 24000;

// Metodi di pagamento ammessi dal form (allineati a paymentMethodLabels in
// src/pages/scadenzario/helpers.ts). Il modello DEVE restituire uno di questi
// valori esatti (o null): un valore fuori lista viene scartato lato client.
const PAYMENT_METHODS = [
  "bonifico_ordinario", "bonifico_urgente", "bonifico_sepa", "bonifico",
  "riba_30", "riba_60", "riba_90", "riba_120", "riba",
  "rid", "sdd_core", "sdd_b2b", "rimessa_diretta",
  "carta_credito", "carta_debito", "carta", "assegno", "contanti",
  "compensazione", "f24", "mav", "rav", "bollettino_postale", "altro",
];

function jsonError(status: number, message: string, code = "EXTRACT_SCADENZA_ERROR") {
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

// Legge un secret dal Vault via RPC (stesso helper di help-chat / ticket-resolve-now).
async function getSecret(supabase: SupabaseClient, rpcName: string, key: string): Promise<string> {
  const { data, error } = await supabase.rpc(rpcName);
  if (error || !data || !data[0] || !data[0][key]) {
    throw new Error(`${rpcName} failed: ${error?.message ?? "no value"}`);
  }
  return data[0][key] as string;
}

function buildSystemPrompt(todayISO: string): string {
  return `Sei un estrattore di dati da documenti amministrativi italiani (fatture, proforma, note/progetti di notula, parcelle, note di credito, avvisi di pagamento). Ricevi il TESTO grezzo di un documento e devi estrarre i campi che servono a creare una SCADENZA di pagamento nel gestionale.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido (nessun testo prima o dopo, niente markdown, niente \`\`\`). Schema:
{
  "supplierName": string|null,     // ragione sociale di CHI EMETTE il documento (il fornitore/creditore), NON il cliente/destinatario
  "supplierVat": string|null,      // P.IVA (o codice fiscale se manca la P.IVA) del fornitore: SOLO le cifre/lettere, senza spazi o "IT"
  "invoiceNumber": string|null,    // numero del documento (fattura/proforma/notula)
  "invoiceDate": string|null,      // data del documento in formato YYYY-MM-DD
  "grossAmount": number|null,      // IMPORTO DA PAGARE: se il documento indica un "netto a pagare"/"totale a pagare" usa QUELLO; altrimenti il totale documento (lordo). Punto decimale, niente separatore migliaia.
  "paymentMethod": string|null,    // uno tra: ${PAYMENT_METHODS.join(", ")}. Scegli il più coerente col documento; se non chiaro usa null.
  "iban": string|null,             // IBAN del beneficiario, se presente (senza spazi)
  "isCreditNote": boolean,         // true se è una NOTA DI CREDITO (importo a favore del cliente)
  "documentType": string|null,     // es. "fattura", "proforma", "notula", "parcella", "nota di credito"
  "confidence": number,            // 0..1: quanto sei sicuro dell'estrazione complessiva
  "installments": [                // scadenze di pagamento. Se il documento le indica esplicitamente, riportale.
    { "dueDate": string, "amount": number }   // dueDate YYYY-MM-DD
  ]
}

REGOLE:
- Il FORNITORE è chi EMETTE il documento (intestazione/mittente, in alto), NON il cliente destinatario ("Spett.le", "Cliente", "Destinatario"). NEW ZAGO SRL, MADE, ZAGO sono l'azienda destinataria: non vanno MAI messe come supplierName.
- Le condizioni tipo "Bon. bancario 30 gg data fattura" indicano il metodo (bonifico) e i giorni di scadenza. Se non c'è una data di scadenza esplicita ma ci sono i giorni, CALCOLA la scadenza a partire dalla data documento (oggi è ${todayISO}). Somma dei giorni sulla data documento.
- Se ci sono più rate, elenca ogni rata in "installments" con la sua data e importo; la somma delle rate deve coincidere con grossAmount. Se non riesci a determinare le scadenze, lascia "installments" vuoto ([]).
- Per le NOTE DI CREDITO metti isCreditNote=true e grossAmount come valore POSITIVO (il segno lo gestisce il gestionale).
- Importi: interpreta il formato italiano (1.234,56 = 1234.56). Non inventare valori: se un campo non è nel documento, metti null (o [] per installments).
- Rispondi SOLO col JSON.`;
}

// Estrae il primo oggetto JSON bilanciato dalla risposta del modello (robusto a
// eventuali fence o testo accidentale attorno).
function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, "Method not allowed");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: profilo attivo, ruolo amministrativo o budget_approver (vedi _shared/verificaProfilo.ts).
    const chiamante = await verificaProfilo(supabase, tokenDaRichiesta(req), supabaseServiceKey, { ruoli: RUOLI_ESTRAZIONE });
    if (!chiamante.ok) return jsonError(chiamante.status, chiamante.message, chiamante.code);

    const body = await req.json().catch(() => ({}));
    const rawText: string = (body.text ?? "").toString();
    const text = rawText.replace(/\u0000/g, " ").trim().slice(0, MAX_TEXT_CHARS);
    if (text.length < 20) {
      return jsonError(400, "Testo del documento assente o troppo corto per l'estrazione.", "NO_TEXT");
    }

    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");
    const todayISO = new Date().toISOString().slice(0, 10);
    const systemPrompt = buildSystemPrompt(todayISO);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: `TESTO DEL DOCUMENTO:\n\n${text}` }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[extract-scadenza] Anthropic API ${r.status}:`, errText);
      return jsonError(502, "Estrazione non disponibile al momento. Riprova tra poco o inserisci i dati a mano.", "ANTHROPIC_API_ERROR");
    }

    const apiData = await r.json();
    const raw: string = (apiData?.content ?? [])
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b?.text ?? "")
      .join("\n")
      .trim();

    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      console.error("[extract-scadenza] No JSON in reply:", raw.slice(0, 500));
      return jsonError(502, "Non sono riuscito a leggere i dati dal documento. Inseriscili a mano.", "PARSE_ERROR");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return jsonError(502, "Risposta non interpretabile. Inserisci i dati a mano.", "PARSE_ERROR");
    }

    // Normalizzazione difensiva dei campi prima di restituirli al frontend.
    const asStr = (v: unknown): string | null => {
      const s = (v == null ? "" : String(v)).trim();
      return s ? s : null;
    };
    const asNum = (v: unknown): number | null => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const isISODate = (s: string | null): string | null =>
      s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;

    const pm = asStr((parsed as { paymentMethod?: unknown }).paymentMethod);
    const rawInstallments = Array.isArray((parsed as { installments?: unknown }).installments)
      ? (parsed as { installments: unknown[] }).installments
      : [];
    const installments = rawInstallments
      .map((it) => {
        const o = (it ?? {}) as { dueDate?: unknown; amount?: unknown };
        return { dueDate: isISODate(asStr(o.dueDate)), amount: asNum(o.amount) };
      })
      .filter((it): it is { dueDate: string; amount: number } => !!it.dueDate && it.amount != null);

    const data = {
      supplierName: asStr((parsed as { supplierName?: unknown }).supplierName),
      // P.IVA/CF: tieni solo caratteri alfanumerici (via "IT", spazi, punti).
      supplierVat: (() => {
        const v = asStr((parsed as { supplierVat?: unknown }).supplierVat);
        if (!v) return null;
        const cleaned = v.replace(/[^0-9A-Za-z]/g, "").replace(/^IT/i, "");
        return cleaned || null;
      })(),
      invoiceNumber: asStr((parsed as { invoiceNumber?: unknown }).invoiceNumber),
      invoiceDate: isISODate(asStr((parsed as { invoiceDate?: unknown }).invoiceDate)),
      grossAmount: (() => { const n = asNum((parsed as { grossAmount?: unknown }).grossAmount); return n == null ? null : Math.abs(n); })(),
      paymentMethod: pm && PAYMENT_METHODS.includes(pm) ? pm : null,
      iban: (() => {
        const v = asStr((parsed as { iban?: unknown }).iban);
        return v ? v.replace(/\s/g, "").toUpperCase() : null;
      })(),
      isCreditNote: Boolean((parsed as { isCreditNote?: unknown }).isCreditNote),
      documentType: asStr((parsed as { documentType?: unknown }).documentType),
      confidence: (() => { const n = asNum((parsed as { confidence?: unknown }).confidence); return n == null ? null : Math.max(0, Math.min(1, n)); })(),
      installments,
    };

    console.log(`[extract-scadenza] supplier="${data.supplierName ?? "-"}" amount=${data.grossAmount ?? "-"} rate=${installments.length} conf=${data.confidence ?? "-"}`);
    return jsonOk({ data });
  } catch (error) {
    console.error(`[extract-scadenza] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
