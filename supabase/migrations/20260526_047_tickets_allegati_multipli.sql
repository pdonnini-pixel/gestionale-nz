-- Migration 047: supporto allegati multipli per ticket
-- Mantiene screenshot_url per backward compat con ticket pre-2026-05-26.
-- Nuovi ticket usano il jsonb 'allegati' come array di
-- { url: string, name: string, size: number, type: string }

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS allegati JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.tickets.allegati IS
  'Array di allegati: [{ url, name, size, type }]. screenshot_url e'' deprecato, usato solo per backward compat sui ticket pre-2026-05-26.';

-- Backfill: ticket esistenti con screenshot_url -> wrap in array allegati
UPDATE public.tickets
SET allegati = jsonb_build_array(jsonb_build_object(
  'url', screenshot_url,
  'name', 'screenshot.webp',
  'size', 0,
  'type', 'image/webp'
))
WHERE screenshot_url IS NOT NULL
  AND allegati = '[]'::jsonb;
