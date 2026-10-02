// Edge Function: bank-doc-chat
//
// La chat di Documenti banca (R28 in RICONCILIAZIONE_REGOLE.md). Quando dopo un
// caricamento qualcosa non torna, il database apre una domanda
// (bank_document_questions). Sabrina risponde a parole sue; questa function
// capisce cosa ha detto, sceglie UNA azione da una lista chiusa, la applica con
// traccia e risponde in una riga.
//
// Sicurezza (CLAUDE.md):
// - chiave Anthropic nel Vault (RPC get_anthropic_api_key), mai nel frontend;
// - solo utenti super_advisor / cfo / contabile, solo domande della propria azienda;
// - le azioni possibili sono poche e nessuna cancella o sposta dati: un doppione
//   o un conto sbagliato vengono annotati e lasciati alla conferma di Patrizio
//   (regola granitica no data loss). La risposta di una persona vale come
//   decisione di livello 2 (R27): un documento della banca arrivato dopo la
//   sovrascrive.
//
// Body POST: { "question_id": "uuid", "text": "risposta di Sabrina" }
// Response:  { reply: string, action: string, status: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-opus-5-5";
const MAX_CHARS = 1500;
const RUOLI = ["super_advisor", "cfo", "contabile"];

type Azione = "conferma" | "doppione" | "conto_sbagliato" | "non_so" | "chiarimento" | "informazione";
type Decisione = { azione: Azione; nota: string; risposta: string };

// Lo schema obbliga il modello a scegliere fra queste azioni, niente altro.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["azione", "nota", "risposta"],
  properties: {
    azione: {
      type: "string",
      enum: ["conferma", "doppione", "conto_sbagliato", "non_so", "chiarimento", "informazione"],
      description: "L'unica azione da fare dopo la risposta dell'utente.",
    },
    nota: {
      type: "string",
      description: "Una frase da scrivere sul movimento come traccia, con le parole dell'utente riassunte. Vuota se l'azione e' chiarimento.",
    },
    risposta: {
      type: "string",
      description: "La risposta all'utente, in italiano, una o due frasi, che dice esattamente cosa e' stato fatto (o la domanda di chiarimento).",
    },
  },
};

function jsonError(status: number, message: string, code = "BANK_DOC_CHAT_ERROR") {
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

const oggiRoma = () =>
  new Date().toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric" });

const eur = (n: number) => `${n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const SYSTEM = `Lavori nel gestionale di un'azienda retail italiana. Dopo il caricamento di un estratto conto il sistema ha trovato una cosa che non torna e l'ha chiesta a Sabrina, che lavora in amministrazione. Il tuo compito è capire la sua risposta e scegliere UNA azione.

Regole della casa:
- L'estratto della banca comanda su tutto, perché lo garantisce la banca.
- Niente si cancella e niente si sposta da qui: un doppione o un movimento sul conto sbagliato si annotano e poi li toglie o li sposta Patrizio, dopo un controllo.
- Non inventare fatti che Sabrina non ha detto. Se la risposta è ambigua, fai una sola domanda di chiarimento.

Azioni:
- conferma: il movimento del gestionale è giusto (lo conosce, è vero, va bene così).
- doppione: il movimento è un doppione o non è mai avvenuto.
- conto_sbagliato: il movimento è vero ma registrato sul conto sbagliato.
- non_so: non lo sa o deve informarsi.
- chiarimento: la risposta non basta per decidere; in "risposta" scrivi la domanda.
- informazione: aggiunge un'informazione utile che non è nessuna delle precedenti.

La "risposta" a Sabrina: italiano semplice, una o due frasi, dai del tu, niente formule di cortesia. Di' esattamente cosa succede: per doppione e conto_sbagliato scrivi che l'hai annotato e che a toglierlo o spostarlo sarà Patrizio. Non usare il trattino lungo.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: utente del tenant con un ruolo che lavora la banca.
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
    const userId = userData.user.id;
    const { data: profilo } = await supabase.from("user_profiles").select("company_id, role, first_name").eq("id", userId).maybeSingle();
    if (!profilo?.company_id || !RUOLI.includes(String(profilo.role))) return jsonError(403, "Ruolo non abilitato");

    const body = await req.json().catch(() => ({}));
    const questionId = String(body.question_id ?? "");
    const testo = String(body.text ?? "").trim().slice(0, MAX_CHARS);
    if (!questionId || !testo) return jsonError(400, "question_id e text sono obbligatori");

    const { data: q, error: qErr } = await supabase.from("bank_document_questions")
      .select("id, company_id, statement_id, kind, question, status, bank_transaction_id, context")
      .eq("id", questionId).maybeSingle();
    if (qErr || !q) return jsonError(404, "Domanda non trovata");
    if (q.company_id !== profilo.company_id) return jsonError(403, "Domanda di un'altra azienda");
    if (q.status !== "aperta") return jsonError(409, "Questa domanda è già chiusa");

    // La risposta si salva subito: anche se il modello non risponde, resta scritta.
    await supabase.from("bank_document_messages").insert({
      company_id: q.company_id, question_id: q.id, author: "utente", author_id: userId, body: testo,
    });

    const { data: storia } = await supabase.from("bank_document_messages")
      .select("author, body, created_at").eq("question_id", q.id).order("created_at", { ascending: true });

    // Contesto del movimento, se la domanda ne riguarda uno.
    let contesto = "";
    if (q.bank_transaction_id) {
      const { data: bt } = await supabase.from("bank_transactions")
        .select("transaction_date, amount, description, statement_description, is_reconciled, source, bank_account_id")
        .eq("id", q.bank_transaction_id).maybeSingle();
      if (bt) {
        const { data: fatture } = await supabase.from("payables")
          .select("supplier_name, invoice_number, gross_amount").eq("bank_transaction_id", q.bank_transaction_id).limit(5);
        contesto = `\n\nMovimento in questione: ${bt.transaction_date}, ${eur(Number(bt.amount))}, «${bt.statement_description ?? bt.description ?? ""}», arrivato da ${bt.source === "acube_ob" ? "open banking" : bt.source}, ${bt.is_reconciled ? "già abbinato" : "non abbinato"}.`;
        if (fatture && fatture.length > 0) {
          contesto += ` Fatture agganciate: ${fatture.map((f) => `${f.supplier_name} n. ${f.invoice_number} (${eur(Number(f.gross_amount))})`).join("; ")}.`;
        }
      }
    }

    const conversazione = (storia ?? [])
      .map((m) => `${m.author === "sistema" ? "Sistema" : "Sabrina"}: ${m.body}`)
      .join("\n");

    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        fallbacks: "default",
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{
          role: "user",
          content: `Tipo di domanda: ${q.kind}.${contesto}\n\nConversazione finora:\n${conversazione}\n\nScegli l'azione per l'ultima risposta di Sabrina.`,
        }],
      }),
    });

    if (!r.ok) {
      console.error(`[bank-doc-chat] Anthropic API ${r.status}:`, await r.text());
      return jsonError(502, "Ho salvato la tua risposta, ma adesso non riesco a leggerla. La riprendo appena posso.", "ANTHROPIC_API_ERROR");
    }
    const data = await r.json();
    if (data?.stop_reason === "refusal") {
      return jsonError(502, "Ho salvato la tua risposta, ma non sono riuscito a interpretarla.", "REFUSAL");
    }
    const testoJson = (data?.content ?? []).filter((b: { type?: string }) => b?.type === "text").map((b: { text?: string }) => b?.text ?? "").join("");
    let dec: Decisione;
    try {
      dec = JSON.parse(testoJson) as Decisione;
    } catch {
      return jsonError(502, "Ho salvato la tua risposta, ma non sono riuscito a interpretarla.", "BAD_JSON");
    }
    if (!SCHEMA.properties.azione.enum.includes(dec.azione)) {
      return jsonError(502, "Risposta non valida dal modello.", "BAD_ACTION");
    }

    // Applicazione dell'azione. Nessuna cancella o sposta dati.
    const chi = profilo.first_name || "Sabrina";
    const traccia = `${oggiRoma()}, da risposta di ${chi} in Documenti banca: ${dec.nota || testo}`;
    let stato: "aperta" | "risolta" | "archiviata" = "risolta";
    let esito = "";
    switch (dec.azione) {
      case "conferma": esito = "Confermato da chi lavora la banca."; break;
      case "doppione": esito = "Segnalato come doppione: da togliere solo dopo conferma di Patrizio."; break;
      case "conto_sbagliato": esito = "Segnalato sul conto sbagliato: da spostare dopo conferma di Patrizio."; break;
      case "informazione": esito = "Informazione aggiunta."; break;
      case "non_so": stato = "archiviata"; esito = "Non noto per ora: si richiede al prossimo caricamento."; break;
      case "chiarimento": stato = "aperta"; break;
    }

    if (q.bank_transaction_id && dec.azione !== "chiarimento") {
      const { data: bt } = await supabase.from("bank_transactions").select("note").eq("id", q.bank_transaction_id).maybeSingle();
      const nota = [bt?.note, `${traccia}${esito ? ` (${esito})` : ""}`].filter(Boolean).join("\n");
      await supabase.from("bank_transactions").update({ note: nota }).eq("id", q.bank_transaction_id);
    }

    await supabase.from("bank_document_messages").insert({
      company_id: q.company_id, question_id: q.id, author: "sistema", body: dec.risposta,
      action: { azione: dec.azione, nota: dec.nota, esito },
    });
    if (stato !== "aperta") {
      await supabase.from("bank_document_questions").update({
        status: stato, resolution: `${dec.azione}: ${esito} ${dec.nota}`.trim(),
        resolved_by: userId, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("id", q.id);
    }

    console.log(`[bank-doc-chat] question=${q.id} kind=${q.kind} azione=${dec.azione} stato=${stato}`);
    return jsonOk({ reply: dec.risposta, action: dec.azione, status: stato });
  } catch (error) {
    console.error(`[bank-doc-chat] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
