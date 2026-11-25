// Edge Function: visura-leggi
//
// Legge una VISURA CAMERALE (Registro Imprese) caricata in Impostazioni →
// «Dati azienda» e restituisce i dati strutturati dell'impresa: ragione
// sociale, P.IVA, codice fiscale, REA, sede legale, PEC, capitale,
// costituzione, ATECO, amministratore, soci e unità locali.
//
// Perché il PDF intero: le visure arrivano anche come scansione stampata in PDF
// (caso reale: la visura di Zago del 22/04/2026, dieci pagine senza testo).
// Il testo estratto lato client, quando c'è, si manda insieme come aiuto.
//
// Sicurezza (vedi CLAUDE.md):
// - La chiave Anthropic sta nel Vault (RPC get_anthropic_api_key), mai nel
//   frontend: questa function fa da proxy (stesso schema di extract-scadenza).
// - Auth: profilo attivo e ruolo che può scrivere la scheda azienda
//   (super_advisor, contabile: gli stessi della policy company_settings_write).
// - Sola LETTURA: non tocca il database. Il confronto con i dati esistenti, il
//   blocco sulla P.IVA di un'altra società e la scrittura li fa il frontend
//   (src/lib/visura.ts), con la guardia del database (migration 460).
//
// Body POST: { "pdfBase64": "…", "text": "…" }  (almeno uno dei due)
// Response:  { data: VisuraLetta }  (schema in buildSystemPrompt)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { tokenDaRichiesta, verificaProfilo } from "../_shared/verificaProfilo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-haiku-4-5-20251001";
const RUOLI_SCHEDA_AZIENDA = ["super_advisor", "contabile"] as const;
const MAX_TEXT_CHARS = 60000;
// Una visura scansionata pesa sui 4-5 MB: fino a circa 4,6 MB di file.
const MAX_PDF_BASE64_CHARS = 6_300_000;
const MAX_BODY_BYTES = 8_500_000;

function pdfValido(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const b64 = v.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  if (b64.length < 100 || b64.length > MAX_PDF_BASE64_CHARS) return null;
  if (!b64.startsWith("JVBERi0")) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  return b64;
}

function jsonError(status: number, message: string, code = "VISURA_LEGGI_ERROR") {
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
  return `Sei un estrattore di dati da VISURE CAMERALI italiane (Registro Imprese, visura ordinaria o storica). Ricevi il documento in PDF (anche scansionato) e/o il suo testo. Estrai i dati dell'impresa.

Rispondi ESCLUSIVAMENTE con un oggetto JSON valido, senza testo prima o dopo e senza markdown. Schema:
{
  "eVisura": boolean,                 // true solo se il documento è davvero una visura camerale
  "dataEstrazione": string|null,      // "estratto dal Registro Imprese in data …", formato YYYY-MM-DD
  "ragioneSociale": string|null,      // es. "NEW ZAGO S.R.L."
  "partitaIva": string|null,          // 11 cifre, senza "IT" e senza spazi
  "codiceFiscale": string|null,       // codice fiscale dell'impresa
  "formaGiuridica": string|null,      // es. "società a responsabilità limitata"
  "rea": string|null,                 // REA della sede, formato "FI-698232" (sigla provincia, trattino, numero)
  "sedeLegale": { "indirizzo": string|null, "cap": string|null, "comune": string|null, "provincia": string|null },
  "pec": string|null,                 // domicilio digitale / PEC dell'impresa (NON quella dell'amministratore)
  "capitaleSottoscritto": number|null,
  "capitaleVersato": number|null,
  "dataCostituzione": string|null,    // data atto di costituzione, YYYY-MM-DD
  "ateco": { "codice": string|null, "descrizione": string|null },  // attività prevalente, classificazione ATECO più recente
  "amministratore": { "nome": string|null, "carica": string|null, "codiceFiscale": string|null },  // legale rappresentante in carica
  "soci": [ { "nome": string, "codiceFiscale": string|null, "quotaPct": number|null } ],
  "unitaLocali": [ {
      "numero": string|null,          // es. "FI/1", "AR/1"
      "tipo": string|null,            // es. "Negozio", "Magazzino", "Ufficio, Magazzino"
      "insegna": string|null,
      "indirizzo": string|null,       // solo via e numero civico, es. "VIA MEUCCI 31"
      "cap": string|null,
      "comune": string|null,          // es. "BARBERINO DI MUGELLO"
      "provincia": string|null,       // sigla, es. "FI"
      "rea": string|null,             // REA dell'unità locale se indicato, formato "AR-220128"
      "dataApertura": string|null     // YYYY-MM-DD
  } ]
}

REGOLE:
- Copia i valori come sono scritti nella visura, senza correggerli né completarli. Non inventare: un dato assente è null (o [] per le liste).
- Le unità locali sono quelle della sezione «Sedi secondarie ed unità locali» ancora presenti (non quelle cessate). Riportale tutte.
- La provincia è sempre la sigla di due lettere. Le date sempre YYYY-MM-DD. Gli importi con il punto decimale (10.000,00 = 10000).
- La quota dei soci in percentuale (55 % = 55).
- Rispondi SOLO col JSON.`;
}

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

const asStr = (v: unknown): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s ? s : null;
};
const asNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s€%]/g, "");
  // «10.000,00» (italiano) oppure «10000.00»: la virgola decide.
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
const isoDate = (v: unknown): string | null => {
  const s = asStr(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const soloCifre = (v: unknown): string | null => {
  const s = asStr(v);
  if (!s) return null;
  const c = s.replace(/^IT/i, "").replace(/[^0-9]/g, "");
  return c || null;
};
const cfPulito = (v: unknown): string | null => {
  const s = asStr(v);
  if (!s) return null;
  const c = s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return c || null;
};
const sigla = (v: unknown): string | null => {
  const s = asStr(v);
  if (!s) return null;
  const c = s.replace(/[^A-Za-z]/g, "").toUpperCase();
  return c.length === 2 ? c : null;
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

function normalizza(p: Record<string, unknown>) {
  const sede = obj(p.sedeLegale);
  const ateco = obj(p.ateco);
  const amm = obj(p.amministratore);
  const soci = Array.isArray(p.soci) ? p.soci : [];
  const ul = Array.isArray(p.unitaLocali) ? p.unitaLocali : [];
  return {
    eVisura: p.eVisura === true,
    dataEstrazione: isoDate(p.dataEstrazione),
    ragioneSociale: asStr(p.ragioneSociale),
    partitaIva: soloCifre(p.partitaIva),
    codiceFiscale: cfPulito(p.codiceFiscale),
    formaGiuridica: asStr(p.formaGiuridica),
    rea: asStr(p.rea),
    sedeLegale: {
      indirizzo: asStr(sede.indirizzo),
      cap: asStr(sede.cap),
      comune: asStr(sede.comune),
      provincia: sigla(sede.provincia),
    },
    pec: asStr(p.pec)?.toLowerCase() ?? null,
    capitaleSottoscritto: asNum(p.capitaleSottoscritto),
    capitaleVersato: asNum(p.capitaleVersato),
    dataCostituzione: isoDate(p.dataCostituzione),
    ateco: { codice: asStr(ateco.codice), descrizione: asStr(ateco.descrizione) },
    amministratore: { nome: asStr(amm.nome), carica: asStr(amm.carica), codiceFiscale: cfPulito(amm.codiceFiscale) },
    soci: soci.map((s) => obj(s)).map((s) => ({
      nome: asStr(s.nome),
      codiceFiscale: cfPulito(s.codiceFiscale),
      quotaPct: asNum(s.quotaPct),
    })).filter((s) => !!s.nome),
    unitaLocali: ul.map((u) => obj(u)).map((u) => ({
      numero: asStr(u.numero),
      tipo: asStr(u.tipo),
      insegna: asStr(u.insegna),
      indirizzo: asStr(u.indirizzo),
      cap: asStr(u.cap),
      comune: asStr(u.comune),
      provincia: sigla(u.provincia),
      rea: asStr(u.rea),
      dataApertura: isoDate(u.dataApertura),
    })).filter((u) => !!u.comune),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const chiamante = await verificaProfilo(supabase, tokenDaRichiesta(req), supabaseServiceKey, {
      ruoli: RUOLI_SCHEDA_AZIENDA,
      ammettiServiceRole: false,
    });
    if (!chiamante.ok) return jsonError(chiamante.status, chiamante.message, chiamante.code);

    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return jsonError(413, "La visura è troppo grande (oltre 4,5 MB).", "TOO_LARGE");
    }
    const body = await req.json().catch(() => ({}));
    const text = String(body.text ?? "").replace(/\u0000/g, " ").trim().slice(0, MAX_TEXT_CHARS);
    const pdf = pdfValido(body.pdfBase64);
    const haTesto = text.length >= 200;
    if (!pdf && !haTesto) {
      return jsonError(400, "Visura assente, troppo grande o senza testo leggibile.", "NO_TEXT");
    }

    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");
    const chiama = (conPdf: boolean) => {
      const content: unknown[] = [];
      if (conPdf && pdf) {
        content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } });
      }
      content.push({
        type: "text",
        text: haTesto
          ? `${conPdf ? "TESTO ESTRATTO DAL PDF (può essere incompleto: fa fede il documento)" : "TESTO DELLA VISURA"}:\n\n${text}`
          : "Estrai i dati dalla visura allegata.",
      });
      return fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: buildSystemPrompt(),
          messages: [{ role: "user", content }],
        }),
      });
    };

    let letturaDa: "pdf" | "testo" = pdf ? "pdf" : "testo";
    let r = await chiama(!!pdf);
    const pdfRifiutato = !r.ok && !!pdf && (r.status === 400 || r.status === 413);
    if (pdfRifiutato && !haTesto) {
      console.error(`[visura-leggi] Anthropic API ${r.status} col PDF, nessun testo di ripiego:`, (await r.text()).slice(0, 300));
      return jsonError(422, "Non riesco a leggere questa visura (file non valido o troppe pagine).", "PDF_NOT_READABLE");
    }
    if (pdfRifiutato) {
      console.error(`[visura-leggi] Anthropic API ${r.status} col PDF, riprovo col testo:`, (await r.text()).slice(0, 300));
      letturaDa = "testo";
      r = await chiama(false);
    }
    if (!r.ok) {
      console.error(`[visura-leggi] Anthropic API ${r.status}:`, (await r.text()).slice(0, 500));
      return jsonError(502, "Lettura della visura non disponibile al momento. Riprova tra poco.", "ANTHROPIC_API_ERROR");
    }

    const apiData = await r.json();
    const raw: string = (apiData?.content ?? [])
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b?.text ?? "")
      .join("\n")
      .trim();
    const jsonStr = extractJson(raw);
    if (!jsonStr) {
      console.error(`[visura-leggi] Nessun JSON nella risposta (${raw.length} caratteri, da=${letturaDa})`);
      return jsonError(502, "Non sono riuscito a leggere i dati della visura.", "PARSE_ERROR");
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return jsonError(502, "Risposta non interpretabile.", "PARSE_ERROR");
    }

    const data = { ...normalizza(parsed), letturaDa };
    if (!data.eVisura) {
      return jsonError(422, "Il documento non sembra una visura camerale.", "NOT_A_VISURA");
    }
    // Nel log nessun dato personale: solo cosa è stato trovato.
    console.log(`[visura-leggi] piva=${data.partitaIva ? "si" : "no"} ul=${data.unitaLocali.length} soci=${data.soci.length} da=${letturaDa}`);
    return jsonOk({ data });
  } catch (error) {
    console.error(`[visura-leggi] Error:`, error);
    return jsonError(500, "Lettura della visura non riuscita. Riprova tra poco.");
  }
});
