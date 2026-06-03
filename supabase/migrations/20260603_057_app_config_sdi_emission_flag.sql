-- 20260603_057_app_config_sdi_emission_flag.sql
-- Flag "invio attivo" SDI, default OFF. La pagina Fatturazione e' un ARCHIVIO di
-- consultazione (fatture solo scaricate dal Cassetto); tutto l'apparato di emissione
-- SDI nel frontend e' gatato dietro questo flag e ricompare attivandolo.
-- Additivo, non distruttivo. Applicato via MCP su NZ + Made + Zago.
ALTER TABLE public.app_config ADD COLUMN IF NOT EXISTS sdi_emission_enabled boolean NOT NULL DEFAULT false;
