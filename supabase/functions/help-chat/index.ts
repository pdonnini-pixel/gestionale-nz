// Edge Function: help-chat
//
// Assistente AI di supporto all'uso del gestionale. Invocata dal pannello
// di aiuto (HelpPanel) presente su OGNI pagina: l'operatrice fa una domanda
// su COME funziona il sistema e Claude risponde in italiano semplice.
//
// Caratteristiche di sicurezza (vedi CLAUDE.md):
// - La chiave Anthropic sta nel Vault (RPC get_anthropic_api_key), MAI nel
//   frontend. Questa function fa da proxy.
// - Auth: qualsiasi utente autenticato del tenant (JWT valido).
// - L'AI risponde SOLO su come si usa il gestionale. Non vede i dati
//   aziendali (non tocca il DB) e ha istruzioni esplicite di NON proporre
//   mai cancellazioni/modifiche di dati o query SQL (regola NO DATA LOSS).
//
// Body POST:
//   {
//     "page":        "/scadenzario",          // path pagina corrente (opzionale)
//     "pageTitle":   "Scadenzario",           // titolo umano (opzionale)
//     "pageContext": "…testo guida pagina…",  // guida contestuale dal frontend
//     "messages":    [{ "role": "user"|"assistant", "content": "…" }, …]
//   }
// Response: { reply: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "claude-haiku-4-5-20251001";
const MAX_TURNS = 12; // ultime N battute passate a Claude (anti-abuso token)
const MAX_CHARS = 1500; // lunghezza massima per singolo messaggio utente

type ChatMessage = { role: "user" | "assistant"; content: string };

function jsonError(status: number, message: string, code = "HELP_CHAT_ERROR") {
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

// Legge un secret dal Vault via RPC (stesso helper di ticket-resolve-now).
async function getSecret(supabase: SupabaseClient, rpcName: string, key: string): Promise<string> {
  const { data, error } = await supabase.rpc(rpcName);
  if (error || !data || !data[0] || !data[0][key]) {
    throw new Error(`${rpcName} failed: ${error?.message ?? "no value"}`);
  }
  return data[0][key] as string;
}

// Costruisce il system prompt: definisce ruolo, tono e — soprattutto — i
// paletti di sicurezza. Il contesto della pagina arriva dal frontend, così
// resta sempre allineato ai testi guida senza duplicarli qui.
function buildSystemPrompt(pageTitle: string, pageContext: string): string {
  const ctx = pageContext?.trim()
    ? `\n\nCONTESTO DELLA PAGINA CORRENTE ("${pageTitle || "—"}"):\n${pageContext.trim()}`
    : "";

  return `Sei l'assistente di supporto del gestionale "Gestionale NZ", una piattaforma di gestione finanziaria per aziende retail con più punti vendita (outlet). Aiuti le operatrici (es. amministrazione) a capire COME si usa il sistema.

REGOLE DI RISPOSTA:
- Rispondi SEMPRE in italiano, con tono cortese, semplice e concreto. Niente gergo tecnico inutile.
- Rispondi SOLO a domande su come funziona/come si usa il gestionale (dove trovo X, come faccio Y, cosa significa Z, come importo un file, come preparo una distinta, ecc.).
- Sii breve: 2-6 frasi o un breve elenco puntato. Vai al pratico ("Vai su…", "Clicca…").
- Usa il contesto della pagina qui sotto quando pertinente. Se la domanda riguarda un'altra sezione, indica dove andare.
- Se non conosci la risposta o la domanda è ambigua, dillo con onestà e suggerisci di aprire una Segnalazione dalla sezione dedicata, senza inventare funzioni che potrebbero non esistere.

LIMITI IMPORTANTI (non negoziabili):
- NON hai accesso ai dati aziendali reali: non conosci saldi, importi, nomi di fornitori/clienti né numeri specifici. Se ti chiedono un dato ("quanto devo a…", "qual è il saldo…"), spiega che tu non vedi i dati e indica in quale pagina l'operatrice può leggerlo.
- NON proporre MAI di cancellare, azzerare, svuotare o modificare dati, né di eseguire istruzioni SQL o operazioni tecniche sul database. Il tuo compito è solo spiegare l'uso dell'interfaccia.
- NON dare consulenza fiscale, legale o contabile vincolante: per questi temi invita a verificare con il commercialista.${ctx}`;
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

    // Auth: qualsiasi utente autenticato del tenant.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
    }

    const body = await req.json().catch(() => ({}));
    const page: string = (body.page ?? "").toString().slice(0, 120);
    const pageTitle: string = (body.pageTitle ?? "").toString().slice(0, 120);
    const pageContext: string = (body.pageContext ?? "").toString().slice(0, 6000);
    const rawMessages: unknown = body.messages;

    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
      return jsonError(400, "Missing messages");
    }

    // Sanitizza e limita la conversazione.
    const messages: ChatMessage[] = rawMessages
      .filter((m): m is ChatMessage =>
        !!m && typeof (m as ChatMessage).content === "string" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant"))
      .map((m) => ({ role: m.role, content: m.content.toString().slice(0, MAX_CHARS) }))
      .filter((m) => m.content.trim().length > 0)
      .slice(-MAX_TURNS);

    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      return jsonError(400, "Last message must be from the user");
    }

    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");
    const systemPrompt = buildSystemPrompt(pageTitle, pageContext);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error(`[help-chat] Anthropic API ${r.status}:`, errText);
      return jsonError(502, "Assistente non disponibile al momento. Riprova tra poco.", "ANTHROPIC_API_ERROR");
    }

    const data = await r.json();
    const reply: string = (data?.content ?? [])
      .filter((b: { type?: string }) => b?.type === "text")
      .map((b: { text?: string }) => b?.text ?? "")
      .join("\n")
      .trim();

    if (!reply) {
      return jsonError(502, "Nessuna risposta generata. Riprova.", "EMPTY_REPLY");
    }

    console.log(`[help-chat] page="${page}" turns=${messages.length} reply_len=${reply.length}`);
    return jsonOk({ reply });
  } catch (error) {
    console.error(`[help-chat] Error:`, error);
    return jsonError(500, (error as Error).message);
  }
});
