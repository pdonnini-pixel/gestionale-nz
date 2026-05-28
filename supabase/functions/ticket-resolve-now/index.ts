// Edge Function: ticket-resolve-now
//
// Invocata dal bottone "Risolvi" admin in /ticket/admin per risolvere
// istantaneamente un ticket via Claude API + GitHub API.
//
// Flusso:
// 1. Auth super_advisor
// 2. Carica ticket dal DB
// 3. Mappa modulo -> file path (es. "Banche" -> "frontend/src/pages/TesoreriaManuale.tsx")
// 4. Scarica file via GitHub Contents API
// 5. Chiama Claude Haiku con tool_use strutturato per ottenere
//    decisione + (eventuale) nuovo contenuto file + spiegazione utente
// 6. Se fix:
//    - Crea branch autofix-ticket-<short-id>
//    - PUT contents (commit)
//    - Apre PR
//    - Aggiorna ticket: stato=risolto, resolution_pr_url, 2 commenti AI
// 7. Se cant_fix:
//    - Aggiorna ticket: 1 commento AI con spiegazione, stato resta aperto
//
// Body POST: { "ticketId": "<uuid>" }
// Response: { ok: true, action: "fix"|"cant_fix", pr_url?, branch?, message }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GITHUB_OWNER = "pdonnini-pixel";
const GITHUB_REPO = "gestionale-nz";
const GITHUB_BASE_BRANCH = "main";

// Mappa modulo -> path file dal repo. I moduli "Altro" o non mappati
// vengono trattati come "non lo so dove guardare" -> cant_fix.
const MODULE_TO_PATH: Record<string, string> = {
  "Dashboard": "frontend/src/pages/Dashboard.tsx",
  "Banche": "frontend/src/pages/TesoreriaManuale.tsx",
  "Cashflow": "frontend/src/pages/CashflowProspettico.tsx",
  "Conto Economico": "frontend/src/pages/ContoEconomico.tsx",
  "Outlet": "frontend/src/pages/Outlet.tsx",
  "Confronto Outlet": "frontend/src/pages/ConfrontoOutlet.tsx",
  "Budget & Controllo": "frontend/src/pages/BudgetControl.tsx",
  "Fornitori": "frontend/src/pages/Fornitori.tsx",
  "Divisione Fornitori": "frontend/src/pages/AllocazioneFornitori.tsx",
  "Fatturazione": "frontend/src/pages/Fatturazione.tsx",
  "Scadenzario": "frontend/src/pages/Scadenzario.tsx",
  "Scadenze Fiscali": "frontend/src/pages/ScadenzeFiscali.tsx",
  "Dipendenti": "frontend/src/pages/Dipendenti.tsx",
  "AI Categorie": "frontend/src/pages/AICategoriePage.tsx",
  "Margini": "frontend/src/pages/MarginiOutlet.tsx",
  "Produttività": "frontend/src/pages/Produttivita.tsx",
  "Scenario Planning": "frontend/src/pages/ScenarioPlanning.tsx",
  "Import Hub": "frontend/src/pages/ImportHub.tsx",
  "Archivio Documenti": "frontend/src/pages/ArchivioDocumenti.tsx",
  "Impostazioni": "frontend/src/pages/Impostazioni.tsx",
  "Profilo": "frontend/src/pages/Profilo.tsx",
  "Segnalazioni": "frontend/src/pages/Ticket.tsx",
};

type TicketRow = {
  id: string;
  tipo: string;
  modulo: string;
  titolo: string;
  descrizione: string | null;
  priorita: string;
  stato: string;
  autore: string;
  autore_id: string | null;
  screenshot_url: string | null;
  allegati: Array<{ url: string; name: string; type: string }> | null;
  commenti: Array<{ id: string; autore: string; origine: string; testo: string; creato_il: string }> | null;
  creato_il: string;
};

async function getSecret(supabase: SupabaseClient, rpcName: string, key: string): Promise<string> {
  const { data, error } = await supabase.rpc(rpcName);
  if (error || !data || !data[0] || !data[0][key]) {
    throw new Error(`${rpcName} failed: ${error?.message ?? "no value"}`);
  }
  return data[0][key] as string;
}

// ─────────── GitHub API helpers ───────────
async function ghRequest(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function getFileFromMain(token: string, path: string): Promise<{ content: string; sha: string }> {
  const r = await ghRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BASE_BRANCH}`);
  if (!r.ok) throw new Error(`GitHub get file ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const data = await r.json() as { content: string; encoding: string; sha: string };
  if (data.encoding !== "base64") throw new Error(`Unexpected encoding: ${data.encoding}`);
  // atob in Deno: usiamo Uint8Array per evitare problemi UTF-8
  const decoded = new TextDecoder("utf-8").decode(Uint8Array.from(atob(data.content.replace(/\n/g, "")), c => c.charCodeAt(0)));
  return { content: decoded, sha: data.sha };
}

async function getMainShaForRef(token: string): Promise<string> {
  const r = await ghRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${GITHUB_BASE_BRANCH}`);
  if (!r.ok) throw new Error(`GitHub get main ref: HTTP ${r.status}`);
  const data = await r.json() as { object: { sha: string } };
  return data.object.sha;
}

async function createBranch(token: string, branchName: string, fromSha: string): Promise<void> {
  const r = await ghRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
  if (!r.ok) {
    const errText = await r.text();
    // 422 = ref already exists: ok, riusiamo
    if (r.status === 422 && errText.includes("already exists")) return;
    throw new Error(`GitHub create branch ${branchName}: HTTP ${r.status} ${errText.slice(0, 200)}`);
  }
}

async function updateFile(
  token: string, path: string, newContent: string, message: string, branch: string, baseSha: string,
): Promise<void> {
  // base64 encode UTF-8 safely
  const bytes = new TextEncoder().encode(newContent);
  let binStr = "";
  for (let i = 0; i < bytes.length; i++) binStr += String.fromCharCode(bytes[i]);
  const contentB64 = btoa(binStr);

  const r = await ghRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: contentB64,
      sha: baseSha,
      branch,
      committer: { name: "AutoFix Bot", email: "autofix@gestionale-nz.local" },
    }),
  });
  if (!r.ok) throw new Error(`GitHub update file ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
}

async function createPullRequest(
  token: string, title: string, body: string, head: string, base: string,
): Promise<{ html_url: string; number: number }> {
  const r = await ghRequest(token, `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!r.ok) throw new Error(`GitHub create PR: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return await r.json() as { html_url: string; number: number };
}

// ─────────── Anthropic API ───────────
type ClaudeResolution = {
  action: "fix" | "cant_fix";
  new_file_content?: string;
  explanation_for_user: string;
  technical_notes: string;
};

async function callClaudeForResolution(
  apiKey: string, ticket: TicketRow, filePath: string, fileContent: string,
): Promise<ClaudeResolution> {
  const systemPrompt = `Sei AutoFix, un agente che corregge bug nel gestionale-nz (React + TypeScript + Tailwind + Supabase).

REGOLE:
1. Ti viene fornito un ticket (bug o richiesta funzione) e il contenuto INTERO di un file React.
2. Devi decidere: "fix" (sai come correggere modificando SOLO quel file) o "cant_fix" (serve altro file, troppo rischioso, info insufficienti).
3. Se "fix", restituisci il NUOVO CONTENUTO COMPLETO del file. NON un diff, NON una porzione: tutto il file, dall'inizio alla fine.
4. Mantieni stile esistente del codebase: solo Tailwind utility classes, no CSS custom, toast/modal custom (no alert/confirm nativi), commenti italiani.
5. Mai introdurre regressioni: se non sei sicuro al 95% che il fix risolva senza rompere, scegli "cant_fix".
6. explanation_for_user: ITALIANO, semplice, per utente non tecnico (Sabrina/Veronica). Es: "Ho corretto il problema: ora cliccando su X si apre Y correttamente."
7. technical_notes: ITALIANO, dettaglio tecnico per Patrizio (sviluppatore). Es: "Aggiunto useEffect mancante in handleSyncTx, riga 168, per trigger reload dati dopo sync.".

CASI "cant_fix" tipici:
- Bug coinvolge piu' file (es. servizio + UI)
- Serve migration DB
- Bug nei dati, non nel codice
- Richiesta di feature complessa (>= 50 righe nuove)
- Screenshot mostra un problema che non sai diagnosticare dal solo file dato`;

  const userMessage = `# Ticket #${ticket.id.slice(0, 8)}
- **Tipo**: ${ticket.tipo}
- **Modulo**: ${ticket.modulo}
- **Priorità**: ${ticket.priorita}
- **Titolo**: ${ticket.titolo}
- **Descrizione**: ${ticket.descrizione ?? "(nessuna)"}
- **Autore**: ${ticket.autore}
${ticket.allegati && ticket.allegati.length > 0 ? `- **Allegati**: ${ticket.allegati.map(a => a.url).join(", ")}` : ""}

# File coinvolto: \`${filePath}\`

\`\`\`tsx
${fileContent}
\`\`\`

Analizza il ticket e il file, poi chiama il tool submit_resolution.`;

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
    tools: [{
      name: "submit_resolution",
      description: "Submit the resolution decision",
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["fix", "cant_fix"] },
          new_file_content: { type: "string", description: "Full new content of the file, only if action=fix. Mandatory if fix." },
          explanation_for_user: { type: "string", description: "Italian, friendly, for non-tech user (Sabrina/Veronica). Brief: 1-3 sentences." },
          technical_notes: { type: "string", description: "Italian, technical, for developer (Patrizio). What changed and why." },
        },
        required: ["action", "explanation_for_user", "technical_notes"],
      },
    }],
    tool_choice: { type: "tool", name: "submit_resolution" },
  };

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Claude API: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);

  const data = await r.json() as { content: Array<{ type: string; name?: string; input?: ClaudeResolution }> };
  const toolUse = data.content.find(c => c.type === "tool_use" && c.name === "submit_resolution");
  if (!toolUse || !toolUse.input) throw new Error("Claude: no tool_use response");

  const result = toolUse.input;
  if (result.action === "fix" && !result.new_file_content) {
    throw new Error("Claude: action=fix but no new_file_content");
  }
  return result;
}

// ─────────── Handler principale ───────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "Method not allowed");

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth: solo super_advisor
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonError(401, "Missing authorization");
    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) return jsonError(401, "Invalid JWT");
      // Lettura ruolo da public.user_profiles (campo testo pulito) invece
      // che dai metadata JWT: su NZ raw_app_meta_data.role e' salvato come
      // stringa JSON-encoded (es. "[\"super_advisor\", ...]") che rompe il check.
      // Fix: query DB diretta che ritorna sempre stringa.
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("id", userData.user.id)
        .maybeSingle();
      const userRole = (profile as { role?: string } | null)?.role ?? null;
      if (userRole !== "super_advisor") {
        return jsonError(403, `Solo super_advisor puo' invocare ticket-resolve-now (ruolo: ${userRole ?? "nessuno"})`);
      }
    }

    const body = await req.json().catch(() => ({}));
    const ticketId: string = (body.ticketId ?? "").toString().trim();
    if (!ticketId) return jsonError(400, "Missing ticketId");

    // Carica ticket
    const { data: ticketData, error: tErr } = await supabase
      .from("tickets")
      .select("*")
      .eq("id", ticketId)
      .maybeSingle();
    if (tErr || !ticketData) return jsonError(404, `Ticket ${ticketId} non trovato: ${tErr?.message ?? "no row"}`);
    const ticket = ticketData as unknown as TicketRow;

    // Determina file path target
    const filePath = MODULE_TO_PATH[ticket.modulo];
    if (!filePath) {
      // Modulo "Altro" o non mappato: chiudi con commento cant_fix senza chiamare Claude
      await appendCommentToTicket(supabase, ticket, {
        autore: "AutoFix",
        origine: "ai",
        testo: `Non posso lavorare automaticamente su questo ticket: il modulo "${ticket.modulo}" non è mappato a un file specifico. Patrizio deve risolverlo manualmente.`,
      });
      return jsonOk({ ok: true, action: "cant_fix", message: `Modulo ${ticket.modulo} non mappato` });
    }

    // Carica secrets
    const ghToken = await getSecret(supabase, "get_github_token", "token");
    const anthropicKey = await getSecret(supabase, "get_anthropic_api_key", "api_key");

    // Scarica file dal main
    const { content: fileContent, sha: fileSha } = await getFileFromMain(ghToken, filePath);

    // Chiama Claude
    const resolution = await callClaudeForResolution(anthropicKey, ticket, filePath, fileContent);

    if (resolution.action === "cant_fix") {
      // Commento AI con spiegazione, ticket resta aperto
      await appendCommentToTicket(supabase, ticket, {
        autore: "AutoFix",
        origine: "ai",
        testo: `🤖 Non sono riuscita a correggere automaticamente questo ticket.\n\n${resolution.explanation_for_user}\n\n_Note tecniche: ${resolution.technical_notes}_`,
      });
      return jsonOk({ ok: true, action: "cant_fix", message: resolution.explanation_for_user });
    }

    // action === "fix": apri PR
    const shortId = ticket.id.slice(0, 8);
    const branchName = `autofix-ticket-${shortId}`;
    const mainSha = await getMainShaForRef(ghToken);
    await createBranch(ghToken, branchName, mainSha);

    const commitMsg = `fix(${ticket.modulo.toLowerCase().replace(/[^a-z0-9]/g, "-")}): ${ticket.titolo}\n\nAutoFix da ticket #${shortId}\n\n${resolution.technical_notes}`;
    await updateFile(ghToken, filePath, resolution.new_file_content!, commitMsg, branchName, fileSha);

    const prTitle = `[AutoFix #${shortId}] ${ticket.titolo}`;
    const prBody = `## Ticket #${shortId}\n**Modulo**: ${ticket.modulo}\n**Autore**: ${ticket.autore}\n**Priorità**: ${ticket.priorita}\n**Tipo**: ${ticket.tipo}\n\n## Descrizione utente\n${ticket.descrizione ?? "(nessuna)"}\n\n## Cosa fa questo fix\n${resolution.explanation_for_user}\n\n## Note tecniche AI\n${resolution.technical_notes}\n\n---\n🤖 Generato automaticamente da \`ticket-resolve-now\` (Claude Haiku 4.5). Da rivedere e mergeare manualmente.`;

    const pr = await createPullRequest(ghToken, prTitle, prBody, branchName, GITHUB_BASE_BRANCH);

    // Aggiorna ticket: stato risolto + commenti + URL PR
    const nuoviCommenti = [
      ...(ticket.commenti ?? []),
      {
        id: `c_${Date.now()}_user`,
        autore: "AutoFix",
        origine: "ai",
        testo: `🤖 ${resolution.explanation_for_user}\n\nIl fix è stato proposto in PR #${pr.number}. Sarà attivo dopo che Patrizio l'avrà revisionato e mergeato (di solito entro 24h).`,
        creato_il: new Date().toISOString(),
      },
      {
        id: `c_${Date.now()}_tech`,
        autore: "AutoFix",
        origine: "ai",
        testo: `_[Note tecniche per Patrizio]_ ${resolution.technical_notes}\n\nPR: ${pr.html_url}\nBranch: ${branchName}\nFile toccato: \`${filePath}\``,
        creato_il: new Date(Date.now() + 1).toISOString(),
      },
    ];

    const { error: updErr } = await supabase.from("tickets").update({
      stato: "risolto",
      risolto_il: new Date().toISOString(),
      commenti: nuoviCommenti,
      resolution_pr_url: pr.html_url,
      resolution_branch: branchName,
      note_fix: resolution.technical_notes,
    }).eq("id", ticket.id);
    if (updErr) throw new Error(`Update ticket: ${updErr.message}`);

    return jsonOk({
      ok: true,
      action: "fix",
      pr_url: pr.html_url,
      pr_number: pr.number,
      branch: branchName,
      message: resolution.explanation_for_user,
    });
  } catch (e) {
    return jsonError(500, `Errore: ${e instanceof Error ? e.message : String(e)}`);
  }
});

async function appendCommentToTicket(
  supabase: SupabaseClient, ticket: TicketRow, commento: { autore: string; origine: "ai" | "utente"; testo: string },
): Promise<void> {
  const nuovi = [
    ...(ticket.commenti ?? []),
    { id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ...commento, creato_il: new Date().toISOString() },
  ];
  await supabase.from("tickets").update({ commenti: nuovi }).eq("id", ticket.id);
}

function jsonOk(p: unknown): Response {
  return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
