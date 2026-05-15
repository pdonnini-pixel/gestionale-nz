// Edge Function: acube-sdi-webhook
// Riceve webhook A-Cube SDI (supplier-invoice, customer-invoice-notification, ecc).
// Verifica firma Ed25519 IETF HTTP Message Signatures + salva audit log.
//
// IMPORTANT: deploy con verify_jwt=false (A-Cube non ha JWT Supabase, usa HTTP Signature).
// Sicurezza affidata alla verifica della signature Ed25519 contro la public key A-Cube.
//
// Eventi A-Cube SDI supportati:
//   - supplier-invoice          (fattura passiva ricevuta da SDI)
//   - customer-invoice          (notifica su fattura attiva inviata a SDI)
//   - customer-invoice-notification
//   - preservation
//   - smart-receipt
//   - sts
//
// Configurazione su A-Cube: POST /api-configurations
//   { event: 'supplier-invoice', target_url: '<URL-edge-function>' }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as ed from "npm:@noble/ed25519@2.1.0";
import { sha512 } from "npm:@noble/hashes@1.4.0/sha512";
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const ACUBE_PUBLIC_KEY_URL: Record<string, string> = {
  sandbox: "https://common-sandbox.api.acubeapi.com/signature-public-key",
  production: "https://common.api.acubeapi.com/signature-public-key",
};

const cachedPublicKeyPEM: Record<string, string> = {};

async function getPublicKeyPEM(stage: string): Promise<string | null> {
  if (cachedPublicKeyPEM[stage]) return cachedPublicKeyPEM[stage];
  try {
    const url = ACUBE_PUBLIC_KEY_URL[stage];
    if (!url) return null;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as { public_key?: string };
    if (!data.public_key) return null;
    cachedPublicKeyPEM[stage] = data.public_key;
    return data.public_key;
  } catch (e) {
    console.error("getPublicKeyPEM failed:", e);
    return null;
  }
}

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function parseSignatureHeader(h: string | null): Uint8Array | null {
  if (!h) return null;
  const m = h.match(/^[^=]+=:([^:]+):$/);
  if (!m) return null;
  try {
    const bin = atob(m[1]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function parseSignatureInput(h: string | null): {
  covered: string[]; rawValue: string; keyId?: string; alg?: string;
} | null {
  if (!h) return null;
  const m = h.match(/^[^=]+=\(([^)]*)\)(.*)$/);
  if (!m) return null;
  const covered = m[1].split(/\s+/).filter(Boolean).map((s) => s.replace(/^"|"$/g, ""));
  const params = m[2];
  const keyIdMatch = params.match(/keyid="([^"]+)"/);
  const algMatch = params.match(/alg="([^"]+)"/);
  return {
    covered,
    rawValue: `(${m[1]})${params}`,
    keyId: keyIdMatch?.[1],
    alg: algMatch?.[1],
  };
}

function buildSignatureBase(
  covered: string[], rawValue: string,
  headers: Record<string, string>, method: string, url: URL,
): string {
  const lines: string[] = [];
  for (const field of covered) {
    let v: string;
    if (field === "@method") v = method.toUpperCase();
    else if (field === "@authority") v = url.host;
    else if (field === "@target-uri") v = url.toString();
    else if (field === "@path") v = url.pathname;
    else v = headers[field.toLowerCase()] ?? "";
    lines.push(`"${field}": ${v}`);
  }
  lines.push(`"@signature-params": ${rawValue}`);
  return lines.join("\n");
}

async function verifySignature(req: Request, stage: string): Promise<boolean> {
  const sigBytes = parseSignatureHeader(req.headers.get("signature"));
  const sigInput = parseSignatureInput(req.headers.get("signature-input"));
  if (!sigBytes || !sigInput) return false;
  if (sigInput.keyId !== "acube") return false;
  if (sigInput.alg && sigInput.alg !== "ed25519") return false;

  const pem = await getPublicKeyPEM(stage);
  if (!pem) return false;

  const pubKeyBytes = pemToBytes(pem);
  // Ed25519 SPKI DER è 44 bytes (12 prefix + 32 key) - estraggo 32 byte raw
  const rawKey = pubKeyBytes.length === 32 ? pubKeyBytes : pubKeyBytes.slice(pubKeyBytes.length - 32);

  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const base = buildSignatureBase(sigInput.covered, sigInput.rawValue, headers, req.method, new URL(req.url));
  const baseBytes = new TextEncoder().encode(base);

  try {
    return await ed.verifyAsync(sigBytes, baseBytes, rawKey);
  } catch (e) {
    console.warn("ed25519 verify error:", e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const stage = Deno.env.get("ACUBE_STAGE") ?? "sandbox";
  const bodyText = await req.text();
  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(bodyText); } catch { /* body può essere non-JSON */ }

  let signatureValid: boolean | null = null;
  try {
    signatureValid = await verifySignature(req, stage);
  } catch (e) {
    console.warn("signature verify exception:", e);
    signatureValid = false;
  }

  const rawHeaders: Record<string, string> = {};
  req.headers.forEach((v, k) => { rawHeaders[k.toLowerCase()] = v; });

  const url = new URL(req.url);
  const event = url.searchParams.get("event")
    ?? (payload?.event as string | undefined)
    ?? "unknown";

  const p = payload as Record<string, any>;
  const invoiceUuid = p?.uuid ?? p?.invoice_uuid ?? p?.invoice?.uuid ?? null;
  const businessFiscalId = p?.recipient?.business_vat_number_code
    ?? p?.business_fiscal_id
    ?? p?.fiscal_id
    ?? null;

  const { error } = await supabase.from("acube_sdi_webhook_log").insert({
    event, payload, raw_headers: rawHeaders, signature_valid: signatureValid,
    invoice_uuid: invoiceUuid, business_fiscal_id: businessFiscalId,
  });

  if (error) {
    console.error("webhook log insert failed:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Sempre 200 — A-Cube retry-a su HTTP error, ma a noi serve idempotente
  return new Response(JSON.stringify({ received: true, signature_valid: signatureValid }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
