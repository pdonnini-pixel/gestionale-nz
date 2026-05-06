-- Auto-generated dump of NZ public schema (idempotent).

-- Source: pg_catalog of project xfvfxsvqpnpvibgeqpqp.

-- Generato da tools/provisioning/dump-nz-schema.py.


CREATE TABLE IF NOT EXISTS public._migrations_log (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  checksum text NOT NULL
);

CREATE EXTENSION IF NOT EXISTS "http";

CREATE EXTENSION IF NOT EXISTS "pg_net";

CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $do$ BEGIN
  CREATE TYPE contract_status AS ENUM ('attivo', 'in_scadenza', 'scaduto', 'disdettato');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE contract_type AS ENUM ('indeterminato', 'determinato');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE cost_macro_group AS ENUM ('costo_venduto', 'locazione', 'personale', 'generali_amministrative', 'finanziarie', 'oneri_diversi');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE import_source AS ENUM ('csv_banca', 'csv_ade', 'csv_pos', 'api_pos', 'api_ade', 'manuale', 'csv_fatture', 'xml_sdi', 'pdf_bilancio', 'csv_cedolini', 'api_yapily');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE import_status AS ENUM ('pending', 'processing', 'completed', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE payable_status AS ENUM ('da_pagare', 'in_scadenza', 'scaduto', 'pagato', 'parziale', 'sospeso', 'rimandato', 'annullato', 'bloccato', 'nota_credito');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE payment_method AS ENUM ('bonifico_ordinario', 'bonifico_urgente', 'bonifico_sepa', 'riba_30', 'riba_60', 'riba_90', 'riba_120', 'rid', 'sdd_core', 'sdd_b2b', 'rimessa_diretta', 'carta_credito', 'carta_debito', 'assegno', 'contanti', 'compensazione', 'f24', 'mav', 'rav', 'bollettino_postale', 'altro');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE period_status AS ENUM ('aperto', 'in_chiusura', 'chiuso');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('entrata', 'uscita');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  CREATE TYPE user_role AS ENUM ('super_advisor', 'cfo', 'coo', 'ceo', 'contabile');
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE TABLE IF NOT EXISTS active_invoices (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "invoice_number" text NOT NULL,
  "invoice_date" date NOT NULL,
  "tipo_documento" text DEFAULT 'TD01'::text NOT NULL,
  "client_name" text NOT NULL,
  "client_vat" text,
  "client_fiscal_code" text,
  "codice_destinatario" text,
  "pec_destinatario" text,
  "total_amount" numeric(15,2) NOT NULL,
  "taxable_amount" numeric(15,2),
  "vat_amount" numeric(15,2),
  "vat_rate" numeric(5,2) DEFAULT 22.00,
  "payment_method" text DEFAULT 'MP05'::text,
  "payment_terms" text DEFAULT 'TP02'::text,
  "due_date" date,
  "xml_content" text,
  "xml_file_path" text,
  "sdi_id" text,
  "sdi_status" text DEFAULT 'DRAFT'::text,
  "sdi_notifications" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS ai_anomaly_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "anomaly_type" text NOT NULL,
  "severity" text DEFAULT 'medium'::text,
  "description" text,
  "details" jsonb,
  "is_resolved" boolean DEFAULT false,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS ai_categorization_rules (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "category_id" uuid NOT NULL,
  "rule_type" text NOT NULL,
  "counterpart_pattern" text,
  "description_pattern" text,
  "amount_min" numeric(15,2),
  "amount_max" numeric(15,2),
  "confidence" numeric(5,2) DEFAULT 0.90,
  "times_confirmed" integer DEFAULT 1,
  "last_used_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "is_active" boolean DEFAULT true,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS annual_budgets (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "year" integer NOT NULL,
  "revenue_target" numeric(14,2),
  "revenue_bp" numeric(14,2),
  "cost_of_goods_pct" numeric(5,4),
  "rent_annual" numeric(14,2),
  "condo_marketing_annual" numeric(14,2),
  "staff_cost_annual" numeric(14,2),
  "admin_compensation_annual" numeric(14,2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS app_config (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "yapily_environment" text DEFAULT 'SANDBOX'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS app_users (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "auth_user_id" uuid,
  "nome" text NOT NULL,
  "cognome" text NOT NULL,
  "email" text NOT NULL,
  "ruolo" text DEFAULT 'operatrice'::text NOT NULL,
  "is_active" boolean DEFAULT true,
  "outlet_access" text[] DEFAULT '{all}'::text[],
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS balance_sheet_data (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "import_id" uuid,
  "year" integer NOT NULL,
  "period_type" text NOT NULL,
  "section" text DEFAULT 'conto_economico'::text NOT NULL,
  "account_code" text,
  "account_name" text NOT NULL,
  "amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "parent_account" text,
  "cost_center" text DEFAULT 'all'::text,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS balance_sheet_imports (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "year" integer NOT NULL,
  "period_type" text DEFAULT 'annuale'::text NOT NULL,
  "period_label" text,
  "file_name" text,
  "file_path" text,
  "file_size" bigint,
  "status" text DEFAULT 'uploaded'::text,
  "extracted_data" jsonb,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "verified_at" timestamp with time zone,
  "verified_by" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "uploaded_by" uuid,
  "uploaded_by_name" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "bank_name" text NOT NULL,
  "iban" text,
  "account_name" text,
  "account_type" text DEFAULT 'conto_corrente'::text,
  "credit_line" numeric(14,2) DEFAULT 0,
  "currency" text DEFAULT 'EUR'::text,
  "outlet_id" uuid,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "current_balance" numeric(14,2) DEFAULT 0,
  "last_update" timestamp with time zone,
  "outlet_code" text,
  "note" text,
  "updated_at" timestamp with time zone DEFAULT now(),
  "is_manual" boolean DEFAULT true,
  "color" text DEFAULT '#3B82F6'::text,
  "balance_updated_at" timestamp with time zone,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS bank_balances (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "date" date NOT NULL,
  "balance_accounting" numeric(14,2),
  "balance_available" numeric(14,2),
  "source" import_source DEFAULT 'manuale'::import_source,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS bank_imports (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "bank_account_id" uuid,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "file_format" text,
  "import_type" text DEFAULT 'estratto_conto'::text,
  "period_from" date,
  "period_to" date,
  "records_count" integer DEFAULT 0,
  "status" text DEFAULT 'uploaded'::text,
  "error_message" text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS bank_statements (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "filename" text NOT NULL,
  "file_type" text NOT NULL,
  "file_url" text,
  "period_from" date,
  "period_to" date,
  "opening_balance" numeric(15,2),
  "closing_balance" numeric(15,2),
  "transaction_count" integer DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "error_message" text,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "bank_account_id" uuid,
  "import_id" uuid,
  "transaction_date" date NOT NULL,
  "value_date" date,
  "amount" numeric(14,2) NOT NULL,
  "balance_after" numeric(14,2),
  "description" text,
  "counterpart" text,
  "reference" text,
  "category" text,
  "supplier_id" uuid,
  "invoice_id" uuid,
  "payment_schedule_id" uuid,
  "is_reconciled" boolean DEFAULT false,
  "reconciled_at" timestamp with time zone,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "account_id" uuid,
  "yapily_transaction_id" text,
  "currency" text DEFAULT 'EUR'::text,
  "transaction_type" text,
  "running_balance" numeric(15,2),
  "merchant_name" text,
  "status" text DEFAULT 'BOOKED'::text,
  "booking_date" date,
  "raw_data" jsonb,
  "reconciled_invoice_id" uuid,
  "statement_id" uuid,
  "source" text DEFAULT 'manual'::text,
  "counterpart_name" text,
  "counterpart_iban" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS budget_approval_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "cost_center" text NOT NULL,
  "year" integer NOT NULL,
  "action" text NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "actor_email" text,
  "reason" text,
  "rows_affected" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS budget_confronto (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "cost_center" text NOT NULL,
  "account_code" text NOT NULL,
  "year" integer NOT NULL,
  "month" integer DEFAULT 0 NOT NULL,
  "entry_type" text NOT NULL,
  "amount" numeric DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "rettifica_pct" numeric(5,2),
  "rettifica_amount" numeric(14,2),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS budget_cost_lines (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "budget_id" uuid NOT NULL,
  "cost_category_id" uuid,
  "label" text,
  "amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS budget_entries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "account_code" text NOT NULL,
  "account_name" text NOT NULL,
  "macro_group" text NOT NULL,
  "cost_center" text DEFAULT 'all'::text NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "budget_amount" numeric(14,2) DEFAULT 0,
  "actual_amount" numeric(14,2),
  "is_approved" boolean DEFAULT false,
  "approved_at" timestamp with time zone,
  "approved_by" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "unlocked_at" timestamp with time zone,
  "unlocked_by" uuid,
  "unlock_reason" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS cash_budget (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "target_min_balance" numeric(14,2),
  "expected_inflows" numeric(14,2),
  "expected_outflows" numeric(14,2),
  "expected_net" numeric(14,2),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS cash_movements (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "bank_account_id" uuid,
  "outlet_id" uuid,
  "date" date NOT NULL,
  "value_date" date,
  "type" transaction_type NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "balance_after" numeric(14,2),
  "description" text,
  "counterpart" text,
  "cost_category_id" uuid,
  "is_reconciled" boolean DEFAULT false,
  "reconciled_with" uuid,
  "reconciled_at" timestamp with time zone,
  "reconciled_by" uuid,
  "source" import_source DEFAULT 'manuale'::import_source,
  "import_batch_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "verified" boolean DEFAULT false,
  "verified_at" timestamp with time zone,
  "verified_by" uuid,
  "yapily_transaction_id" uuid,
  "ai_category_id" uuid,
  "ai_confidence" numeric(5,2),
  "ai_categorized_at" timestamp with time zone,
  "ai_method" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS cash_position (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "record_date" date NOT NULL,
  "bank_account_id" uuid,
  "balance" numeric(14,2) DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'manual'::text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "macro_group" text NOT NULL,
  "parent_id" uuid,
  "is_fixed" boolean DEFAULT false,
  "is_recurring" boolean DEFAULT true,
  "default_centers" text[] DEFAULT '{all}'::text[],
  "annual_amount" numeric(14,2) DEFAULT 0,
  "note" text,
  "sort_order" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS companies (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "name" text NOT NULL,
  "vat_number" text,
  "fiscal_code" text,
  "legal_address" text,
  "pec" text,
  "sdi_code" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "settings" jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS company_settings (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "ragione_sociale" text DEFAULT 'NEW ZAGO S.R.L.'::text NOT NULL,
  "forma_giuridica" text,
  "sede_legale" text,
  "partita_iva" text,
  "codice_fiscale" text,
  "rea" text,
  "capitale_sociale" text,
  "data_costituzione" text,
  "pec" text,
  "codice_sdi" text,
  "ateco" text,
  "amministratore" text,
  "note" text,
  "soci" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS contract_amount_history (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "contract_id" uuid NOT NULL,
  "effective_date" date NOT NULL,
  "previous_amount" numeric(14,2),
  "new_amount" numeric(14,2),
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS contract_deadlines (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "contract_id" uuid NOT NULL,
  "deadline_date" date NOT NULL,
  "description" text NOT NULL,
  "is_completed" boolean DEFAULT false,
  "completed_at" timestamp with time zone,
  "completed_by" uuid,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS contract_documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "contract_id" uuid,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "outlet_id" uuid,
  "category" text,
  "uploaded_by" uuid,
  "uploaded_by_name" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS contracts (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "name" text NOT NULL,
  "contract_type" text NOT NULL,
  "counterpart" text,
  "contract_number" text,
  "cost_category_id" uuid,
  "monthly_amount" numeric(14,2),
  "annual_amount" numeric(14,2),
  "vat_rate" numeric(5,2) DEFAULT 22,
  "deposit_amount" numeric(14,2),
  "start_date" date NOT NULL,
  "end_date" date,
  "renewal_date" date,
  "notice_days" integer DEFAULT 180,
  "notice_deadline" date,
  "auto_renewal" boolean DEFAULT true,
  "renewal_period_months" integer DEFAULT 12,
  "escalation_type" text,
  "escalation_rate" numeric(6,4),
  "escalation_date" date,
  "escalation_frequency_months" integer DEFAULT 12,
  "min_revenue_clause" numeric(14,2),
  "min_revenue_period" text,
  "variable_rent_pct" numeric(5,4),
  "variable_rent_threshold" numeric(14,2),
  "sqm" numeric(10,2),
  "status" contract_status DEFAULT 'attivo'::contract_status,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS corrispettivi_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "date" date NOT NULL,
  "device_serial" text,
  "total_amount" numeric(15,2) NOT NULL,
  "vat_breakdown" jsonb,
  "xml_content" text,
  "submission_status" text DEFAULT 'PENDING'::text,
  "ade_receipt_id" text,
  "submitted_at" timestamp with time zone,
  "error_details" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS cost_categories (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "macro_group" cost_macro_group NOT NULL,
  "is_fixed" boolean DEFAULT true,
  "is_recurring" boolean DEFAULT false,
  "is_system" boolean DEFAULT false,
  "sort_order" integer DEFAULT 0,
  "matching_keywords" text[],
  "is_active" boolean DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "color" text DEFAULT '#6b7280'::text,
  "parent_id" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS cost_centers (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "code" text NOT NULL,
  "label" text NOT NULL,
  "color" text DEFAULT 'bg-slate-600'::text,
  "sort_order" integer DEFAULT 0,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS csv_mappings (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "source" import_source NOT NULL,
  "name" text NOT NULL,
  "column_mapping" jsonb NOT NULL,
  "date_format" text DEFAULT 'DD/MM/YYYY'::text,
  "decimal_separator" text DEFAULT ','::text,
  "thousand_separator" text DEFAULT '.'::text,
  "skip_rows" integer DEFAULT 0,
  "delimiter" text DEFAULT ';'::text,
  "encoding" text DEFAULT 'UTF-8'::text,
  "auto_rules" jsonb,
  "is_default" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS daily_receipts_ade (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "date" date NOT NULL,
  "device_serial" text,
  "total_amount" numeric(14,2),
  "non_taxable_amount" numeric(14,2),
  "vat_amount" numeric(14,2),
  "is_reconciled" boolean DEFAULT false,
  "daily_revenue_id" uuid,
  "source" import_source DEFAULT 'csv_ade'::import_source,
  "import_batch_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS daily_revenue (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "date" date NOT NULL,
  "gross_revenue" numeric(14,2) DEFAULT 0,
  "net_revenue" numeric(14,2) DEFAULT 0,
  "transactions_count" integer DEFAULT 0,
  "avg_ticket" numeric(10,2) DEFAULT 0,
  "cash_amount" numeric(14,2) DEFAULT 0,
  "card_amount" numeric(14,2) DEFAULT 0,
  "other_amount" numeric(14,2) DEFAULT 0,
  "source" import_source DEFAULT 'manuale'::import_source,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "import_batch_id" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS document_versions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL,
  "document_table" text DEFAULT 'documents'::text NOT NULL,
  "version_number" integer DEFAULT 1 NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" bigint,
  "storage_bucket" text DEFAULT 'outlet-attachments'::text,
  "uploaded_by" uuid,
  "uploaded_by_name" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "category" text DEFAULT 'altro'::text NOT NULL,
  "reference_type" text,
  "reference_id" uuid,
  "file_name" text NOT NULL,
  "file_path" text NOT NULL,
  "file_size" bigint,
  "file_type" text,
  "description" text,
  "year" integer,
  "month" integer,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "storage_bucket" text,
  "uploaded_by" uuid,
  "uploaded_by_name" text,
  "retention_start" date,
  "retention_end" date,
  "retention_status" text DEFAULT 'active'::text,
  "storage_path" text,
  "document_status" text DEFAULT 'active'::text,
  "upload_status" text DEFAULT 'completed'::text,
  "import_batch_id" uuid,
  "import_source" text,
  "parsed_data" jsonb,
  "validation_status" text DEFAULT 'pending'::text,
  "validation_errors" jsonb,
  "sdi_id" text,
  "sdi_status" text,
  "xml_content" text,
  "sender_vat" text,
  "receiver_vat" text,
  "invoice_number" text,
  "invoice_date" date,
  "total_amount" numeric,
  "tax_amount" numeric,
  "currency" text DEFAULT 'EUR'::text,
  "document_type" text,
  "processed_at" timestamp with time zone,
  "import_status" text DEFAULT 'pending'::text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS electronic_invoices (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "invoice_number" text,
  "invoice_date" date,
  "supplier_name" text,
  "supplier_vat" text,
  "net_amount" numeric(14,2),
  "vat_amount" numeric(14,2),
  "gross_amount" numeric(14,2),
  "cost_category_id" uuid,
  "description" text,
  "is_reconciled" boolean DEFAULT false,
  "cash_movement_id" uuid,
  "monthly_cost_line_id" uuid,
  "source" import_source DEFAULT 'csv_ade'::import_source,
  "import_batch_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "sdi_id" text,
  "sdi_status" text DEFAULT 'RECEIVED'::text,
  "tipo_documento" text DEFAULT 'TD01'::text,
  "xml_content" text,
  "xml_file_path" text,
  "supplier_fiscal_code" text,
  "codice_destinatario" text,
  "payment_method" text,
  "payment_terms" text,
  "due_date" date,
  "updated_at" timestamp with time zone DEFAULT now(),
  "retention_start" date,
  "retention_end" date,
  "retention_status" text DEFAULT 'active'::text,
  "storage_path" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS employee_costs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "employee_id" uuid,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "retribuzione" numeric(12,2) DEFAULT 0,
  "contributi" numeric(12,2) DEFAULT 0,
  "inail" numeric(12,2) DEFAULT 0,
  "tfr" numeric(12,2) DEFAULT 0,
  "altri_costi" numeric(12,2) DEFAULT 0,
  "source" text DEFAULT 'manuale'::text,
  "import_id" uuid,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS employee_documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "employee_id" uuid,
  "doc_type" text DEFAULT 'altro'::text NOT NULL,
  "year" integer,
  "month" integer,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "status" text DEFAULT 'uploaded'::text,
  "extracted_data" jsonb,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS employee_outlet_allocations (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "employee_id" uuid NOT NULL,
  "outlet_code" text NOT NULL,
  "allocation_pct" numeric(5,2) DEFAULT 100.00 NOT NULL,
  "role_at_outlet" text,
  "is_primary" boolean DEFAULT true,
  "valid_from" date DEFAULT CURRENT_DATE,
  "valid_to" date,
  "created_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS employees (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "fiscal_code" text,
  "hire_date" date,
  "termination_date" date,
  "contract_type" contract_type,
  "level" text,
  "weekly_hours" numeric(5,1),
  "fte_ratio" numeric(4,2),
  "gross_monthly_cost" numeric(12,2),
  "gross_annual_cost" numeric(14,2),
  "net_monthly_salary" numeric(12,2),
  "role_description" text,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "nome" text,
  "cognome" text,
  "codice_fiscale" text,
  "matricola" text,
  "data_assunzione" date,
  "data_cessazione" date,
  "contratto_tipo" text,
  "livello" text,
  "ore_settimanali" numeric(5,1) DEFAULT 40,
  "note" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS fiscal_deadlines (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "deadline_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "amount" numeric(14,2),
  "amount_paid" numeric(14,2) DEFAULT 0,
  "due_date" date NOT NULL,
  "reminder_date" date,
  "paid_date" date,
  "is_recurring" boolean DEFAULT false,
  "recurrence_rule" text,
  "recurrence_day" integer,
  "status" text DEFAULT 'pending'::text NOT NULL,
  "f24_code" text,
  "tax_period" text,
  "payment_method" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS import_batches (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "source" import_source NOT NULL,
  "status" import_status DEFAULT 'pending'::import_status,
  "file_name" text,
  "file_path" text,
  "bank_account_id" uuid,
  "outlet_id" uuid,
  "period_from" date,
  "period_to" date,
  "rows_total" integer DEFAULT 0,
  "rows_imported" integer DEFAULT 0,
  "rows_skipped" integer DEFAULT 0,
  "rows_error" integer DEFAULT 0,
  "error_log" jsonb,
  "imported_by" uuid,
  "imported_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "total_rows" integer DEFAULT 0,
  "processed_rows" integer DEFAULT 0,
  "error_rows" integer DEFAULT 0,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS import_documents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "file_type" text,
  "source" text DEFAULT 'manuale'::text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS invoices (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "supplier_id" uuid,
  "invoice_number" text NOT NULL,
  "invoice_date" date NOT NULL,
  "due_date" date,
  "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "tax_amount" numeric(14,2) DEFAULT 0,
  "net_amount" numeric(14,2) DEFAULT 0,
  "currency" text DEFAULT 'EUR'::text,
  "payment_method" text,
  "payment_terms" text,
  "status" text DEFAULT 'da_pagare'::text,
  "account_code" text,
  "cost_center" text DEFAULT 'all'::text,
  "sdi_id" text,
  "xml_file_path" text,
  "pdf_file_path" text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS loan_tranches (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "loan_id" uuid NOT NULL,
  "tranche_number" integer NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "disbursement_date" date NOT NULL,
  "interest_rate" numeric(6,4),
  "maturity_days" integer,
  "accrued_interest" numeric(12,2),
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS loans (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "description" text,
  "total_amount" numeric(14,2),
  "interest_rate" numeric(6,4),
  "start_date" date,
  "end_date" date,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "lender" text,
  "loan_type" text DEFAULT 'altro'::text,
  "original_amount" numeric(14,2),
  "remaining_amount" numeric(14,2),
  "installment_amount" numeric(14,2),
  "installment_frequency" text DEFAULT 'mensile'::text,
  "bank_account_id" uuid,
  "beneficiaries" jsonb,
  "note" text,
  "is_active" boolean DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS manual_balance_entries (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "balance" numeric(15,2) NOT NULL,
  "balance_date" date NOT NULL,
  "notes" text,
  "entered_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS monthly_actuals (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "revenue" numeric(14,2) DEFAULT 0,
  "purchases" numeric(14,2) DEFAULT 0,
  "opening_inventory" numeric(14,2) DEFAULT 0,
  "closing_inventory" numeric(14,2) DEFAULT 0,
  "returns_to_warehouse" numeric(14,2) DEFAULT 0,
  "status" period_status DEFAULT 'aperto'::period_status,
  "closed_at" timestamp with time zone,
  "closed_by" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS monthly_cost_lines (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "monthly_actual_id" uuid NOT NULL,
  "cost_category_id" uuid,
  "label" text,
  "amount" numeric(14,2) DEFAULT 0 NOT NULL,
  "source" import_source DEFAULT 'manuale'::import_source,
  "document_ref" text,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS notification_preferences (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "email_enabled" boolean DEFAULT true,
  "in_app_enabled" boolean DEFAULT true,
  "categories_enabled" text[] DEFAULT ARRAY['scadenza_fiscale'::text, 'scadenza_fornitore'::text, 'anomalia'::text, 'riconciliazione'::text, 'fattura_sdi'::text, 'sistema'::text, 'info'::text],
  "reminder_days_before" integer DEFAULT 7,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS notifications (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "user_id" uuid,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "category" text NOT NULL,
  "severity" text DEFAULT 'info'::text NOT NULL,
  "read" boolean DEFAULT false,
  "read_at" timestamp with time zone,
  "dismissed" boolean DEFAULT false,
  "action_url" text,
  "action_label" text,
  "reference_type" text,
  "reference_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlet_attachments (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "attachment_type" text NOT NULL,
  "label" text NOT NULL,
  "file_name" text,
  "file_path" text,
  "file_size" integer,
  "mime_type" text,
  "is_required" boolean DEFAULT false,
  "is_uploaded" boolean DEFAULT false,
  "extracted_data" jsonb,
  "notes" text,
  "uploaded_by" uuid,
  "uploaded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "uploaded_by_name" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlet_bank_accounts (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "outlet_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "is_primary" boolean DEFAULT false,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlet_cost_template (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "outlet_id" uuid NOT NULL,
  "cost_category_id" uuid NOT NULL,
  "budget_monthly" numeric(14,2),
  "budget_annual" numeric(14,2),
  "is_fixed" boolean DEFAULT true,
  "is_active" boolean DEFAULT true,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlet_simulations (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'bozza'::text,
  "cost_edits" jsonb DEFAULT '{}'::jsonb,
  "rev_edits" jsonb DEFAULT '{}'::jsonb,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlet_suppliers (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "outlet_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "is_active" boolean DEFAULT true,
  "default_payment_method" payment_method,
  "default_payment_terms" integer,
  "avg_monthly_volume" numeric(14,2),
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS outlets (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text,
  "address" text,
  "city" text,
  "province" text,
  "region" text,
  "sqm" numeric(10,2),
  "opening_date" date,
  "closing_date" date,
  "outlet_type" text DEFAULT 'outlet'::text,
  "mall_name" text,
  "mall_manager" text,
  "target_revenue_year1" numeric(14,2),
  "target_revenue_year2" numeric(14,2),
  "target_revenue_steady" numeric(14,2),
  "target_margin_pct" numeric(5,2) DEFAULT 60,
  "target_cogs_pct" numeric(5,2) DEFAULT 40,
  "min_revenue_target" numeric(14,2),
  "min_revenue_period" text,
  "rent_monthly" numeric(12,2),
  "condo_marketing_monthly" numeric(12,2),
  "staff_budget_monthly" numeric(14,2),
  "admin_cost_monthly" numeric(14,2),
  "setup_cost" numeric(14,2),
  "deposit_amount" numeric(14,2),
  "bp_status" text DEFAULT 'bozza'::text,
  "photo_url" text,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "sell_sqm" numeric(10,2),
  "unit_code" text,
  "brand" text,
  "concedente" text,
  "contract_start" date,
  "contract_end" date,
  "contract_duration_months" integer,
  "contract_min_months" integer,
  "delivery_date" date,
  "opening_confirmed" boolean DEFAULT false,
  "rent_annual" numeric(14,2),
  "rent_per_sqm" numeric(10,2),
  "rent_free_days" integer DEFAULT 0,
  "variable_rent_pct" numeric(5,2),
  "deposit_guarantee" numeric(14,2),
  "advance_payment" numeric(14,2),
  "rent_year2_annual" numeric(14,2),
  "rent_year3_annual" numeric(14,2),
  "exit_clause_month" integer,
  "exit_revenue_threshold" numeric(14,2),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payable_actions (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "payable_id" uuid NOT NULL,
  "action_type" text NOT NULL,
  "old_status" payable_status,
  "new_status" payable_status,
  "old_due_date" date,
  "new_due_date" date,
  "amount" numeric(14,2),
  "bank_account_id" uuid,
  "payment_method" payment_method,
  "note" text,
  "performed_by" uuid,
  "performed_at" timestamp with time zone DEFAULT now(),
  "operator_name" text,
  "requested_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payables (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "supplier_id" uuid,
  "invoice_number" text NOT NULL,
  "invoice_date" date NOT NULL,
  "due_date" date NOT NULL,
  "original_due_date" date,
  "postponed_to" date,
  "postpone_count" integer DEFAULT 0,
  "net_amount" numeric(14,2) DEFAULT 0,
  "vat_amount" numeric(14,2) DEFAULT 0,
  "gross_amount" numeric(14,2) NOT NULL,
  "amount_paid" numeric(14,2) DEFAULT 0,
  "amount_remaining" numeric(14,2),
  "cost_category_id" uuid,
  "payment_method" payment_method,
  "status" payable_status DEFAULT 'da_pagare'::payable_status,
  "priority" integer DEFAULT 0,
  "suspend_reason" text,
  "suspend_date" date,
  "resolved_date" date,
  "resolved_by" uuid,
  "electronic_invoice_id" uuid,
  "import_batch_id" uuid,
  "payment_date" date,
  "payment_bank_account_id" uuid,
  "cash_movement_id" uuid,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "parent_payable_id" uuid,
  "payment_method_code" text,
  "payment_method_label" text,
  "installment_number" integer,
  "installment_total" integer,
  "iban" text,
  "previous_status" payable_status,
  "verified" boolean DEFAULT false,
  "verified_at" timestamp with time zone,
  "verified_by" uuid,
  "supplier_name" text,
  "supplier_vat" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payment_batch_items (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "batch_id" uuid NOT NULL,
  "company_id" uuid NOT NULL,
  "invoice_id" uuid,
  "payable_id" uuid,
  "beneficiary_name" text NOT NULL,
  "beneficiary_iban" text,
  "amount" numeric(15,2) NOT NULL,
  "currency" text DEFAULT 'EUR'::text,
  "payment_reason" text,
  "invoice_number" text,
  "invoice_date" date,
  "due_date" date,
  "priority" integer DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "executed_at" timestamp with time zone,
  "execution_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payment_batches (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "bank_account_id" uuid NOT NULL,
  "batch_number" text NOT NULL,
  "status" text DEFAULT 'draft'::text,
  "total_amount" numeric(15,2) DEFAULT 0,
  "payment_count" integer DEFAULT 0,
  "balance_before" numeric(15,2),
  "balance_after" numeric(15,2),
  "notes" text,
  "sent_to_email" text,
  "sent_at" timestamp with time zone,
  "executed_at" timestamp with time zone,
  "executed_by" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payment_records (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "payable_id" uuid NOT NULL,
  "payment_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "bank_account_id" uuid,
  "cash_movement_id" uuid,
  "payment_method" payment_method,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS payment_schedule (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  "invoice_id" uuid,
  "installment_number" integer DEFAULT 1,
  "due_date" date NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "payment_method" text,
  "status" text DEFAULT 'pending'::text,
  "paid_amount" numeric(14,2) DEFAULT 0,
  "paid_date" date,
  "bank_account_id" uuid,
  "bank_reference" text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS pos_imports (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "file_format" text,
  "period_from" date,
  "period_to" date,
  "records_count" integer DEFAULT 0,
  "status" text DEFAULT 'uploaded'::text,
  "error_message" text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS receipt_imports (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "outlet_id" uuid,
  "file_name" text NOT NULL,
  "file_path" text,
  "file_size" bigint,
  "file_format" text,
  "period_from" date,
  "period_to" date,
  "records_count" integer DEFAULT 0,
  "status" text DEFAULT 'uploaded'::text,
  "error_message" text,
  "uploaded_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS reconciliation_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "cash_movement_id" uuid,
  "payable_id" uuid,
  "match_type" text NOT NULL,
  "confidence" numeric(5,2),
  "match_details" jsonb DEFAULT '{}'::jsonb,
  "performed_by" uuid,
  "performed_at" timestamp with time zone DEFAULT now(),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "previous_payable_status" text,
  "new_payable_status" text,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS reconciliation_rejected_pairs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "cash_movement_id" uuid NOT NULL,
  "payable_id" uuid NOT NULL,
  "rejected_at" timestamp with time zone DEFAULT now(),
  "rejected_by" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS recurring_costs (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "cost_center" text NOT NULL,
  "cost_category_id" uuid,
  "description" text NOT NULL,
  "amount" numeric DEFAULT 0 NOT NULL,
  "frequency" text DEFAULT 'monthly'::text NOT NULL,
  "day_of_month" integer DEFAULT 1,
  "month_start" integer DEFAULT 1,
  "start_date" date,
  "end_date" date,
  "payment_method" text DEFAULT 'bonifico_ordinario'::text,
  "supplier_name" text,
  "is_active" boolean DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS sdi_config (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "channel_type" text DEFAULT 'WEBSERVICE'::text,
  "codice_fiscale_trasmittente" text NOT NULL,
  "codice_sdi" text,
  "pec_ricezione" text,
  "ssl_cert_secret_name" text,
  "ssl_key_secret_name" text,
  "endpoint_url" text,
  "environment" text DEFAULT 'TEST'::text,
  "accreditation_status" text DEFAULT 'PENDING'::text,
  "last_test_at" timestamp with time zone,
  "activated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "progressivo_invio" integer DEFAULT 0,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS sdi_sync_log (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "trigger" text NOT NULL,
  "triggered_by" text,
  "date_from" date,
  "date_to" date,
  "fatture_count" integer DEFAULT 0,
  "corrispettivi_count" integer DEFAULT 0,
  "errors" jsonb,
  "duration_ms" integer,
  "status" text DEFAULT 'success'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS supplier_allocation_details (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "rule_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "percentage" numeric(5,2),
  "fixed_value" numeric(15,2),
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS supplier_allocation_rules (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "allocation_mode" text NOT NULL,
  "description" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS suppliers (
  "id" uuid DEFAULT uuid_generate_v4() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "vat_number" text,
  "fiscal_code" text,
  "iban" text,
  "default_payment_terms" integer DEFAULT 30,
  "default_payment_method" payment_method DEFAULT 'bonifico_ordinario'::payment_method,
  "category" text,
  "notes" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "ragione_sociale" text,
  "partita_iva" text,
  "codice_fiscale" text,
  "codice_sdi" text,
  "pec" text,
  "indirizzo" text,
  "citta" text,
  "provincia" text,
  "cap" text,
  "telefono" text,
  "email" text,
  "payment_terms" integer DEFAULT 30,
  "payment_method" text DEFAULT 'bonifico'::text,
  "cost_center" text DEFAULT 'all'::text,
  "note" text,
  "is_deleted" boolean DEFAULT false,
  "comune" text,
  "paese" text,
  "nazione" text DEFAULT 'IT'::text,
  "regime_fiscale" text,
  "source" text DEFAULT 'manual'::text,
  "default_cost_category_id" uuid,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS user_outlet_access (
  "user_id" uuid NOT NULL,
  "outlet_id" uuid NOT NULL,
  "can_write" boolean DEFAULT false,
  "company_id" uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid NOT NULL,
  PRIMARY KEY ("user_id", "outlet_id")
);

CREATE TABLE IF NOT EXISTS user_profiles (
  "id" uuid NOT NULL,
  "company_id" uuid,
  "role" user_role NOT NULL,
  "first_name" text,
  "last_name" text,
  "email" text,
  "phone" text,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS yapily_accounts (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "consent_id" uuid NOT NULL,
  "yapily_account_id" text NOT NULL,
  "account_type" text,
  "account_name" text,
  "iban" text,
  "currency" text DEFAULT 'EUR'::text,
  "institution_id" text NOT NULL,
  "bank_account_id" uuid,
  "balance" numeric(15,2),
  "balance_updated_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone,
  "is_active" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS yapily_consents (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "institution_id" text NOT NULL,
  "institution_name" text NOT NULL,
  "consent_token" text NOT NULL,
  "consent_type" text NOT NULL,
  "status" text DEFAULT 'PENDING'::text,
  "expires_at" timestamp with time zone,
  "max_historical_days" integer DEFAULT 90,
  "user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS yapily_payments (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "consent_id" uuid,
  "payable_id" uuid,
  "idempotency_key" uuid DEFAULT gen_random_uuid(),
  "amount" numeric(15,2) NOT NULL,
  "currency" text DEFAULT 'EUR'::text,
  "creditor_name" text NOT NULL,
  "creditor_iban" text NOT NULL,
  "reference" text,
  "payment_type" text DEFAULT 'DOMESTIC_SINGLE'::text,
  "status" text DEFAULT 'PENDING'::text,
  "yapily_payment_id" text,
  "initiated_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone,
  "error_details" jsonb,
  PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS yapily_transactions (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "yapily_account_id" uuid NOT NULL,
  "transaction_id" text NOT NULL,
  "date" date NOT NULL,
  "booking_date" date,
  "amount" numeric(15,2) NOT NULL,
  "currency" text DEFAULT 'EUR'::text,
  "description" text,
  "reference" text,
  "merchant_name" text,
  "category" text,
  "status" text,
  "balance_after" numeric(15,2),
  "raw_data" jsonb,
  "cash_movement_id" uuid,
  "reconciled" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  PRIMARY KEY ("id")
);

DO $do$ BEGIN
  ALTER TABLE annual_budgets ADD CONSTRAINT annual_budgets_company_id_outlet_id_year_key UNIQUE (company_id, outlet_id, year);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE app_config ADD CONSTRAINT app_config_company_id_key UNIQUE (company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE app_users ADD CONSTRAINT app_users_company_id_email_key UNIQUE (company_id, email);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE bank_balances ADD CONSTRAINT bank_balances_bank_account_id_date_key UNIQUE (bank_account_id, date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_confronto ADD CONSTRAINT budget_confronto_company_id_cost_center_account_code_year_m_key UNIQUE (company_id, cost_center, account_code, year, month, entry_type);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_cost_lines ADD CONSTRAINT budget_cost_lines_budget_id_cost_category_id_key UNIQUE (budget_id, cost_category_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_entries ADD CONSTRAINT budget_entries_company_id_account_code_cost_center_year_mon_key UNIQUE (company_id, account_code, cost_center, year, month);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE cash_budget ADD CONSTRAINT cash_budget_company_id_year_month_key UNIQUE (company_id, year, month);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE chart_of_accounts ADD CONSTRAINT chart_of_accounts_company_id_code_key UNIQUE (company_id, code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE companies ADD CONSTRAINT companies_vat_number_key UNIQUE (vat_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE company_settings ADD CONSTRAINT company_settings_company_id_key UNIQUE (company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE corrispettivi_log ADD CONSTRAINT corrispettivi_log_company_id_outlet_id_date_key UNIQUE (company_id, outlet_id, date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE cost_categories ADD CONSTRAINT cost_categories_company_id_code_key UNIQUE (company_id, code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE cost_centers ADD CONSTRAINT cost_centers_company_id_code_key UNIQUE (company_id, code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE daily_receipts_ade ADD CONSTRAINT daily_receipts_ade_company_id_outlet_id_date_device_serial_key UNIQUE (company_id, outlet_id, date, device_serial);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE daily_revenue ADD CONSTRAINT daily_revenue_company_id_outlet_id_date_key UNIQUE (company_id, outlet_id, date);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE employee_costs ADD CONSTRAINT employee_costs_employee_id_year_month_key UNIQUE (employee_id, year, month);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE loan_tranches ADD CONSTRAINT loan_tranches_loan_id_tranche_number_key UNIQUE (loan_id, tranche_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE monthly_actuals ADD CONSTRAINT monthly_actuals_company_id_outlet_id_year_month_key UNIQUE (company_id, outlet_id, year, month);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_company_id_key UNIQUE (user_id, company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE outlet_bank_accounts ADD CONSTRAINT outlet_bank_accounts_outlet_id_bank_account_id_key UNIQUE (outlet_id, bank_account_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE outlet_cost_template ADD CONSTRAINT outlet_cost_template_outlet_id_cost_category_id_key UNIQUE (outlet_id, cost_category_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE outlet_suppliers ADD CONSTRAINT outlet_suppliers_outlet_id_supplier_id_key UNIQUE (outlet_id, supplier_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE outlets ADD CONSTRAINT outlets_company_id_code_key UNIQUE (company_id, code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_company_id_supplier_id_invoice_number_key UNIQUE (company_id, supplier_id, invoice_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE reconciliation_rejected_pairs ADD CONSTRAINT reconciliation_rejected_pairs_cash_movement_id_payable_id_key UNIQUE (cash_movement_id, payable_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_config ADD CONSTRAINT sdi_config_company_id_key UNIQUE (company_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE supplier_allocation_details ADD CONSTRAINT supplier_allocation_details_rule_id_outlet_id_key UNIQUE (rule_id, outlet_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE supplier_allocation_rules ADD CONSTRAINT supplier_allocation_rules_company_id_supplier_id_is_active_key UNIQUE (company_id, supplier_id, is_active);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE suppliers ADD CONSTRAINT suppliers_company_id_vat_number_key UNIQUE (company_id, vat_number);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE active_invoices ADD CONSTRAINT active_invoices_sdi_status_check CHECK ((sdi_status = ANY (ARRAY['DRAFT'::text, 'SENT'::text, 'DELIVERED'::text, 'REJECTED'::text, 'DEPOSITED'::text, 'ACCEPTED'::text, 'ERROR'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE active_invoices ADD CONSTRAINT active_invoices_tipo_documento_check CHECK ((tipo_documento = ANY (ARRAY['TD01'::text, 'TD02'::text, 'TD04'::text, 'TD05'::text, 'TD06'::text, 'TD24'::text, 'TD25'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ai_anomaly_log ADD CONSTRAINT ai_anomaly_log_anomaly_type_check CHECK ((anomaly_type = ANY (ARRAY['duplicate'::text, 'unusual_amount'::text, 'unusual_frequency'::text, 'missing_category'::text, 'date_anomaly'::text, 'counterpart_mismatch'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ai_anomaly_log ADD CONSTRAINT ai_anomaly_log_entity_type_check CHECK ((entity_type = ANY (ARRAY['cash_movement'::text, 'electronic_invoice'::text, 'active_invoice'::text, 'payable'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ai_anomaly_log ADD CONSTRAINT ai_anomaly_log_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE ai_categorization_rules ADD CONSTRAINT ai_categorization_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['counterpart'::text, 'description_pattern'::text, 'amount_range'::text, 'combined'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE app_config ADD CONSTRAINT app_config_yapily_environment_check CHECK ((yapily_environment = ANY (ARRAY['SANDBOX'::text, 'PRODUCTION'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE bank_statements ADD CONSTRAINT bank_statements_file_type_check CHECK ((file_type = ANY (ARRAY['csv'::text, 'xlsx'::text, 'pdf'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE bank_statements ADD CONSTRAINT bank_statements_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'error'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_approval_log ADD CONSTRAINT budget_approval_log_action_check CHECK ((action = ANY (ARRAY['approve'::text, 'unlock'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_confronto ADD CONSTRAINT budget_confronto_entry_type_check CHECK ((entry_type = ANY (ARRAY['consuntivo'::text, 'rettifica'::text, 'prev_monthly'::text, 'rev_monthly'::text, 'cons_monthly'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE budget_entries ADD CONSTRAINT budget_entries_month_check CHECK (((month >= 1) AND (month <= 12)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE cash_budget ADD CONSTRAINT cash_budget_month_check CHECK (((month >= 1) AND (month <= 12)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_ai_method_check CHECK ((ai_method = ANY (ARRAY['keyword'::text, 'pattern'::text, 'learned'::text, 'manual'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE corrispettivi_log ADD CONSTRAINT corrispettivi_log_submission_status_check CHECK ((submission_status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'ERROR'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE documents ADD CONSTRAINT documents_retention_status_check CHECK ((retention_status = ANY (ARRAY['active'::text, 'archived'::text, 'expired'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_retention_status_check CHECK ((retention_status = ANY (ARRAY['active'::text, 'archived'::text, 'expired'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_sdi_status_check CHECK ((sdi_status = ANY (ARRAY['RECEIVED'::text, 'ACCEPTED'::text, 'REJECTED'::text, 'PENDING'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE employee_costs ADD CONSTRAINT employee_costs_month_check CHECK (((month >= 1) AND (month <= 12)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_deadline_type_check CHECK ((deadline_type = ANY (ARRAY['f24'::text, 'iva_periodica'::text, 'iva_annuale'::text, 'inps'::text, 'irpef'::text, 'irap'::text, 'ires'::text, 'ritenute_acconto'::text, 'contributi_inail'::text, 'diritto_camerale'::text, 'imu'::text, 'tari'::text, 'bollo_auto'::text, 'dichiarazione_redditi'::text, 'bilancio_deposito'::text, 'lipe'::text, 'esterometro'::text, 'intrastat'::text, 'cu_certificazione'::text, 'altro'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_recurrence_day_check CHECK ((((recurrence_day >= 1) AND (recurrence_day <= 31)) OR (recurrence_day IS NULL)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_recurrence_rule_check CHECK ((recurrence_rule = ANY (ARRAY['monthly'::text, 'quarterly'::text, 'semiannual'::text, 'annual'::text, NULL::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'upcoming'::text, 'overdue'::text, 'paid'::text, 'cancelled'::text, 'deferred'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE monthly_actuals ADD CONSTRAINT monthly_actuals_month_check CHECK (((month >= 1) AND (month <= 12)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['scadenza_fiscale'::text, 'scadenza_fornitore'::text, 'anomalia'::text, 'riconciliazione'::text, 'fattura_sdi'::text, 'sistema'::text, 'info'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE outlet_simulations ADD CONSTRAINT outlet_simulations_status_check CHECK ((status = ANY (ARRAY['bozza'::text, 'approvato'::text, 'archiviato'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE payment_batch_items ADD CONSTRAINT payment_batch_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'executed'::text, 'failed'::text, 'skipped'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'confirmed'::text, 'sent'::text, 'partially_executed'::text, 'executed'::text, 'cancelled'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (100)::numeric)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_match_type_check CHECK ((match_type = ANY (ARRAY['auto_exact'::text, 'auto_fuzzy'::text, 'manual'::text, 'unlinked'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE recurring_costs ADD CONSTRAINT recurring_costs_day_of_month_check CHECK (((day_of_month >= 1) AND (day_of_month <= 28)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE recurring_costs ADD CONSTRAINT recurring_costs_frequency_check CHECK ((frequency = ANY (ARRAY['monthly'::text, 'bimonthly'::text, 'quarterly'::text, 'semiannual'::text, 'annual'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE recurring_costs ADD CONSTRAINT recurring_costs_month_start_check CHECK (((month_start >= 1) AND (month_start <= 12)));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_config ADD CONSTRAINT sdi_config_accreditation_status_check CHECK ((accreditation_status = ANY (ARRAY['PENDING'::text, 'TESTING'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'SUSPENDED'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_config ADD CONSTRAINT sdi_config_channel_type_check CHECK ((channel_type = ANY (ARRAY['WEBSERVICE'::text, 'PEC'::text, 'FTP'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_config ADD CONSTRAINT sdi_config_environment_check CHECK ((environment = ANY (ARRAY['TEST'::text, 'PRODUCTION'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_sync_log ADD CONSTRAINT sdi_sync_log_status_check CHECK ((status = ANY (ARRAY['success'::text, 'partial'::text, 'error'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE sdi_sync_log ADD CONSTRAINT sdi_sync_log_trigger_check CHECK ((trigger = ANY (ARRAY['manual'::text, 'scheduled'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE supplier_allocation_rules ADD CONSTRAINT supplier_allocation_rules_allocation_mode_check CHECK ((allocation_mode = ANY (ARRAY['DIRETTO'::text, 'SPLIT_PCT'::text, 'SPLIT_VALORE'::text, 'QUOTE_UGUALI'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE yapily_consents ADD CONSTRAINT yapily_consents_consent_type_check CHECK ((consent_type = ANY (ARRAY['AIS'::text, 'PIS'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE yapily_consents ADD CONSTRAINT yapily_consents_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'AUTHORIZED'::text, 'EXPIRED'::text, 'REVOKED'::text, 'REJECTED'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE yapily_payments ADD CONSTRAINT yapily_payments_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'AUTHORIZED'::text, 'COMPLETED'::text, 'FAILED'::text, 'REJECTED'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

DO $do$ BEGIN
  ALTER TABLE yapily_transactions ADD CONSTRAINT yapily_transactions_status_check CHECK ((status = ANY (ARRAY['BOOKED'::text, 'PENDING'::text])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK active_invoices_company_id_fkey on active_invoices
DO $do$ BEGIN
  ALTER TABLE active_invoices ADD CONSTRAINT active_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK active_invoices_outlet_id_fkey on active_invoices
DO $do$ BEGIN
  ALTER TABLE active_invoices ADD CONSTRAINT active_invoices_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK ai_anomaly_log_company_id_fkey on ai_anomaly_log
DO $do$ BEGIN
  ALTER TABLE ai_anomaly_log ADD CONSTRAINT ai_anomaly_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK ai_categorization_rules_category_id_fkey on ai_categorization_rules
DO $do$ BEGIN
  ALTER TABLE ai_categorization_rules ADD CONSTRAINT ai_categorization_rules_category_id_fkey FOREIGN KEY (category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK ai_categorization_rules_company_id_fkey on ai_categorization_rules
DO $do$ BEGIN
  ALTER TABLE ai_categorization_rules ADD CONSTRAINT ai_categorization_rules_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK annual_budgets_company_id_fkey on annual_budgets
DO $do$ BEGIN
  ALTER TABLE annual_budgets ADD CONSTRAINT annual_budgets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK annual_budgets_outlet_id_fkey on annual_budgets
DO $do$ BEGIN
  ALTER TABLE annual_budgets ADD CONSTRAINT annual_budgets_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK app_config_company_id_fkey on app_config
DO $do$ BEGIN
  ALTER TABLE app_config ADD CONSTRAINT app_config_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_accounts_company_id_fkey on bank_accounts
DO $do$ BEGIN
  ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_accounts_outlet_id_fkey on bank_accounts
DO $do$ BEGIN
  ALTER TABLE bank_accounts ADD CONSTRAINT bank_accounts_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_balances_bank_account_id_fkey on bank_balances
DO $do$ BEGIN
  ALTER TABLE bank_balances ADD CONSTRAINT bank_balances_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_statements_bank_account_id_fkey on bank_statements
DO $do$ BEGIN
  ALTER TABLE bank_statements ADD CONSTRAINT bank_statements_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_statements_company_id_fkey on bank_statements
DO $do$ BEGIN
  ALTER TABLE bank_statements ADD CONSTRAINT bank_statements_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_statements_uploaded_by_fkey on bank_statements
DO $do$ BEGIN
  ALTER TABLE bank_statements ADD CONSTRAINT bank_statements_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK bank_transactions_account_id_fkey on bank_transactions
DO $do$ BEGIN
  ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES yapily_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK fk_bt_statement on bank_transactions
DO $do$ BEGIN
  ALTER TABLE bank_transactions ADD CONSTRAINT fk_bt_statement FOREIGN KEY (statement_id) REFERENCES bank_statements(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK budget_confronto_company_id_fkey on budget_confronto
DO $do$ BEGIN
  ALTER TABLE budget_confronto ADD CONSTRAINT budget_confronto_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK budget_cost_lines_budget_id_fkey on budget_cost_lines
DO $do$ BEGIN
  ALTER TABLE budget_cost_lines ADD CONSTRAINT budget_cost_lines_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES annual_budgets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK budget_cost_lines_cost_category_id_fkey on budget_cost_lines
DO $do$ BEGIN
  ALTER TABLE budget_cost_lines ADD CONSTRAINT budget_cost_lines_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_budget_company_id_fkey on cash_budget
DO $do$ BEGIN
  ALTER TABLE cash_budget ADD CONSTRAINT cash_budget_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_ai_category_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_ai_category_id_fkey FOREIGN KEY (ai_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_bank_account_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_company_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_cost_category_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_outlet_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_reconciled_by_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_reconciled_by_fkey FOREIGN KEY (reconciled_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cash_movements_yapily_transaction_id_fkey on cash_movements
DO $do$ BEGIN
  ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_yapily_transaction_id_fkey FOREIGN KEY (yapily_transaction_id) REFERENCES yapily_transactions(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contract_amount_history_contract_id_fkey on contract_amount_history
DO $do$ BEGIN
  ALTER TABLE contract_amount_history ADD CONSTRAINT contract_amount_history_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contract_deadlines_completed_by_fkey on contract_deadlines
DO $do$ BEGIN
  ALTER TABLE contract_deadlines ADD CONSTRAINT contract_deadlines_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contract_deadlines_contract_id_fkey on contract_deadlines
DO $do$ BEGIN
  ALTER TABLE contract_deadlines ADD CONSTRAINT contract_deadlines_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contract_documents_contract_id_fkey on contract_documents
DO $do$ BEGIN
  ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contracts_company_id_fkey on contracts
DO $do$ BEGIN
  ALTER TABLE contracts ADD CONSTRAINT contracts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contracts_cost_category_id_fkey on contracts
DO $do$ BEGIN
  ALTER TABLE contracts ADD CONSTRAINT contracts_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK contracts_outlet_id_fkey on contracts
DO $do$ BEGIN
  ALTER TABLE contracts ADD CONSTRAINT contracts_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK corrispettivi_log_company_id_fkey on corrispettivi_log
DO $do$ BEGIN
  ALTER TABLE corrispettivi_log ADD CONSTRAINT corrispettivi_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK corrispettivi_log_outlet_id_fkey on corrispettivi_log
DO $do$ BEGIN
  ALTER TABLE corrispettivi_log ADD CONSTRAINT corrispettivi_log_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cost_categories_company_id_fkey on cost_categories
DO $do$ BEGIN
  ALTER TABLE cost_categories ADD CONSTRAINT cost_categories_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK cost_categories_parent_id_fkey on cost_categories
DO $do$ BEGIN
  ALTER TABLE cost_categories ADD CONSTRAINT cost_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES cost_categories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK csv_mappings_company_id_fkey on csv_mappings
DO $do$ BEGIN
  ALTER TABLE csv_mappings ADD CONSTRAINT csv_mappings_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_receipts_ade_company_id_fkey on daily_receipts_ade
DO $do$ BEGIN
  ALTER TABLE daily_receipts_ade ADD CONSTRAINT daily_receipts_ade_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_receipts_ade_daily_revenue_id_fkey on daily_receipts_ade
DO $do$ BEGIN
  ALTER TABLE daily_receipts_ade ADD CONSTRAINT daily_receipts_ade_daily_revenue_id_fkey FOREIGN KEY (daily_revenue_id) REFERENCES daily_revenue(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_receipts_ade_import_batch_id_fkey on daily_receipts_ade
DO $do$ BEGIN
  ALTER TABLE daily_receipts_ade ADD CONSTRAINT daily_receipts_ade_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_receipts_ade_outlet_id_fkey on daily_receipts_ade
DO $do$ BEGIN
  ALTER TABLE daily_receipts_ade ADD CONSTRAINT daily_receipts_ade_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_revenue_company_id_fkey on daily_revenue
DO $do$ BEGIN
  ALTER TABLE daily_revenue ADD CONSTRAINT daily_revenue_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_revenue_import_batch_id_fkey on daily_revenue
DO $do$ BEGIN
  ALTER TABLE daily_revenue ADD CONSTRAINT daily_revenue_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK daily_revenue_outlet_id_fkey on daily_revenue
DO $do$ BEGIN
  ALTER TABLE daily_revenue ADD CONSTRAINT daily_revenue_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK document_versions_company_id_fkey on document_versions
DO $do$ BEGIN
  ALTER TABLE document_versions ADD CONSTRAINT document_versions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_cash_movement_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_company_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_cost_category_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_import_batch_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_monthly_cost_line_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_monthly_cost_line_id_fkey FOREIGN KEY (monthly_cost_line_id) REFERENCES monthly_cost_lines(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK electronic_invoices_outlet_id_fkey on electronic_invoices
DO $do$ BEGIN
  ALTER TABLE electronic_invoices ADD CONSTRAINT electronic_invoices_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK employee_outlet_allocations_company_id_fkey on employee_outlet_allocations
DO $do$ BEGIN
  ALTER TABLE employee_outlet_allocations ADD CONSTRAINT employee_outlet_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK employees_company_id_fkey on employees
DO $do$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK employees_outlet_id_fkey on employees
DO $do$ BEGIN
  ALTER TABLE employees ADD CONSTRAINT employees_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK fiscal_deadlines_company_id_fkey on fiscal_deadlines
DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK fiscal_deadlines_created_by_fkey on fiscal_deadlines
DO $do$ BEGIN
  ALTER TABLE fiscal_deadlines ADD CONSTRAINT fiscal_deadlines_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK import_batches_bank_account_id_fkey on import_batches
DO $do$ BEGIN
  ALTER TABLE import_batches ADD CONSTRAINT import_batches_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK import_batches_company_id_fkey on import_batches
DO $do$ BEGIN
  ALTER TABLE import_batches ADD CONSTRAINT import_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK import_batches_imported_by_fkey on import_batches
DO $do$ BEGIN
  ALTER TABLE import_batches ADD CONSTRAINT import_batches_imported_by_fkey FOREIGN KEY (imported_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK import_batches_outlet_id_fkey on import_batches
DO $do$ BEGIN
  ALTER TABLE import_batches ADD CONSTRAINT import_batches_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK loan_tranches_loan_id_fkey on loan_tranches
DO $do$ BEGIN
  ALTER TABLE loan_tranches ADD CONSTRAINT loan_tranches_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK loans_company_id_fkey on loans
DO $do$ BEGIN
  ALTER TABLE loans ADD CONSTRAINT loans_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK manual_balance_entries_bank_account_id_fkey on manual_balance_entries
DO $do$ BEGIN
  ALTER TABLE manual_balance_entries ADD CONSTRAINT manual_balance_entries_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK manual_balance_entries_company_id_fkey on manual_balance_entries
DO $do$ BEGIN
  ALTER TABLE manual_balance_entries ADD CONSTRAINT manual_balance_entries_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK manual_balance_entries_entered_by_fkey on manual_balance_entries
DO $do$ BEGIN
  ALTER TABLE manual_balance_entries ADD CONSTRAINT manual_balance_entries_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK monthly_actuals_closed_by_fkey on monthly_actuals
DO $do$ BEGIN
  ALTER TABLE monthly_actuals ADD CONSTRAINT monthly_actuals_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK monthly_actuals_company_id_fkey on monthly_actuals
DO $do$ BEGIN
  ALTER TABLE monthly_actuals ADD CONSTRAINT monthly_actuals_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK monthly_actuals_outlet_id_fkey on monthly_actuals
DO $do$ BEGIN
  ALTER TABLE monthly_actuals ADD CONSTRAINT monthly_actuals_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK monthly_cost_lines_cost_category_id_fkey on monthly_cost_lines
DO $do$ BEGIN
  ALTER TABLE monthly_cost_lines ADD CONSTRAINT monthly_cost_lines_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK monthly_cost_lines_monthly_actual_id_fkey on monthly_cost_lines
DO $do$ BEGIN
  ALTER TABLE monthly_cost_lines ADD CONSTRAINT monthly_cost_lines_monthly_actual_id_fkey FOREIGN KEY (monthly_actual_id) REFERENCES monthly_actuals(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK notification_preferences_company_id_fkey on notification_preferences
DO $do$ BEGIN
  ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK notification_preferences_user_id_fkey on notification_preferences
DO $do$ BEGIN
  ALTER TABLE notification_preferences ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK notifications_company_id_fkey on notifications
DO $do$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK notifications_user_id_fkey on notifications
DO $do$ BEGIN
  ALTER TABLE notifications ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_attachments_company_id_fkey on outlet_attachments
DO $do$ BEGIN
  ALTER TABLE outlet_attachments ADD CONSTRAINT outlet_attachments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_attachments_outlet_id_fkey on outlet_attachments
DO $do$ BEGIN
  ALTER TABLE outlet_attachments ADD CONSTRAINT outlet_attachments_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_attachments_uploaded_by_fkey on outlet_attachments
DO $do$ BEGIN
  ALTER TABLE outlet_attachments ADD CONSTRAINT outlet_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_bank_accounts_bank_account_id_fkey on outlet_bank_accounts
DO $do$ BEGIN
  ALTER TABLE outlet_bank_accounts ADD CONSTRAINT outlet_bank_accounts_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_bank_accounts_outlet_id_fkey on outlet_bank_accounts
DO $do$ BEGIN
  ALTER TABLE outlet_bank_accounts ADD CONSTRAINT outlet_bank_accounts_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_cost_template_cost_category_id_fkey on outlet_cost_template
DO $do$ BEGIN
  ALTER TABLE outlet_cost_template ADD CONSTRAINT outlet_cost_template_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_cost_template_outlet_id_fkey on outlet_cost_template
DO $do$ BEGIN
  ALTER TABLE outlet_cost_template ADD CONSTRAINT outlet_cost_template_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_simulations_company_id_fkey on outlet_simulations
DO $do$ BEGIN
  ALTER TABLE outlet_simulations ADD CONSTRAINT outlet_simulations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_simulations_created_by_fkey on outlet_simulations
DO $do$ BEGIN
  ALTER TABLE outlet_simulations ADD CONSTRAINT outlet_simulations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_suppliers_outlet_id_fkey on outlet_suppliers
DO $do$ BEGIN
  ALTER TABLE outlet_suppliers ADD CONSTRAINT outlet_suppliers_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlet_suppliers_supplier_id_fkey on outlet_suppliers
DO $do$ BEGIN
  ALTER TABLE outlet_suppliers ADD CONSTRAINT outlet_suppliers_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK outlets_company_id_fkey on outlets
DO $do$ BEGIN
  ALTER TABLE outlets ADD CONSTRAINT outlets_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payable_actions_bank_account_id_fkey on payable_actions
DO $do$ BEGIN
  ALTER TABLE payable_actions ADD CONSTRAINT payable_actions_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payable_actions_payable_id_fkey on payable_actions
DO $do$ BEGIN
  ALTER TABLE payable_actions ADD CONSTRAINT payable_actions_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payable_actions_performed_by_fkey on payable_actions
DO $do$ BEGIN
  ALTER TABLE payable_actions ADD CONSTRAINT payable_actions_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_cash_movement_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_company_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_cost_category_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_electronic_invoice_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_electronic_invoice_id_fkey FOREIGN KEY (electronic_invoice_id) REFERENCES electronic_invoices(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_import_batch_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_outlet_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_parent_payable_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_parent_payable_id_fkey FOREIGN KEY (parent_payable_id) REFERENCES payables(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_payment_bank_account_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_payment_bank_account_id_fkey FOREIGN KEY (payment_bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_resolved_by_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES user_profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_supplier_id_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payables_verified_by_fkey on payables
DO $do$ BEGIN
  ALTER TABLE payables ADD CONSTRAINT payables_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batch_items_batch_id_fkey on payment_batch_items
DO $do$ BEGIN
  ALTER TABLE payment_batch_items ADD CONSTRAINT payment_batch_items_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES payment_batches(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batch_items_company_id_fkey on payment_batch_items
DO $do$ BEGIN
  ALTER TABLE payment_batch_items ADD CONSTRAINT payment_batch_items_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batches_bank_account_id_fkey on payment_batches
DO $do$ BEGIN
  ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batches_company_id_fkey on payment_batches
DO $do$ BEGIN
  ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batches_created_by_fkey on payment_batches
DO $do$ BEGIN
  ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_batches_executed_by_fkey on payment_batches
DO $do$ BEGIN
  ALTER TABLE payment_batches ADD CONSTRAINT payment_batches_executed_by_fkey FOREIGN KEY (executed_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_records_bank_account_id_fkey on payment_records
DO $do$ BEGIN
  ALTER TABLE payment_records ADD CONSTRAINT payment_records_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_records_cash_movement_id_fkey on payment_records
DO $do$ BEGIN
  ALTER TABLE payment_records ADD CONSTRAINT payment_records_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK payment_records_payable_id_fkey on payment_records
DO $do$ BEGIN
  ALTER TABLE payment_records ADD CONSTRAINT payment_records_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK pos_imports_company_id_fkey on pos_imports
DO $do$ BEGIN
  ALTER TABLE pos_imports ADD CONSTRAINT pos_imports_company_id_fkey FOREIGN KEY (company_id) REFERENCES company_settings(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK pos_imports_outlet_id_fkey on pos_imports
DO $do$ BEGIN
  ALTER TABLE pos_imports ADD CONSTRAINT pos_imports_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES cost_centers(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK receipt_imports_company_id_fkey on receipt_imports
DO $do$ BEGIN
  ALTER TABLE receipt_imports ADD CONSTRAINT receipt_imports_company_id_fkey FOREIGN KEY (company_id) REFERENCES company_settings(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK receipt_imports_outlet_id_fkey on receipt_imports
DO $do$ BEGIN
  ALTER TABLE receipt_imports ADD CONSTRAINT receipt_imports_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES cost_centers(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_log_cash_movement_id_fkey on reconciliation_log
DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_log_company_id_fkey on reconciliation_log
DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_log_payable_id_fkey on reconciliation_log
DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_log_performed_by_fkey on reconciliation_log
DO $do$ BEGIN
  ALTER TABLE reconciliation_log ADD CONSTRAINT reconciliation_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_rejected_pairs_cash_movement_id_fkey on reconciliation_rejected_pairs
DO $do$ BEGIN
  ALTER TABLE reconciliation_rejected_pairs ADD CONSTRAINT reconciliation_rejected_pairs_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_rejected_pairs_company_id_fkey on reconciliation_rejected_pairs
DO $do$ BEGIN
  ALTER TABLE reconciliation_rejected_pairs ADD CONSTRAINT reconciliation_rejected_pairs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_rejected_pairs_payable_id_fkey on reconciliation_rejected_pairs
DO $do$ BEGIN
  ALTER TABLE reconciliation_rejected_pairs ADD CONSTRAINT reconciliation_rejected_pairs_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK reconciliation_rejected_pairs_rejected_by_fkey on reconciliation_rejected_pairs
DO $do$ BEGIN
  ALTER TABLE reconciliation_rejected_pairs ADD CONSTRAINT reconciliation_rejected_pairs_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK recurring_costs_company_id_fkey on recurring_costs
DO $do$ BEGIN
  ALTER TABLE recurring_costs ADD CONSTRAINT recurring_costs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK recurring_costs_cost_category_id_fkey on recurring_costs
DO $do$ BEGIN
  ALTER TABLE recurring_costs ADD CONSTRAINT recurring_costs_cost_category_id_fkey FOREIGN KEY (cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK sdi_config_company_id_fkey on sdi_config
DO $do$ BEGIN
  ALTER TABLE sdi_config ADD CONSTRAINT sdi_config_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK sdi_sync_log_company_id_fkey on sdi_sync_log
DO $do$ BEGIN
  ALTER TABLE sdi_sync_log ADD CONSTRAINT sdi_sync_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK supplier_allocation_details_outlet_id_fkey on supplier_allocation_details
DO $do$ BEGIN
  ALTER TABLE supplier_allocation_details ADD CONSTRAINT supplier_allocation_details_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK supplier_allocation_details_rule_id_fkey on supplier_allocation_details
DO $do$ BEGIN
  ALTER TABLE supplier_allocation_details ADD CONSTRAINT supplier_allocation_details_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES supplier_allocation_rules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK supplier_allocation_rules_supplier_id_fkey on supplier_allocation_rules
DO $do$ BEGIN
  ALTER TABLE supplier_allocation_rules ADD CONSTRAINT supplier_allocation_rules_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK suppliers_company_id_fkey on suppliers
DO $do$ BEGIN
  ALTER TABLE suppliers ADD CONSTRAINT suppliers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK suppliers_default_cost_category_id_fkey on suppliers
DO $do$ BEGIN
  ALTER TABLE suppliers ADD CONSTRAINT suppliers_default_cost_category_id_fkey FOREIGN KEY (default_cost_category_id) REFERENCES cost_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK user_outlet_access_company_id_fkey on user_outlet_access
DO $do$ BEGIN
  ALTER TABLE user_outlet_access ADD CONSTRAINT user_outlet_access_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK user_outlet_access_outlet_id_fkey on user_outlet_access
DO $do$ BEGIN
  ALTER TABLE user_outlet_access ADD CONSTRAINT user_outlet_access_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES outlets(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK user_outlet_access_user_id_fkey on user_outlet_access
DO $do$ BEGIN
  ALTER TABLE user_outlet_access ADD CONSTRAINT user_outlet_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK user_profiles_company_id_fkey on user_profiles
DO $do$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK user_profiles_id_fkey on user_profiles
DO $do$ BEGIN
  ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_accounts_bank_account_id_fkey on yapily_accounts
DO $do$ BEGIN
  ALTER TABLE yapily_accounts ADD CONSTRAINT yapily_accounts_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_accounts_company_id_fkey on yapily_accounts
DO $do$ BEGIN
  ALTER TABLE yapily_accounts ADD CONSTRAINT yapily_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_accounts_consent_id_fkey on yapily_accounts
DO $do$ BEGIN
  ALTER TABLE yapily_accounts ADD CONSTRAINT yapily_accounts_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES yapily_consents(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_consents_company_id_fkey on yapily_consents
DO $do$ BEGIN
  ALTER TABLE yapily_consents ADD CONSTRAINT yapily_consents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_consents_user_id_fkey on yapily_consents
DO $do$ BEGIN
  ALTER TABLE yapily_consents ADD CONSTRAINT yapily_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_payments_company_id_fkey on yapily_payments
DO $do$ BEGIN
  ALTER TABLE yapily_payments ADD CONSTRAINT yapily_payments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_payments_consent_id_fkey on yapily_payments
DO $do$ BEGIN
  ALTER TABLE yapily_payments ADD CONSTRAINT yapily_payments_consent_id_fkey FOREIGN KEY (consent_id) REFERENCES yapily_consents(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_payments_payable_id_fkey on yapily_payments
DO $do$ BEGIN
  ALTER TABLE yapily_payments ADD CONSTRAINT yapily_payments_payable_id_fkey FOREIGN KEY (payable_id) REFERENCES payables(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_transactions_cash_movement_id_fkey on yapily_transactions
DO $do$ BEGIN
  ALTER TABLE yapily_transactions ADD CONSTRAINT yapily_transactions_cash_movement_id_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_transactions_company_id_fkey on yapily_transactions
DO $do$ BEGIN
  ALTER TABLE yapily_transactions ADD CONSTRAINT yapily_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

-- FK yapily_transactions_yapily_account_id_fkey on yapily_transactions
DO $do$ BEGIN
  ALTER TABLE yapily_transactions ADD CONSTRAINT yapily_transactions_yapily_account_id_fkey FOREIGN KEY (yapily_account_id) REFERENCES yapily_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $do$;

CREATE INDEX IF NOT EXISTS idx_active_invoices_company_id ON public.active_invoices USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_active_invoices_invoice_date ON public.active_invoices USING btree (invoice_date);

CREATE INDEX IF NOT EXISTS idx_active_invoices_sdi_status ON public.active_invoices USING btree (sdi_status);

CREATE INDEX IF NOT EXISTS idx_ai_anomaly_company ON public.ai_anomaly_log USING btree (company_id, is_resolved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_rules_company_active ON public.ai_categorization_rules USING btree (company_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS annual_budgets_company_id_outlet_id_year_key ON public.annual_budgets USING btree (company_id, outlet_id, year);

CREATE UNIQUE INDEX IF NOT EXISTS app_config_company_id_key ON public.app_config USING btree (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS app_users_company_id_email_key ON public.app_users USING btree (company_id, email);

CREATE INDEX IF NOT EXISTS idx_bs_data_section ON public.balance_sheet_data USING btree (section);

CREATE INDEX IF NOT EXISTS idx_bs_data_year ON public.balance_sheet_data USING btree (year, period_type);

CREATE UNIQUE INDEX IF NOT EXISTS bank_balances_bank_account_id_date_key ON public.bank_balances USING btree (bank_account_id, date);

CREATE INDEX IF NOT EXISTS idx_bank_balances_date ON public.bank_balances USING btree (bank_account_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_statements_account ON public.bank_statements USING btree (bank_account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_date ON public.bank_transactions USING btree (bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account_id ON public.bank_transactions USING btree (account_id);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON public.bank_transactions USING btree (company_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_not_reconciled ON public.bank_transactions USING btree (is_reconciled) WHERE (NOT is_reconciled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_transactions_yapily_dedup ON public.bank_transactions USING btree (company_id, yapily_transaction_id) WHERE (yapily_transaction_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_bank_tx_account ON public.bank_transactions USING btree (bank_account_id);

CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON public.bank_transactions USING btree (transaction_date);

CREATE INDEX IF NOT EXISTS idx_bank_tx_reconciled ON public.bank_transactions USING btree (is_reconciled);

CREATE INDEX IF NOT EXISTS idx_budget_approval_log_company_year ON public.budget_approval_log USING btree (company_id, year);

CREATE INDEX IF NOT EXISTS idx_budget_approval_log_created_at ON public.budget_approval_log USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_budget_approval_log_outlet ON public.budget_approval_log USING btree (company_id, cost_center, year);

CREATE UNIQUE INDEX IF NOT EXISTS budget_confronto_company_id_cost_center_account_code_year_m_key ON public.budget_confronto USING btree (company_id, cost_center, account_code, year, month, entry_type);

CREATE INDEX IF NOT EXISTS idx_budget_confronto_lookup ON public.budget_confronto USING btree (company_id, cost_center, year, entry_type);

CREATE UNIQUE INDEX IF NOT EXISTS budget_cost_lines_budget_id_cost_category_id_key ON public.budget_cost_lines USING btree (budget_id, cost_category_id);

CREATE UNIQUE INDEX IF NOT EXISTS budget_entries_company_id_account_code_cost_center_year_mon_key ON public.budget_entries USING btree (company_id, account_code, cost_center, year, month);

CREATE INDEX IF NOT EXISTS idx_budget_account ON public.budget_entries USING btree (account_code);

CREATE INDEX IF NOT EXISTS idx_budget_center ON public.budget_entries USING btree (cost_center);

CREATE INDEX IF NOT EXISTS idx_budget_year_month ON public.budget_entries USING btree (year, month);

CREATE UNIQUE INDEX IF NOT EXISTS cash_budget_company_id_year_month_key ON public.cash_budget USING btree (company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_cash_movements_ai_category ON public.cash_movements USING btree (ai_category_id);

CREATE INDEX IF NOT EXISTS idx_cash_movements_bank_date ON public.cash_movements USING btree (bank_account_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_movements_company_date ON public.cash_movements USING btree (company_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_cash_movements_date ON public.cash_movements USING btree (company_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_desc_trgm ON public.cash_movements USING gin (description gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_no_dupes ON public.cash_movements USING btree (bank_account_id, date, amount, md5(description)) WHERE (description IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cash_movements_outlet ON public.cash_movements USING btree (outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_cash_movements_unreconciled ON public.cash_movements USING btree (is_reconciled) WHERE (NOT is_reconciled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_movements_yapily_tx ON public.cash_movements USING btree (yapily_transaction_id) WHERE (yapily_transaction_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS chart_of_accounts_company_id_code_key ON public.chart_of_accounts USING btree (company_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS companies_vat_number_key ON public.companies USING btree (vat_number);

CREATE UNIQUE INDEX IF NOT EXISTS company_settings_company_id_key ON public.company_settings USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_deadlines_date ON public.contract_deadlines USING btree (deadline_date) WHERE (NOT is_completed);

CREATE INDEX IF NOT EXISTS idx_contract_documents_contract ON public.contract_documents USING btree (contract_id);

CREATE INDEX IF NOT EXISTS idx_contracts_company ON public.contracts USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_contracts_outlet ON public.contracts USING btree (outlet_id);

CREATE INDEX IF NOT EXISTS idx_contracts_renewal ON public.contracts USING btree (renewal_date) WHERE (status = 'attivo'::contract_status);

CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts USING btree (status);

CREATE UNIQUE INDEX IF NOT EXISTS corrispettivi_log_company_id_outlet_id_date_key ON public.corrispettivi_log USING btree (company_id, outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_corrispettivi_log_company_outlet_date ON public.corrispettivi_log USING btree (company_id, outlet_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS cost_categories_company_id_code_key ON public.cost_categories USING btree (company_id, code);

CREATE INDEX IF NOT EXISTS idx_cost_categories_company ON public.cost_categories USING btree (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_company_id_code_key ON public.cost_centers USING btree (company_id, code);

CREATE UNIQUE INDEX IF NOT EXISTS daily_receipts_ade_company_id_outlet_id_date_device_serial_key ON public.daily_receipts_ade USING btree (company_id, outlet_id, date, device_serial);

CREATE UNIQUE INDEX IF NOT EXISTS daily_revenue_company_id_outlet_id_date_key ON public.daily_revenue USING btree (company_id, outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_daily_revenue_date ON public.daily_revenue USING btree (outlet_id, date);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON public.document_versions USING btree (document_id, document_table);

CREATE INDEX IF NOT EXISTS idx_document_versions_company ON public.document_versions USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_docs_category ON public.documents USING btree (category);

CREATE INDEX IF NOT EXISTS idx_docs_ref ON public.documents USING btree (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_docs_retention ON public.documents USING btree (retention_status, retention_end);

CREATE INDEX IF NOT EXISTS idx_einv_retention ON public.electronic_invoices USING btree (retention_status, retention_end);

CREATE INDEX IF NOT EXISTS idx_electronic_invoices_invoice_date ON public.electronic_invoices USING btree (invoice_date);

CREATE INDEX IF NOT EXISTS idx_electronic_invoices_sdi_id ON public.electronic_invoices USING btree (sdi_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_electronic_invoices_sdi_id_unique ON public.electronic_invoices USING btree (company_id, sdi_id) WHERE (sdi_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_electronic_invoices_sdi_status ON public.electronic_invoices USING btree (sdi_status);

CREATE INDEX IF NOT EXISTS idx_electronic_invoices_supplier_vat ON public.electronic_invoices USING btree (supplier_vat);

CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.electronic_invoices USING btree (company_id, invoice_date);

CREATE UNIQUE INDEX IF NOT EXISTS employee_costs_employee_id_year_month_key ON public.employee_costs USING btree (employee_id, year, month);

CREATE INDEX IF NOT EXISTS idx_emp_costs_employee ON public.employee_costs USING btree (employee_id);

CREATE INDEX IF NOT EXISTS idx_emp_costs_period ON public.employee_costs USING btree (year, month);

CREATE INDEX IF NOT EXISTS idx_emp_alloc_employee ON public.employee_outlet_allocations USING btree (employee_id);

CREATE INDEX IF NOT EXISTS idx_emp_alloc_outlet ON public.employee_outlet_allocations USING btree (outlet_code);

CREATE INDEX IF NOT EXISTS idx_employee_outlet_allocations_company ON public.employee_outlet_allocations USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_employees_company ON public.employees USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_employees_outlet ON public.employees USING btree (outlet_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_deadlines_company ON public.fiscal_deadlines USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_fiscal_deadlines_due ON public.fiscal_deadlines USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_fiscal_deadlines_status ON public.fiscal_deadlines USING btree (company_id, status);

CREATE INDEX IF NOT EXISTS idx_fiscal_deadlines_type ON public.fiscal_deadlines USING btree (company_id, deadline_type);

CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices USING btree (status);

CREATE INDEX IF NOT EXISTS idx_invoices_supplier ON public.invoices USING btree (supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS loan_tranches_loan_id_tranche_number_key ON public.loan_tranches USING btree (loan_id, tranche_number);

CREATE INDEX IF NOT EXISTS idx_manual_balance_account ON public.manual_balance_entries USING btree (bank_account_id, balance_date DESC);

CREATE INDEX IF NOT EXISTS idx_monthly_actuals_period ON public.monthly_actuals USING btree (company_id, year, month);

CREATE UNIQUE INDEX IF NOT EXISTS monthly_actuals_company_id_outlet_id_year_month_key ON public.monthly_actuals USING btree (company_id, outlet_id, year, month);

CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_user_id_company_id_key ON public.notification_preferences USING btree (user_id, company_id);

CREATE INDEX IF NOT EXISTS idx_notifications_company ON public.notifications USING btree (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications USING btree (user_id, read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outlet_attachments_outlet ON public.outlet_attachments USING btree (outlet_id);

CREATE UNIQUE INDEX IF NOT EXISTS outlet_bank_accounts_outlet_id_bank_account_id_key ON public.outlet_bank_accounts USING btree (outlet_id, bank_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS outlet_cost_template_outlet_id_cost_category_id_key ON public.outlet_cost_template USING btree (outlet_id, cost_category_id);

CREATE UNIQUE INDEX IF NOT EXISTS outlet_suppliers_outlet_id_supplier_id_key ON public.outlet_suppliers USING btree (outlet_id, supplier_id);

CREATE INDEX IF NOT EXISTS idx_outlets_company ON public.outlets USING btree (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS outlets_company_id_code_key ON public.outlets USING btree (company_id, code);

CREATE INDEX IF NOT EXISTS idx_payable_actions_date ON public.payable_actions USING btree (performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_payable_actions_payable ON public.payable_actions USING btree (payable_id);

CREATE INDEX IF NOT EXISTS idx_payables_due_date ON public.payables USING btree (due_date) WHERE (status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status]));

CREATE INDEX IF NOT EXISTS idx_payables_gross_due ON public.payables USING btree (gross_amount, due_date);

CREATE INDEX IF NOT EXISTS idx_payables_outlet ON public.payables USING btree (outlet_id, due_date);

CREATE INDEX IF NOT EXISTS idx_payables_parent ON public.payables USING btree (parent_payable_id) WHERE (parent_payable_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_payables_status ON public.payables USING btree (status);

CREATE INDEX IF NOT EXISTS idx_payables_supplier ON public.payables USING btree (supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS payables_company_id_supplier_id_invoice_number_key ON public.payables USING btree (company_id, supplier_id, invoice_number);

CREATE INDEX IF NOT EXISTS idx_payment_batch_items_batch ON public.payment_batch_items USING btree (batch_id);

CREATE INDEX IF NOT EXISTS idx_payment_batches_status ON public.payment_batches USING btree (status);

CREATE INDEX IF NOT EXISTS idx_payments_due ON public.payment_schedule USING btree (due_date);

CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payment_schedule USING btree (status);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_company ON public.reconciliation_log USING btree (company_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_movement ON public.reconciliation_log USING btree (cash_movement_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_log_payable ON public.reconciliation_log USING btree (payable_id);

CREATE UNIQUE INDEX IF NOT EXISTS reconciliation_rejected_pairs_cash_movement_id_payable_id_key ON public.reconciliation_rejected_pairs USING btree (cash_movement_id, payable_id);

CREATE INDEX IF NOT EXISTS idx_recurring_costs_active ON public.recurring_costs USING btree (company_id, is_active);

CREATE INDEX IF NOT EXISTS idx_recurring_costs_company ON public.recurring_costs USING btree (company_id, cost_center);

CREATE INDEX IF NOT EXISTS idx_sdi_config_company_id ON public.sdi_config USING btree (company_id);

CREATE UNIQUE INDEX IF NOT EXISTS sdi_config_company_id_key ON public.sdi_config USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_sdi_sync_log_company_created ON public.sdi_sync_log USING btree (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alloc_details_rule ON public.supplier_allocation_details USING btree (rule_id);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_allocation_details_rule_id_outlet_id_key ON public.supplier_allocation_details USING btree (rule_id, outlet_id);

CREATE INDEX IF NOT EXISTS idx_alloc_rules_supplier ON public.supplier_allocation_rules USING btree (company_id, supplier_id) WHERE (is_active = true);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_allocation_rules_company_id_supplier_id_is_active_key ON public.supplier_allocation_rules USING btree (company_id, supplier_id, is_active);

CREATE INDEX IF NOT EXISTS idx_suppliers_company ON public.suppliers USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON public.suppliers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_suppliers_piva ON public.suppliers USING btree (partita_iva);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_company_id_vat_number_key ON public.suppliers USING btree (company_id, vat_number);

CREATE INDEX IF NOT EXISTS idx_user_outlet_access_company ON public.user_outlet_access USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_yapily_accounts_company ON public.yapily_accounts USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_yapily_accounts_consent ON public.yapily_accounts USING btree (consent_id);

CREATE INDEX IF NOT EXISTS idx_yapily_accounts_iban ON public.yapily_accounts USING btree (iban);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yapily_accounts_unique ON public.yapily_accounts USING btree (company_id, yapily_account_id);

CREATE INDEX IF NOT EXISTS idx_yapily_consents_company ON public.yapily_consents USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_yapily_consents_institution ON public.yapily_consents USING btree (institution_id);

CREATE INDEX IF NOT EXISTS idx_yapily_consents_status ON public.yapily_consents USING btree (status);

CREATE INDEX IF NOT EXISTS idx_yapily_payments_company ON public.yapily_payments USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_yapily_payments_payable ON public.yapily_payments USING btree (payable_id);

CREATE INDEX IF NOT EXISTS idx_yapily_payments_status ON public.yapily_payments USING btree (status);

CREATE INDEX IF NOT EXISTS idx_yapily_transactions_account ON public.yapily_transactions USING btree (yapily_account_id);

CREATE INDEX IF NOT EXISTS idx_yapily_transactions_company ON public.yapily_transactions USING btree (company_id);

CREATE INDEX IF NOT EXISTS idx_yapily_transactions_date ON public.yapily_transactions USING btree (date DESC);

CREATE INDEX IF NOT EXISTS idx_yapily_transactions_reconciled ON public.yapily_transactions USING btree (reconciled) WHERE (NOT reconciled);

CREATE UNIQUE INDEX IF NOT EXISTS idx_yapily_transactions_unique ON public.yapily_transactions USING btree (company_id, yapily_account_id, transaction_id);

CREATE OR REPLACE FUNCTION public.align_payable_categories(p_company_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  updated_count INTEGER := 0;
  batch_count INTEGER;
BEGIN
  -- STEP 0: BACKFILL — se un payable ha cost_category_id ma il suo supplier no,
  -- setta il default_cost_category_id sul supplier (match per supplier_id, vat, o nome)
  
  -- 0a. Backfill per supplier_id
  UPDATE suppliers s
  SET default_cost_category_id = sub.cost_category_id
  FROM (
    SELECT DISTINCT ON (p.supplier_id) p.supplier_id, p.cost_category_id
    FROM payables p
    WHERE p.cost_category_id IS NOT NULL
      AND p.supplier_id IS NOT NULL
      AND p.company_id = p_company_id
    ORDER BY p.supplier_id, p.invoice_date DESC
  ) sub
  WHERE s.id = sub.supplier_id
    AND s.default_cost_category_id IS NULL;

  -- 0b. Backfill per supplier_vat (per payables senza supplier_id)
  UPDATE suppliers s
  SET default_cost_category_id = sub.cost_category_id
  FROM (
    SELECT DISTINCT ON (p.supplier_vat) p.supplier_vat, p.cost_category_id
    FROM payables p
    WHERE p.cost_category_id IS NOT NULL
      AND p.supplier_id IS NULL
      AND p.supplier_vat IS NOT NULL
      AND p.supplier_vat != ''
      AND p.company_id = p_company_id
    ORDER BY p.supplier_vat, p.invoice_date DESC
  ) sub
  WHERE (s.vat_number = sub.supplier_vat OR s.partita_iva = sub.supplier_vat)
    AND s.company_id = p_company_id
    AND s.default_cost_category_id IS NULL;

  -- STEP 1: Match diretto per supplier_id
  UPDATE payables p
  SET cost_category_id = s.default_cost_category_id
  FROM suppliers s
  WHERE p.supplier_id = s.id
    AND p.company_id = p_company_id
    AND s.default_cost_category_id IS NOT NULL
    AND p.cost_category_id IS NULL;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  updated_count := updated_count + batch_count;

  -- STEP 2: Match per supplier_vat
  UPDATE payables p
  SET cost_category_id = s.default_cost_category_id
  FROM suppliers s
  WHERE p.supplier_id IS NULL
    AND p.supplier_vat IS NOT NULL
    AND p.supplier_vat != ''
    AND (s.vat_number = p.supplier_vat OR s.partita_iva = p.supplier_vat)
    AND s.company_id = p_company_id
    AND p.company_id = p_company_id
    AND s.default_cost_category_id IS NOT NULL
    AND p.cost_category_id IS NULL;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  updated_count := updated_count + batch_count;

  -- STEP 3: Match per supplier_name
  UPDATE payables p
  SET cost_category_id = s.default_cost_category_id
  FROM suppliers s
  WHERE p.supplier_id IS NULL
    AND p.cost_category_id IS NULL
    AND p.supplier_name IS NOT NULL
    AND p.supplier_name != ''
    AND (s.name = p.supplier_name OR s.ragione_sociale = p.supplier_name)
    AND s.company_id = p_company_id
    AND p.company_id = p_company_id
    AND s.default_cost_category_id IS NOT NULL;
  GET DIAGNOSTICS batch_count = ROW_COUNT;
  updated_count := updated_count + batch_count;

  RETURN updated_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_budget_outlet_year(p_cost_center text, p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_user_email TEXT;
  v_company_id UUID;
  v_count      INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta';
  END IF;

  IF NOT public.has_jwt_role('budget_approver') THEN
    RAISE EXCEPTION 'Permesso negato: serve ruolo budget_approver';
  END IF;

  v_user_email := COALESCE(auth.jwt() ->> 'email', '');
  v_company_id := public.jwt_company_id();

  IF p_cost_center IS NULL OR p_cost_center = '' THEN
    RAISE EXCEPTION 'cost_center obbligatorio';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'year non valido: %', p_year;
  END IF;

  UPDATE public.budget_entries
  SET is_approved = TRUE,
      approved_at = now(),
      approved_by = v_user_id,
      unlocked_at = NULL,
      unlocked_by = NULL,
      unlock_reason = NULL,
      updated_at = now()
  WHERE cost_center = p_cost_center
    AND year = p_year
    AND (v_company_id IS NULL OR company_id = v_company_id)
    AND COALESCE(is_approved, FALSE) = FALSE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.budget_approval_log
    (company_id, cost_center, year, action, actor_user_id, actor_email, reason, rows_affected)
  VALUES
    (COALESCE(v_company_id, '00000000-0000-0000-0000-000000000001'::uuid),
     p_cost_center, p_year, 'approve', v_user_id, v_user_email, NULL, v_count);

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.budget_entries_lock_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF COALESCE(OLD.is_approved, FALSE) IS TRUE THEN
    IF current_setting('app.budget_bypass_lock', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION
        'Riga budget approvata: usa la RPC unlock_budget_outlet_year per modificare. cost_center=%, year=%, account_code=%, month=%',
        OLD.cost_center, OLD.year, OLD.account_code, OLD.month
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calc_notice_deadline()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.end_date IS NOT NULL AND NEW.notice_days IS NOT NULL THEN
    NEW.notice_deadline := NEW.end_date - (NEW.notice_days || ' days')::INTERVAL;
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_auto_categorize_payable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.cost_category_id IS NULL THEN
    -- Prima prova per supplier_id
    IF NEW.supplier_id IS NOT NULL THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE id = NEW.supplier_id
        AND default_cost_category_id IS NOT NULL;
    END IF;
    -- Se ancora NULL, prova per supplier_vat
    IF NEW.cost_category_id IS NULL AND NEW.supplier_vat IS NOT NULL AND NEW.supplier_vat != '' THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE (vat_number = NEW.supplier_vat OR partita_iva = NEW.supplier_vat)
        AND company_id = NEW.company_id
        AND default_cost_category_id IS NOT NULL
      LIMIT 1;
    END IF;
    -- Se ancora NULL, prova per supplier_name
    IF NEW.cost_category_id IS NULL AND NEW.supplier_name IS NOT NULL AND NEW.supplier_name != '' THEN
      SELECT default_cost_category_id INTO NEW.cost_category_id
      FROM suppliers
      WHERE (name = NEW.supplier_name OR ragione_sociale = NEW.supplier_name)
        AND company_id = NEW.company_id
        AND default_cost_category_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_invoice_to_payable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_supplier_id uuid;
  v_due date;
  v_status payable_status;
BEGIN
  -- Find matching supplier by VAT or name
  SELECT id INTO v_supplier_id
  FROM suppliers
  WHERE company_id = NEW.company_id
    AND (
      (NEW.supplier_vat IS NOT NULL AND vat_number = NEW.supplier_vat)
      OR (NEW.supplier_name IS NOT NULL AND name ILIKE NEW.supplier_name)
    )
  LIMIT 1;

  -- Determine due date: use invoice due_date, or invoice_date + 30 days
  v_due := COALESCE(NEW.due_date, NEW.invoice_date + INTERVAL '30 days');

  -- Determine status based on due date
  IF v_due < CURRENT_DATE THEN
    v_status := 'scaduto';
  ELSIF v_due <= CURRENT_DATE + INTERVAL '7 days' THEN
    v_status := 'in_scadenza';
  ELSE
    v_status := 'da_pagare';
  END IF;

  -- Insert payable if not exists
  INSERT INTO payables (
    company_id, outlet_id, supplier_id, invoice_number, invoice_date,
    due_date, original_due_date, net_amount, vat_amount, gross_amount,
    amount_remaining, electronic_invoice_id, import_batch_id, status,
    payment_method_code, notes, created_at, updated_at
  ) VALUES (
    NEW.company_id, NEW.outlet_id, v_supplier_id, NEW.invoice_number, NEW.invoice_date,
    v_due, v_due, NEW.net_amount, NEW.vat_amount, NEW.gross_amount,
    NEW.gross_amount, NEW.id, NEW.import_batch_id, v_status,
    NEW.payment_method, 'Auto-generata da fattura elettronica',
    NOW(), NOW()
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_prevent_duplicate_payable()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  existing_id UUID;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    RETURN NEW;
  END IF;

  -- Cerca record esistente: stesso invoice_number + stesso fornitore + stessa company
  SELECT id INTO existing_id
  FROM payables
  WHERE company_id = NEW.company_id
    AND invoice_number = NEW.invoice_number
    AND COALESCE(installment_number, 0) = COALESCE(NEW.installment_number, 0)
    AND (
      (supplier_id IS NOT NULL AND supplier_id = NEW.supplier_id)
      OR (supplier_vat IS NOT NULL AND supplier_vat != '' AND supplier_vat = NEW.supplier_vat)
      OR (supplier_name IS NOT NULL AND supplier_name != '' AND supplier_name = NEW.supplier_name)
    )
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    -- UPSERT: aggiorna il record esistente con i dati nuovi (se migliori)
    UPDATE payables SET
      supplier_id = COALESCE(NEW.supplier_id, supplier_id),
      supplier_name = COALESCE(NEW.supplier_name, supplier_name),
      supplier_vat = COALESCE(NEW.supplier_vat, supplier_vat),
      gross_amount = COALESCE(NEW.gross_amount, gross_amount),
      net_amount = COALESCE(NEW.net_amount, net_amount),
      vat_amount = COALESCE(NEW.vat_amount, vat_amount),
      due_date = COALESCE(NEW.due_date, due_date),
      payment_method = COALESCE(NEW.payment_method, payment_method),
      payment_method_code = COALESCE(NEW.payment_method_code, payment_method_code),
      payment_method_label = COALESCE(NEW.payment_method_label, payment_method_label),
      iban = COALESCE(NEW.iban, iban),
      electronic_invoice_id = COALESCE(NEW.electronic_invoice_id, electronic_invoice_id),
      cost_category_id = COALESCE(cost_category_id, NEW.cost_category_id),
      updated_at = NOW()
    WHERE id = existing_id;
    -- NON inserire duplicato
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_update_bank_balance_after_movement()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Recalculate balance from all movements for this bank account
  UPDATE bank_accounts 
  SET current_balance = COALESCE((
    SELECT sum(amount) FROM cash_movements WHERE bank_account_id = NEW.bank_account_id
  ), 0),
  last_update = now()
  WHERE id = NEW.bank_account_id;
  
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_company_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT company_id FROM user_profiles WHERE id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT role FROM user_profiles WHERE id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.get_sdi_credentials()
 RETURNS TABLE(client_cert text, client_key text, server_cert text, server_key text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY SELECT
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sdi_client_cert'),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sdi_client_key'),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sdi_server_cert'),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sdi_server_key');
END; $function$
;

CREATE OR REPLACE FUNCTION public.get_yapily_credentials()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_uuid TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_uuid
  FROM vault.decrypted_secrets
  WHERE name = 'yapily_application_uuid'
  LIMIT 1;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'yapily_application_secret'
  LIMIT 1;

  RETURN json_build_object('uuid', v_uuid, 'secret', v_secret);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_jwt_role(role_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role JSONB;
BEGIN
  v_role := COALESCE(auth.jwt() -> 'app_metadata' -> 'role', 'null'::jsonb);
  IF v_role IS NULL OR jsonb_typeof(v_role) = 'null' THEN
    RETURN FALSE;
  END IF;
  IF jsonb_typeof(v_role) = 'string' THEN
    RETURN (v_role #>> '{}') = role_name;
  ELSIF jsonb_typeof(v_role) = 'array' THEN
    RETURN v_role ? role_name;
  END IF;
  RETURN FALSE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.has_outlet_access(p_outlet_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor' OR EXISTS (
        SELECT 1 FROM user_outlet_access uoa WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id
      ))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.has_outlet_write(p_outlet_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid()
      AND (up.role = 'super_advisor'
        OR (up.role = 'contabile' AND EXISTS (
          SELECT 1 FROM user_outlet_access uoa
          WHERE uoa.user_id = auth.uid() AND uoa.outlet_id = p_outlet_id AND uoa.can_write = TRUE
        )))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.init_default_cost_categories(p_company_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO cost_categories (company_id, code, name, macro_group, is_fixed, is_recurring, is_system, sort_order) VALUES
    (p_company_id, 'LOC_OUTLET', 'Locazione outlet', 'locazione', TRUE, TRUE, TRUE, 10),
    (p_company_id, 'COND_MKT', 'Spese condominiali e marketing', 'locazione', TRUE, TRUE, TRUE, 20),
    (p_company_id, 'COMP_AMM', 'Compenso amministratore', 'personale', TRUE, TRUE, TRUE, 30),
    (p_company_id, 'PERS_DIP', 'Personale dipendente', 'personale', TRUE, TRUE, TRUE, 40),
    (p_company_id, 'INT_PASS', 'Interessi passivi', 'finanziarie', TRUE, TRUE, TRUE, 200),
    (p_company_id, 'ONERI_DIV', 'Oneri diversi di gestione', 'oneri_diversi', FALSE, FALSE, TRUE, 300)
  ON CONFLICT (company_id, code) DO NOTHING;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.jwt_company_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cid TEXT;
BEGIN
  v_cid := auth.jwt() -> 'app_metadata' ->> 'company_id';
  IF v_cid IS NOT NULL AND v_cid <> '' THEN
    RETURN v_cid::UUID;
  END IF;
  -- Fallback sul user_profiles (compatibilità sistema esistente)
  RETURN (SELECT company_id FROM user_profiles WHERE id = auth.uid());
END;
$function$
;

CREATE OR REPLACE FUNCTION public.unlock_budget_outlet_year(p_cost_center text, p_year integer, p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID;
  v_user_email TEXT;
  v_company_id UUID;
  v_count      INT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticazione richiesta';
  END IF;

  IF NOT public.has_jwt_role('budget_approver') THEN
    RAISE EXCEPTION 'Permesso negato: serve ruolo budget_approver';
  END IF;

  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Motivo sblocco obbligatorio (minimo 5 caratteri)';
  END IF;

  IF p_cost_center IS NULL OR p_cost_center = '' THEN
    RAISE EXCEPTION 'cost_center obbligatorio';
  END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
    RAISE EXCEPTION 'year non valido: %', p_year;
  END IF;

  v_user_email := COALESCE(auth.jwt() ->> 'email', '');
  v_company_id := public.jwt_company_id();

  -- Attiva bypass del trigger di lock per la durata della transazione
  PERFORM set_config('app.budget_bypass_lock', 'on', true);

  UPDATE public.budget_entries
  SET is_approved = FALSE,
      unlocked_at = now(),
      unlocked_by = v_user_id,
      unlock_reason = p_reason,
      updated_at = now()
  WHERE cost_center = p_cost_center
    AND year = p_year
    AND (v_company_id IS NULL OR company_id = v_company_id)
    AND COALESCE(is_approved, FALSE) = TRUE;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Disattiva bypass
  PERFORM set_config('app.budget_bypass_lock', 'off', true);

  INSERT INTO public.budget_approval_log
    (company_id, cost_center, year, action, actor_user_id, actor_email, reason, rows_affected)
  VALUES
    (COALESCE(v_company_id, '00000000-0000-0000-0000-000000000001'::uuid),
     p_cost_center, p_year, 'unlock', v_user_id, v_user_email, p_reason, v_count);

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_fiscal_deadline_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_payable_status()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Salva data originale al primo inserimento
  IF TG_OP = 'INSERT' THEN
    NEW.original_due_date := NEW.due_date;
  END IF;

  -- Calcola remaining
  NEW.amount_remaining := NEW.gross_amount - COALESCE(NEW.amount_paid, 0);

  -- Non toccare stati manuali (sospeso, rimandato, annullato, bloccato)
  IF NEW.status IN ('sospeso', 'annullato', 'bloccato') THEN
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- Se rimandato, usa la nuova data come riferimento
  IF NEW.status = 'rimandato' AND NEW.postponed_to IS NOT NULL THEN
    NEW.due_date := NEW.postponed_to;
    NEW.status := 'da_pagare';
    NEW.updated_at := NOW();
    RETURN NEW;
  END IF;

  -- Auto-update status basato su importi e date
  IF NEW.amount_remaining <= 0 THEN
    NEW.status := 'pagato';
  ELSIF COALESCE(NEW.amount_paid, 0) > 0 AND NEW.amount_remaining > 0 THEN
    NEW.status := 'parziale';
  ELSIF NEW.due_date < CURRENT_DATE THEN
    NEW.status := 'scaduto';
  ELSIF NEW.due_date <= CURRENT_DATE + 7 THEN
    NEW.status := 'in_scadenza';
  ELSE
    NEW.status := 'da_pagare';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE VIEW v_bank_accounts_detail AS
 SELECT ba.company_id,
    ba.id AS bank_account_id,
    ba.bank_name,
    ba.iban,
    ba.account_name,
    ba.account_type,
    ba.credit_line,
    ba.outlet_id,
    o.name AS outlet_name,
    COALESCE(lb.date, last_mov.date) AS last_balance_date,
    COALESCE(lb.balance_accounting, cm_total.calc_balance, 0::numeric)::numeric(14,2) AS balance_accounting,
    COALESCE(lb.balance_available, cm_total.calc_balance, 0::numeric)::numeric(14,2) AS balance_available,
    (COALESCE(lb.balance_available, lb.balance_accounting, cm_total.calc_balance, 0::numeric) + COALESCE(ba.credit_line, 0::numeric))::numeric(14,2) AS total_available,
    COALESCE(pay_7.total, 0::numeric)::numeric(14,2) AS payables_7d,
    COALESCE(pay_30.total, 0::numeric)::numeric(14,2) AS payables_30d,
    COALESCE(pay_60.total, 0::numeric)::numeric(14,2) AS payables_60d,
    (COALESCE(lb.balance_available, lb.balance_accounting, cm_total.calc_balance, 0::numeric) + COALESCE(ba.credit_line, 0::numeric) - COALESCE(pay_30.total, 0::numeric))::numeric(14,2) AS net_available_30d,
    COALESCE(curr.inflows, 0::numeric)::numeric(14,2) AS month_inflows,
    COALESCE(curr.outflows, 0::numeric)::numeric(14,2) AS month_outflows,
    COALESCE(curr.mov_count, 0::bigint) AS month_movements,
    (COALESCE(lb.balance_accounting, cm_total.calc_balance, 0::numeric) - COALESCE(prev.balance_accounting, 0::numeric))::numeric(14,2) AS delta_30d
   FROM bank_accounts ba
     LEFT JOIN outlets o ON o.id = ba.outlet_id
     LEFT JOIN LATERAL ( SELECT cm.date
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id
          ORDER BY cm.date DESC, cm.created_at DESC
         LIMIT 1) last_mov ON true
     LEFT JOIN LATERAL ( SELECT sum(cm.amount) AS calc_balance
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id) cm_total ON true
     LEFT JOIN LATERAL ( SELECT bank_balances.date,
            bank_balances.balance_accounting,
            bank_balances.balance_available
           FROM bank_balances
          WHERE bank_balances.bank_account_id = ba.id
          ORDER BY bank_balances.date DESC
         LIMIT 1) lb ON true
     LEFT JOIN LATERAL ( SELECT bank_balances.balance_accounting
           FROM bank_balances
          WHERE bank_balances.bank_account_id = ba.id AND bank_balances.date <= (CURRENT_DATE - 30)
          ORDER BY bank_balances.date DESC
         LIMIT 1) prev ON true
     LEFT JOIN LATERAL ( SELECT sum(p.amount_remaining) AS total
           FROM payables p
          WHERE p.payment_bank_account_id = ba.id AND (p.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status, 'parziale'::payable_status])) AND p.due_date <= (CURRENT_DATE + 7)) pay_7 ON true
     LEFT JOIN LATERAL ( SELECT sum(p.amount_remaining) AS total
           FROM payables p
          WHERE p.payment_bank_account_id = ba.id AND (p.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status, 'parziale'::payable_status])) AND p.due_date <= (CURRENT_DATE + 30)) pay_30 ON true
     LEFT JOIN LATERAL ( SELECT sum(p.amount_remaining) AS total
           FROM payables p
          WHERE p.payment_bank_account_id = ba.id AND (p.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status, 'parziale'::payable_status])) AND p.due_date <= (CURRENT_DATE + 60)) pay_60 ON true
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN cm.type = 'entrata'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS inflows,
            sum(
                CASE
                    WHEN cm.type = 'uscita'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS outflows,
            count(*) AS mov_count
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id AND EXTRACT(year FROM cm.date) = EXTRACT(year FROM CURRENT_DATE) AND EXTRACT(month FROM cm.date) = EXTRACT(month FROM CURRENT_DATE)) curr ON true
  WHERE ba.is_active = true
  ORDER BY (COALESCE(lb.balance_accounting, cm_total.calc_balance, 0::numeric)) DESC;

CREATE OR REPLACE VIEW v_budget_variance AS
 SELECT id,
    company_id,
    account_code,
    account_name,
    macro_group,
    cost_center,
    year,
    month,
    budget_amount,
    actual_amount,
    is_approved,
    approved_at,
    approved_by,
    note,
    created_at,
    updated_at,
    COALESCE(actual_amount, 0::numeric) - COALESCE(budget_amount, 0::numeric) AS variance,
        CASE
            WHEN budget_amount <> 0::numeric THEN round((COALESCE(actual_amount, 0::numeric) - budget_amount) / budget_amount * 100::numeric, 1)
            ELSE 0::numeric
        END AS variance_pct
   FROM budget_entries be;

CREATE OR REPLACE VIEW v_business_plan_outlet AS
 SELECT o.company_id,
    o.id AS outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    o.opening_date,
    o.bp_status,
    m.month_num,
    to_date(((EXTRACT(year FROM CURRENT_DATE)::text || '-'::text) || lpad(m.month_num::text, 2, '0'::text)) || '-01'::text, 'YYYY-MM-DD'::text) AS period_date,
    EXTRACT(year FROM CURRENT_DATE)::integer AS year,
    COALESCE(actual.revenue, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric, 2)) AS revenue,
        CASE
            WHEN actual.revenue IS NOT NULL THEN 'reale'::text
            ELSE 'previsto'::text
        END AS revenue_type,
    COALESCE(actual.cogs, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric * COALESCE(o.target_cogs_pct, 40::numeric) / 100::numeric, 2)) AS cogs,
    COALESCE(actual.revenue, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric, 2)) - COALESCE(actual.cogs, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric * COALESCE(o.target_cogs_pct, 40::numeric) / 100::numeric, 2)) AS contribution_margin,
    COALESCE(o.rent_monthly, 0::numeric) AS rent,
    COALESCE(o.condo_marketing_monthly, 0::numeric) AS condo_marketing,
    COALESCE(o.admin_cost_monthly, 0::numeric) AS admin_cost,
    COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0::numeric) AS staff_cost,
    COALESCE(tpl.total_other_costs, 0::numeric) AS other_costs,
    COALESCE(o.rent_monthly, 0::numeric) + COALESCE(o.condo_marketing_monthly, 0::numeric) + COALESCE(o.admin_cost_monthly, 0::numeric) + COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0::numeric) + COALESCE(tpl.total_other_costs, 0::numeric) AS total_opex,
    COALESCE(actual.revenue, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric, 2)) - COALESCE(actual.cogs, round(COALESCE(o.target_revenue_year1, 0::numeric) / 12::numeric * COALESCE(o.target_cogs_pct, 40::numeric) / 100::numeric, 2)) - (COALESCE(o.rent_monthly, 0::numeric) + COALESCE(o.condo_marketing_monthly, 0::numeric) + COALESCE(o.admin_cost_monthly, 0::numeric) + COALESCE(emp.monthly_cost, o.staff_budget_monthly, 0::numeric) + COALESCE(tpl.total_other_costs, 0::numeric)) AS ebitda,
        CASE
            WHEN actual.revenue IS NOT NULL THEN 'consuntivo'::text
            ELSE 'budget'::text
        END AS data_source
   FROM outlets o
     CROSS JOIN generate_series(1, 12) m(month_num)
     LEFT JOIN LATERAL ( SELECT ma.revenue,
            COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric) AS cogs
           FROM monthly_actuals ma
          WHERE ma.outlet_id = o.id AND ma.year::numeric = EXTRACT(year FROM CURRENT_DATE) AND ma.month = m.month_num) actual ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(employees.gross_monthly_cost), 0::numeric) AS monthly_cost
           FROM employees
          WHERE employees.outlet_id = o.id AND employees.is_active = true) emp ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(oct.budget_monthly), 0::numeric) AS total_other_costs
           FROM outlet_cost_template oct
             JOIN cost_categories cc ON cc.id = oct.cost_category_id
          WHERE oct.outlet_id = o.id AND oct.is_active = true AND (cc.macro_group <> ALL (ARRAY['locazione'::cost_macro_group, 'personale'::cost_macro_group]))) tpl ON true
  WHERE o.is_active = true;

CREATE OR REPLACE VIEW v_cash_forecast AS
 WITH current_total AS (
         SELECT ba.company_id,
            sum(COALESCE(lb.balance_available, lb.balance_accounting, cm_total.calc_balance, 0::numeric)) AS total_current_balance,
            sum(COALESCE(ba.credit_line, 0::numeric)) AS total_credit_line
           FROM bank_accounts ba
             LEFT JOIN LATERAL ( SELECT bank_balances.balance_accounting,
                    bank_balances.balance_available
                   FROM bank_balances
                  WHERE bank_balances.bank_account_id = ba.id
                  ORDER BY bank_balances.date DESC
                 LIMIT 1) lb ON true
             LEFT JOIN LATERAL ( SELECT sum(cm.amount) AS calc_balance
                   FROM cash_movements cm
                  WHERE cm.bank_account_id = ba.id) cm_total ON true
          WHERE ba.is_active = true
          GROUP BY ba.company_id
        ), weekly_payables AS (
         SELECT payables.company_id,
            date_trunc('week'::text, payables.due_date::timestamp with time zone)::date AS week_start,
            sum(payables.gross_amount - COALESCE(payables.amount_paid, 0::numeric)) AS outflows
           FROM payables
          WHERE (payables.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status])) AND payables.due_date <= (CURRENT_DATE + 84)
          GROUP BY payables.company_id, (date_trunc('week'::text, payables.due_date::timestamp with time zone))
        ), avg_weekly_inflows AS (
         SELECT cm.company_id,
            round(sum(
                CASE
                    WHEN cm.type = 'entrata'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) / 13::numeric, 2) AS avg_weekly_inflow
           FROM cash_movements cm
          WHERE cm.date >= (CURRENT_DATE - 91)
          GROUP BY cm.company_id
        ), weeks AS (
         SELECT generate_series(0, 11) AS week_num
        )
 SELECT ct.company_id,
    w.week_num,
    (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + ((w.week_num || ' weeks'::text)::interval))::date AS week_start,
    (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + (((w.week_num + 1) || ' weeks'::text)::interval) - '1 day'::interval)::date AS week_end,
    ct.total_current_balance,
    ct.total_credit_line,
    COALESCE(awi.avg_weekly_inflow, 0::numeric) AS expected_inflows,
    COALESCE(wp.outflows, 0::numeric) AS scheduled_outflows,
    ct.total_current_balance + (w.week_num + 1)::numeric * COALESCE(awi.avg_weekly_inflow, 0::numeric) - COALESCE(( SELECT sum(sub_wp.outflows) AS sum
           FROM weekly_payables sub_wp
          WHERE sub_wp.company_id = ct.company_id AND sub_wp.week_start <= (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + ((w.week_num || ' weeks'::text)::interval))::date), 0::numeric) AS projected_balance,
        CASE
            WHEN (ct.total_current_balance + (w.week_num + 1)::numeric * COALESCE(awi.avg_weekly_inflow, 0::numeric) - COALESCE(( SELECT sum(sub_wp.outflows) AS sum
               FROM weekly_payables sub_wp
              WHERE sub_wp.company_id = ct.company_id AND sub_wp.week_start <= (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + ((w.week_num || ' weeks'::text)::interval))::date), 0::numeric)) < 0::numeric THEN 'red'::text
            WHEN (ct.total_current_balance + (w.week_num + 1)::numeric * COALESCE(awi.avg_weekly_inflow, 0::numeric) - COALESCE(( SELECT sum(sub_wp.outflows) AS sum
               FROM weekly_payables sub_wp
              WHERE sub_wp.company_id = ct.company_id AND sub_wp.week_start <= (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + ((w.week_num || ' weeks'::text)::interval))::date), 0::numeric)) < 50000::numeric THEN 'yellow'::text
            ELSE 'green'::text
        END AS liquidity_signal
   FROM current_total ct
     CROSS JOIN weeks w
     LEFT JOIN weekly_payables wp ON wp.company_id = ct.company_id AND wp.week_start = (date_trunc('week'::text, CURRENT_DATE::timestamp with time zone) + ((w.week_num || ' weeks'::text)::interval))::date
     LEFT JOIN avg_weekly_inflows awi ON awi.company_id = ct.company_id
  ORDER BY w.week_num;

CREATE OR REPLACE VIEW v_cash_position AS
 SELECT ba.company_id,
    ba.id AS bank_account_id,
    ba.bank_name,
    ba.iban,
    last_mov.date AS last_movement_date,
    COALESCE(last_mov.balance_after, total_calc.calc_balance)::numeric(14,2) AS current_balance,
    COALESCE(current_month.inflows, 0::numeric)::numeric(14,2) AS month_inflows,
    COALESCE(current_month.outflows, 0::numeric)::numeric(14,2) AS month_outflows,
    COALESCE(current_month.net_flow, 0::numeric)::numeric(14,2) AS month_net_flow,
    COALESCE(current_month.movements_count, 0::bigint) AS month_movements_count
   FROM bank_accounts ba
     LEFT JOIN LATERAL ( SELECT cm.date,
            cm.balance_after
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id
          ORDER BY cm.date DESC, cm.created_at DESC
         LIMIT 1) last_mov ON true
     LEFT JOIN LATERAL ( SELECT sum(cm.amount) AS calc_balance
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id) total_calc ON true
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN cm.type = 'entrata'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS inflows,
            sum(
                CASE
                    WHEN cm.type = 'uscita'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS outflows,
            sum(cm.amount) AS net_flow,
            count(*) AS movements_count
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id AND EXTRACT(year FROM cm.date) = EXTRACT(year FROM CURRENT_DATE) AND EXTRACT(month FROM cm.date) = EXTRACT(month FROM CURRENT_DATE)) current_month ON true
  WHERE ba.is_active = true;

CREATE OR REPLACE VIEW v_closing_status AS
 SELECT ma.company_id,
    ma.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    ma.year,
    ma.month,
    ma.status AS period_status,
    ma.revenue,
    ma.revenue IS NOT NULL AND ma.revenue > 0::numeric AS has_revenue,
    COALESCE(cl.cost_lines_count, 0::bigint) AS cost_lines_entered,
    COALESCE(cl.cost_lines_total, 0::numeric) AS total_costs_entered,
    COALESCE(unr.unreconciled_count, 0::bigint) AS unreconciled_movements,
    COALESCE(unr.unreconciled_amount, 0::numeric) AS unreconciled_amount,
    COALESCE(ade.receipts_days, 0::bigint) AS ade_receipts_days,
    EXTRACT(day FROM date_trunc('month'::text, to_date(((ma.year || '-'::text) || ma.month) || '-01'::text, 'YYYY-MM-DD'::text)::timestamp with time zone) + '1 mon'::interval - '1 day'::interval)::integer AS days_in_month,
    round((
        CASE
            WHEN ma.revenue > 0::numeric THEN 25
            ELSE 0
        END +
        CASE
            WHEN COALESCE(cl.cost_lines_count, 0::bigint) >= 5 THEN 25::bigint
            ELSE COALESCE(cl.cost_lines_count, 0::bigint) * 5
        END +
        CASE
            WHEN COALESCE(unr.unreconciled_count, 0::bigint) = 0 THEN 25::bigint
            ELSE GREATEST(0::bigint, 25 - unr.unreconciled_count * 2)
        END +
        CASE
            WHEN COALESCE(ade.receipts_days, 0::bigint) >= 20 THEN 25::bigint
            ELSE COALESCE(ade.receipts_days, 0::bigint)
        END)::numeric, 0) AS completeness_score
   FROM monthly_actuals ma
     JOIN outlets o ON o.id = ma.outlet_id
     LEFT JOIN LATERAL ( SELECT count(*) AS cost_lines_count,
            COALESCE(sum(monthly_cost_lines.amount), 0::numeric) AS cost_lines_total
           FROM monthly_cost_lines
          WHERE monthly_cost_lines.monthly_actual_id = ma.id) cl ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS unreconciled_count,
            COALESCE(sum(abs(cash_movements.amount)), 0::numeric) AS unreconciled_amount
           FROM cash_movements
          WHERE cash_movements.company_id = ma.company_id AND cash_movements.outlet_id = ma.outlet_id AND EXTRACT(year FROM cash_movements.date) = ma.year::numeric AND EXTRACT(month FROM cash_movements.date) = ma.month::numeric AND cash_movements.is_reconciled = false) unr ON true
     LEFT JOIN LATERAL ( SELECT count(DISTINCT daily_receipts_ade.date) AS receipts_days
           FROM daily_receipts_ade
          WHERE daily_receipts_ade.company_id = ma.company_id AND daily_receipts_ade.outlet_id = ma.outlet_id AND EXTRACT(year FROM daily_receipts_ade.date) = ma.year::numeric AND EXTRACT(month FROM daily_receipts_ade.date) = ma.month::numeric) ade ON true
  ORDER BY ma.year DESC, ma.month DESC, o.name;

CREATE OR REPLACE VIEW v_contracts_expiring AS
 SELECT c.id,
    c.company_id,
    c.outlet_id,
    o.name AS outlet_name,
    c.name AS contract_name,
    c.contract_type,
    c.counterpart,
    c.monthly_amount,
    c.end_date,
    c.notice_deadline,
    c.auto_renewal,
    c.status,
    c.end_date - CURRENT_DATE AS days_to_expiry,
    c.notice_deadline - CURRENT_DATE AS days_to_notice_deadline,
        CASE
            WHEN c.notice_deadline IS NOT NULL AND c.notice_deadline <= CURRENT_DATE THEN 'red'::text
            WHEN c.notice_deadline IS NOT NULL AND c.notice_deadline <= (CURRENT_DATE + 30) THEN 'yellow'::text
            WHEN c.end_date IS NOT NULL AND c.end_date <= (CURRENT_DATE + 90) THEN 'yellow'::text
            ELSE 'green'::text
        END AS alert_level
   FROM contracts c
     LEFT JOIN outlets o ON o.id = c.outlet_id
  WHERE c.status = ANY (ARRAY['attivo'::contract_status, 'in_scadenza'::contract_status])
  ORDER BY (
        CASE
            WHEN c.notice_deadline IS NOT NULL THEN c.notice_deadline
            ELSE c.end_date
        END);

CREATE OR REPLACE VIEW v_employee_costs_by_outlet AS
 SELECT ec.year,
    ec.month,
    eoa.outlet_code,
    e.id AS employee_id,
    (e.nome || ' '::text) || e.cognome AS employee_name,
    eoa.role_at_outlet,
    eoa.allocation_pct,
    round(ec.retribuzione * eoa.allocation_pct / 100::numeric, 2) AS retribuzione_allocata,
    round(ec.contributi * eoa.allocation_pct / 100::numeric, 2) AS contributi_allocati,
    round(ec.inail * eoa.allocation_pct / 100::numeric, 2) AS inail_allocato,
    round(ec.tfr * eoa.allocation_pct / 100::numeric, 2) AS tfr_allocato,
    round((ec.retribuzione + ec.contributi + ec.inail + ec.tfr + ec.altri_costi) * eoa.allocation_pct / 100::numeric, 2) AS totale_allocato
   FROM employee_costs ec
     JOIN employees e ON ec.employee_id = e.id
     JOIN employee_outlet_allocations eoa ON e.id = eoa.employee_id AND (eoa.valid_to IS NULL OR eoa.valid_to >= make_date(ec.year, ec.month, 1));

CREATE OR REPLACE VIEW v_loans_overview AS
 SELECT l.company_id,
    l.id AS loan_id,
    l.description,
    l.total_amount,
    l.interest_rate,
    l.start_date,
    l.end_date,
    count(lt.id) AS tranches_count,
    sum(lt.amount) AS total_disbursed,
    l.total_amount - COALESCE(sum(lt.amount), 0::numeric) AS remaining_to_disburse,
    sum(lt.accrued_interest) AS total_accrued_interest,
    min(lt.disbursement_date) AS first_disbursement,
    max(lt.disbursement_date) AS last_disbursement
   FROM loans l
     LEFT JOIN loan_tranches lt ON lt.loan_id = l.id
  GROUP BY l.id, l.company_id, l.description, l.total_amount, l.interest_rate, l.start_date, l.end_date;

CREATE OR REPLACE VIEW v_outlet_card AS
 SELECT o.id AS outlet_id,
    o.company_id,
    o.name,
    o.code,
    o.outlet_type,
    o.mall_name,
    o.address,
    o.city,
    o.province,
    o.sqm,
    o.opening_date,
    o.is_active,
    o.bp_status,
    o.target_revenue_year1,
    o.target_revenue_year2,
    o.target_revenue_steady,
    o.target_margin_pct,
    o.target_cogs_pct,
    o.min_revenue_target,
    o.min_revenue_period,
    o.rent_monthly,
    o.condo_marketing_monthly,
    o.staff_budget_monthly,
    o.admin_cost_monthly,
    o.setup_cost,
    o.deposit_amount,
    COALESCE(emp.active_count, 0::bigint) AS employees_count,
    COALESCE(emp.total_fte, 0::numeric) AS employees_fte,
    COALESCE(emp.monthly_cost, 0::numeric) AS employees_monthly_cost,
    COALESCE(banks.accounts_count, 0::bigint) AS bank_accounts_count,
    banks.primary_bank,
    COALESCE(suppl.suppliers_count, 0::bigint) AS suppliers_count,
    COALESCE(contr.contracts_count, 0::bigint) AS contracts_count,
    COALESCE(contr.monthly_commitments, 0::numeric) AS contracts_monthly_total,
    COALESCE(costs.categories_count, 0::bigint) AS cost_categories_count,
    COALESCE(costs.total_monthly_budget, 0::numeric) AS total_monthly_cost_budget,
        CASE
            WHEN o.opening_date IS NOT NULL THEN EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, o.opening_date::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(CURRENT_DATE::timestamp with time zone, o.opening_date::timestamp with time zone))
            ELSE NULL::numeric
        END AS months_since_opening
   FROM outlets o
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE employees.is_active) AS active_count,
            COALESCE(sum(employees.fte_ratio) FILTER (WHERE employees.is_active), 0::numeric) AS total_fte,
            COALESCE(sum(employees.gross_monthly_cost) FILTER (WHERE employees.is_active), 0::numeric) AS monthly_cost
           FROM employees
          WHERE employees.outlet_id = o.id) emp ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS accounts_count,
            ( SELECT ba.bank_name
                   FROM outlet_bank_accounts oba
                     JOIN bank_accounts ba ON ba.id = oba.bank_account_id
                  WHERE oba.outlet_id = o.id AND oba.is_primary = true
                 LIMIT 1) AS primary_bank
           FROM outlet_bank_accounts
          WHERE outlet_bank_accounts.outlet_id = o.id) banks ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS suppliers_count
           FROM outlet_suppliers
          WHERE outlet_suppliers.outlet_id = o.id AND outlet_suppliers.is_active = true) suppl ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS contracts_count,
            COALESCE(sum(COALESCE(contracts.monthly_amount, contracts.annual_amount / 12::numeric)), 0::numeric) AS monthly_commitments
           FROM contracts
          WHERE contracts.outlet_id = o.id AND contracts.status = 'attivo'::contract_status) contr ON true
     LEFT JOIN LATERAL ( SELECT count(*) AS categories_count,
            COALESCE(sum(outlet_cost_template.budget_monthly), 0::numeric) AS total_monthly_budget
           FROM outlet_cost_template
          WHERE outlet_cost_template.outlet_id = o.id AND outlet_cost_template.is_active = true) costs ON true;

CREATE OR REPLACE VIEW v_payables_aging AS
 SELECT p.company_id,
    s.name AS supplier_name,
    count(*) AS invoices_count,
    sum(p.gross_amount - COALESCE(p.amount_paid, 0::numeric)) AS total_remaining,
    sum(
        CASE
            WHEN p.due_date >= CURRENT_DATE THEN p.gross_amount - COALESCE(p.amount_paid, 0::numeric)
            ELSE 0::numeric
        END) AS not_yet_due,
    sum(
        CASE
            WHEN p.due_date < CURRENT_DATE AND p.due_date >= (CURRENT_DATE - 30) THEN p.gross_amount - COALESCE(p.amount_paid, 0::numeric)
            ELSE 0::numeric
        END) AS overdue_0_30,
    sum(
        CASE
            WHEN p.due_date < (CURRENT_DATE - 30) AND p.due_date >= (CURRENT_DATE - 60) THEN p.gross_amount - COALESCE(p.amount_paid, 0::numeric)
            ELSE 0::numeric
        END) AS overdue_30_60,
    sum(
        CASE
            WHEN p.due_date < (CURRENT_DATE - 60) AND p.due_date >= (CURRENT_DATE - 90) THEN p.gross_amount - COALESCE(p.amount_paid, 0::numeric)
            ELSE 0::numeric
        END) AS overdue_60_90,
    sum(
        CASE
            WHEN p.due_date < (CURRENT_DATE - 90) THEN p.gross_amount - COALESCE(p.amount_paid, 0::numeric)
            ELSE 0::numeric
        END) AS overdue_90_plus
   FROM payables p
     LEFT JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status, 'parziale'::payable_status])
  GROUP BY p.company_id, s.name
  ORDER BY (sum(p.gross_amount - COALESCE(p.amount_paid, 0::numeric))) DESC;

CREATE OR REPLACE VIEW v_payables_operative AS
 SELECT p.id,
    p.company_id,
    p.outlet_id,
    p.supplier_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    COALESCE(s.name, p.supplier_name) AS supplier_name,
    COALESCE(s.ragione_sociale, s.name, p.supplier_name) AS supplier_ragione_sociale,
    COALESCE(s.category, 'altro'::text) AS supplier_category,
    COALESCE(p.iban, s.iban) AS supplier_iban,
    COALESCE(s.partita_iva, s.vat_number, p.supplier_vat) AS supplier_vat,
    p.invoice_number,
    p.invoice_date,
    p.original_due_date,
    p.due_date,
    p.postponed_to,
    p.postpone_count,
    p.gross_amount,
    p.amount_paid,
    p.amount_remaining,
    p.payment_method,
    p.status,
    p.priority,
    p.suspend_reason,
    p.suspend_date,
    cc.name AS cost_category_name,
    cc.macro_group,
        CASE
            WHEN p.status = 'sospeso'::payable_status THEN NULL::integer
            WHEN p.status = 'pagato'::payable_status THEN NULL::integer
            ELSE p.due_date - CURRENT_DATE
        END AS days_to_due,
        CASE
            WHEN p.status = 'pagato'::payable_status THEN 'paid'::text
            WHEN p.status = 'annullato'::payable_status THEN 'cancelled'::text
            WHEN p.status = 'sospeso'::payable_status THEN 'suspended'::text
            WHEN p.due_date < CURRENT_DATE THEN 'overdue'::text
            WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'urgent'::text
            WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'upcoming'::text
            ELSE 'ok'::text
        END AS urgency,
    last_action.action_type AS last_action_type,
    last_action.note AS last_action_note,
    last_action.performed_at AS last_action_date,
    last_action.performer_name AS last_action_by
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
     LEFT JOIN LATERAL ( SELECT pa.action_type,
            pa.note,
            pa.performed_at,
            (up.first_name || ' '::text) || up.last_name AS performer_name
           FROM payable_actions pa
             LEFT JOIN user_profiles up ON up.id = pa.performed_by
          WHERE pa.payable_id = p.id
          ORDER BY pa.performed_at DESC
         LIMIT 1) last_action ON true
  ORDER BY (
        CASE p.status
            WHEN 'scaduto'::payable_status THEN 0
            WHEN 'in_scadenza'::payable_status THEN 1
            WHEN 'parziale'::payable_status THEN 2
            WHEN 'da_pagare'::payable_status THEN 3
            WHEN 'sospeso'::payable_status THEN 4
            WHEN 'rimandato'::payable_status THEN 5
            WHEN 'pagato'::payable_status THEN 6
            WHEN 'annullato'::payable_status THEN 7
            ELSE NULL::integer
        END), p.due_date;

CREATE OR REPLACE VIEW v_payables_schedule AS
 SELECT p.company_id,
    p.id AS payable_id,
    p.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    s.name AS supplier_name,
    s.category AS supplier_category,
    p.invoice_number,
    p.invoice_date,
    p.due_date,
    p.gross_amount,
    p.amount_paid,
    p.gross_amount - COALESCE(p.amount_paid, 0::numeric) AS amount_remaining,
    p.payment_method,
    p.status,
    cc.name AS cost_category_name,
    cc.macro_group,
    p.due_date - CURRENT_DATE AS days_to_due,
        CASE
            WHEN p.due_date < CURRENT_DATE THEN 'scaduto'::text
            WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'entro_7gg'::text
            WHEN p.due_date <= (CURRENT_DATE + 15) THEN 'entro_15gg'::text
            WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'entro_30gg'::text
            WHEN p.due_date <= (CURRENT_DATE + 60) THEN 'entro_60gg'::text
            ELSE 'oltre_60gg'::text
        END AS due_bucket,
        CASE
            WHEN p.due_date < CURRENT_DATE THEN 'red'::text
            WHEN p.due_date <= (CURRENT_DATE + 7) THEN 'red'::text
            WHEN p.due_date <= (CURRENT_DATE + 15) THEN 'yellow'::text
            WHEN p.due_date <= (CURRENT_DATE + 30) THEN 'yellow'::text
            ELSE 'green'::text
        END AS urgency
   FROM payables p
     LEFT JOIN outlets o ON o.id = p.outlet_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN cost_categories cc ON cc.id = p.cost_category_id
  WHERE p.status = ANY (ARRAY['da_pagare'::payable_status, 'in_scadenza'::payable_status, 'scaduto'::payable_status, 'parziale'::payable_status])
  ORDER BY p.due_date;

CREATE OR REPLACE VIEW v_payment_schedule AS
 SELECT ps.id,
    ps.company_id,
    ps.invoice_id,
    ps.installment_number,
    ps.due_date,
    ps.amount,
    ps.payment_method,
    ps.status,
    ps.paid_amount,
    ps.paid_date,
    ps.bank_account_id,
    ps.bank_reference,
    ps.note,
    ps.created_at,
    ps.updated_at,
    i.invoice_number,
    i.invoice_date,
    i.total_amount AS invoice_total,
    i.account_code,
    i.cost_center,
    s.ragione_sociale AS supplier_name,
    s.partita_iva AS supplier_piva,
    ba.bank_name,
    ba.account_name
   FROM payment_schedule ps
     LEFT JOIN invoices i ON ps.invoice_id = i.id
     LEFT JOIN suppliers s ON i.supplier_id = s.id
     LEFT JOIN bank_accounts ba ON ps.bank_account_id = ba.id;

CREATE OR REPLACE VIEW v_pnl_monthly AS
 SELECT ma.company_id,
    ma.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    ma.year,
    ma.month,
    to_date(((ma.year || '-'::text) || lpad(ma.month::text, 2, '0'::text)) || '-01'::text, 'YYYY-MM-DD'::text) AS period_date,
    ma.status AS period_status,
    ma.revenue,
    ma.purchases,
    ma.opening_inventory,
    ma.closing_inventory,
    ma.returns_to_warehouse,
    COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric) AS cogs,
    COALESCE(ma.revenue, 0::numeric) - (COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric)) AS contribution_margin,
        CASE
            WHEN COALESCE(ma.revenue, 0::numeric) > 0::numeric THEN round((COALESCE(ma.revenue, 0::numeric) - (COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric))) / ma.revenue * 100::numeric, 2)
            ELSE 0::numeric
        END AS contribution_margin_pct,
    COALESCE(loc.total, 0::numeric) AS location_costs,
    COALESCE(staff.total, 0::numeric) AS staff_costs,
    COALESCE(ga.total, 0::numeric) AS general_admin_costs,
    COALESCE(fin.total, 0::numeric) AS financial_costs,
    COALESCE(oner.total, 0::numeric) AS other_costs,
    COALESCE(loc.total, 0::numeric) + COALESCE(staff.total, 0::numeric) + COALESCE(ga.total, 0::numeric) + COALESCE(oner.total, 0::numeric) AS total_opex,
    COALESCE(ma.revenue, 0::numeric) - (COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric)) - COALESCE(loc.total, 0::numeric) - COALESCE(staff.total, 0::numeric) - COALESCE(ga.total, 0::numeric) - COALESCE(oner.total, 0::numeric) AS ebitda,
    COALESCE(ma.revenue, 0::numeric) - (COALESCE(ma.purchases, 0::numeric) + COALESCE(ma.opening_inventory, 0::numeric) - COALESCE(ma.closing_inventory, 0::numeric) + COALESCE(ma.returns_to_warehouse, 0::numeric)) - COALESCE(loc.total, 0::numeric) - COALESCE(staff.total, 0::numeric) - COALESCE(ga.total, 0::numeric) - COALESCE(oner.total, 0::numeric) - COALESCE(fin.total, 0::numeric) AS net_result
   FROM monthly_actuals ma
     JOIN outlets o ON o.id = ma.outlet_id
     LEFT JOIN LATERAL ( SELECT sum(mcl.amount) AS total
           FROM monthly_cost_lines mcl
             JOIN cost_categories cc ON cc.id = mcl.cost_category_id
          WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'locazione'::cost_macro_group) loc ON true
     LEFT JOIN LATERAL ( SELECT sum(mcl.amount) AS total
           FROM monthly_cost_lines mcl
             JOIN cost_categories cc ON cc.id = mcl.cost_category_id
          WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'personale'::cost_macro_group) staff ON true
     LEFT JOIN LATERAL ( SELECT sum(mcl.amount) AS total
           FROM monthly_cost_lines mcl
             JOIN cost_categories cc ON cc.id = mcl.cost_category_id
          WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'generali_amministrative'::cost_macro_group) ga ON true
     LEFT JOIN LATERAL ( SELECT sum(mcl.amount) AS total
           FROM monthly_cost_lines mcl
             JOIN cost_categories cc ON cc.id = mcl.cost_category_id
          WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'finanziarie'::cost_macro_group) fin ON true
     LEFT JOIN LATERAL ( SELECT sum(mcl.amount) AS total
           FROM monthly_cost_lines mcl
             JOIN cost_categories cc ON cc.id = mcl.cost_category_id
          WHERE mcl.monthly_actual_id = ma.id AND cc.macro_group = 'oneri_diversi'::cost_macro_group) oner ON true;

CREATE OR REPLACE VIEW v_profit_and_loss AS
 SELECT year,
    period_type,
    account_name,
    account_code,
    parent_account,
    cost_center,
    sum(amount) AS total_amount,
    sort_order
   FROM balance_sheet_data bsd
  WHERE section = 'conto_economico'::text
  GROUP BY year, period_type, account_name, account_code, parent_account, cost_center, sort_order
  ORDER BY sort_order;

CREATE OR REPLACE VIEW v_recent_imports AS
 SELECT ib.id,
    ib.company_id,
    ib.source,
    ib.status,
    ib.file_name,
    o.name AS outlet_name,
    ba.bank_name,
    ib.period_from,
    ib.period_to,
    ib.rows_total,
    ib.rows_imported,
    ib.rows_skipped,
    ib.rows_error,
    ib.imported_at,
    ib.completed_at,
    (up.first_name || ' '::text) || up.last_name AS imported_by_name
   FROM import_batches ib
     LEFT JOIN outlets o ON o.id = ib.outlet_id
     LEFT JOIN bank_accounts ba ON ba.id = ib.bank_account_id
     LEFT JOIN user_profiles up ON up.id = ib.imported_by
  ORDER BY ib.imported_at DESC;

CREATE OR REPLACE VIEW v_recurring_costs AS
 SELECT c.company_id,
    c.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    c.id AS contract_id,
    c.name AS contract_name,
    c.contract_type,
    c.counterpart,
    cc.id AS cost_category_id,
    cc.code AS cost_category_code,
    cc.name AS cost_category_name,
    cc.macro_group,
    c.monthly_amount,
    c.annual_amount,
    COALESCE(c.monthly_amount, round(c.annual_amount / 12::numeric, 2)) AS monthly_expected
   FROM contracts c
     LEFT JOIN outlets o ON o.id = c.outlet_id
     LEFT JOIN cost_categories cc ON cc.id = c.cost_category_id
  WHERE c.status = 'attivo'::contract_status AND (c.monthly_amount IS NOT NULL OR c.annual_amount IS NOT NULL)
  ORDER BY o.name, cc.sort_order;

CREATE OR REPLACE VIEW v_revenue_trend AS
 SELECT dr.company_id,
    dr.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    date_trunc('month'::text, dr.date::timestamp with time zone)::date AS month_date,
    EXTRACT(year FROM dr.date)::integer AS year,
    EXTRACT(month FROM dr.date)::integer AS month,
    sum(dr.gross_revenue) AS monthly_gross_revenue,
    sum(dr.net_revenue) AS monthly_net_revenue,
    sum(dr.transactions_count) AS monthly_transactions,
        CASE
            WHEN sum(dr.transactions_count) > 0 THEN round(sum(dr.gross_revenue) / sum(dr.transactions_count)::numeric, 2)
            ELSE 0::numeric
        END AS avg_ticket,
    sum(dr.cash_amount) AS monthly_cash,
    sum(dr.card_amount) AS monthly_card,
        CASE
            WHEN sum(dr.gross_revenue) > 0::numeric THEN round(sum(dr.card_amount) / sum(dr.gross_revenue) * 100::numeric, 2)
            ELSE 0::numeric
        END AS card_pct
   FROM daily_revenue dr
     JOIN outlets o ON o.id = dr.outlet_id
  GROUP BY dr.company_id, dr.outlet_id, o.name, o.code, (date_trunc('month'::text, dr.date::timestamp with time zone)), (EXTRACT(year FROM dr.date)), (EXTRACT(month FROM dr.date));

CREATE OR REPLACE VIEW v_staff_analysis AS
 SELECT e.company_id,
    e.outlet_id,
    o.name AS outlet_name,
    o.code AS outlet_code,
    count(*) FILTER (WHERE e.is_active) AS active_employees,
    sum(e.fte_ratio) FILTER (WHERE e.is_active) AS total_fte,
    sum(e.weekly_hours) FILTER (WHERE e.is_active) AS total_weekly_hours,
    sum(e.gross_monthly_cost) FILTER (WHERE e.is_active) AS total_monthly_cost,
    sum(e.gross_annual_cost) FILTER (WHERE e.is_active) AS total_annual_cost,
    round(avg(e.gross_monthly_cost) FILTER (WHERE e.is_active), 2) AS avg_monthly_cost,
        CASE
            WHEN o.sqm > 0::numeric THEN round(sum(e.gross_annual_cost) FILTER (WHERE e.is_active) / o.sqm, 2)
            ELSE NULL::numeric
        END AS annual_cost_per_sqm,
    round(avg(EXTRACT(year FROM age(CURRENT_DATE::timestamp with time zone, e.hire_date::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(CURRENT_DATE::timestamp with time zone, e.hire_date::timestamp with time zone))) FILTER (WHERE e.is_active AND e.hire_date IS NOT NULL), 1) AS avg_tenure_months
   FROM employees e
     LEFT JOIN outlets o ON o.id = e.outlet_id
  GROUP BY e.company_id, e.outlet_id, o.name, o.code, o.sqm;

CREATE OR REPLACE VIEW v_treasury_position AS
 SELECT ba.company_id,
    ba.id AS bank_account_id,
    ba.bank_name,
    ba.iban,
    ba.account_type,
    ba.credit_line,
    ba.outlet_id,
    o.name AS outlet_name,
    COALESCE(lb.date, last_mov.date) AS last_balance_date,
    COALESCE(lb.balance_accounting, total_calc.calc_balance, 0::numeric)::numeric(14,2) AS current_balance,
    COALESCE(lb.balance_available, total_calc.calc_balance, 0::numeric)::numeric(14,2) AS available_balance,
    (COALESCE(lb.balance_available, lb.balance_accounting, total_calc.calc_balance, 0::numeric) + COALESCE(ba.credit_line, 0::numeric))::numeric(14,2) AS total_available,
    COALESCE(recent.inflows_30d, 0::numeric)::numeric(14,2) AS inflows_30d,
    COALESCE(recent.outflows_30d, 0::numeric)::numeric(14,2) AS outflows_30d,
    COALESCE(recent.net_30d, 0::numeric)::numeric(14,2) AS net_30d,
    (COALESCE(lb.balance_accounting, total_calc.calc_balance, 0::numeric) - COALESCE(prev_bal.balance_accounting, 0::numeric))::numeric(14,2) AS balance_change_30d
   FROM bank_accounts ba
     LEFT JOIN outlets o ON o.id = ba.outlet_id
     LEFT JOIN LATERAL ( SELECT cm.date
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id
          ORDER BY cm.date DESC, cm.created_at DESC
         LIMIT 1) last_mov ON true
     LEFT JOIN LATERAL ( SELECT sum(cm.amount) AS calc_balance
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id) total_calc ON true
     LEFT JOIN LATERAL ( SELECT bank_balances.date,
            bank_balances.balance_accounting,
            bank_balances.balance_available
           FROM bank_balances
          WHERE bank_balances.bank_account_id = ba.id
          ORDER BY bank_balances.date DESC
         LIMIT 1) lb ON true
     LEFT JOIN LATERAL ( SELECT bank_balances.balance_accounting
           FROM bank_balances
          WHERE bank_balances.bank_account_id = ba.id AND bank_balances.date <= (CURRENT_DATE - 30)
          ORDER BY bank_balances.date DESC
         LIMIT 1) prev_bal ON true
     LEFT JOIN LATERAL ( SELECT sum(
                CASE
                    WHEN cm.type = 'entrata'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS inflows_30d,
            sum(
                CASE
                    WHEN cm.type = 'uscita'::transaction_type THEN cm.amount
                    ELSE 0::numeric
                END) AS outflows_30d,
            sum(cm.amount) AS net_30d
           FROM cash_movements cm
          WHERE cm.bank_account_id = ba.id AND cm.date >= (CURRENT_DATE - 30)) recent ON true
  WHERE ba.is_active = true
  ORDER BY (COALESCE(lb.balance_accounting, total_calc.calc_balance, 0::numeric)) DESC;

CREATE OR REPLACE VIEW v_unreconciled_movements AS
 SELECT cm.id,
    cm.company_id,
    cm.outlet_id,
    o.name AS outlet_name,
    ba.bank_name,
    ba.iban,
    cm.date,
    cm.value_date,
    cm.type,
    cm.amount,
    cm.balance_after,
    cm.description,
    cm.counterpart,
    cm.cost_category_id,
    cm.source,
    ( SELECT cc.id
           FROM cost_categories cc
          WHERE cc.company_id = cm.company_id AND cc.is_active = true AND (EXISTS ( SELECT 1
                   FROM unnest(cc.matching_keywords) kw(kw)
                  WHERE cm.description ~~* (('%'::text || kw.kw) || '%'::text)))
          ORDER BY cc.sort_order
         LIMIT 1) AS suggested_category_id,
    CURRENT_DATE - cm.date AS days_pending
   FROM cash_movements cm
     LEFT JOIN outlets o ON o.id = cm.outlet_id
     LEFT JOIN bank_accounts ba ON ba.id = cm.bank_account_id
  WHERE cm.is_reconciled = false
  ORDER BY cm.date DESC;

CREATE OR REPLACE VIEW v_bank_totals AS
 SELECT company_id,
    count(*) AS accounts_count,
    sum(balance_accounting) AS total_balance,
    sum(total_available) AS total_available,
    sum(COALESCE(credit_line, 0::numeric)) AS total_credit_lines,
    sum(payables_7d) AS total_payables_7d,
    sum(payables_30d) AS total_payables_30d,
    sum(payables_60d) AS total_payables_60d,
    sum(net_available_30d) AS total_net_available_30d,
    sum(month_inflows) AS total_month_inflows,
    sum(month_outflows) AS total_month_outflows
   FROM v_bank_accounts_detail
  GROUP BY company_id;

CREATE OR REPLACE VIEW v_bp_vs_actual_outlet AS
 SELECT bp.company_id,
    bp.outlet_id,
    bp.outlet_name,
    bp.outlet_code,
    bp.year,
    bp.month_num AS month,
    bp.period_date,
    bp.data_source,
    bp.revenue AS bp_revenue,
    COALESCE(act.revenue, 0::numeric) AS actual_revenue,
    COALESCE(act.revenue, 0::numeric) - bp.revenue AS revenue_variance,
        CASE
            WHEN bp.revenue > 0::numeric THEN round((COALESCE(act.revenue, 0::numeric) - bp.revenue) / bp.revenue * 100::numeric, 2)
            ELSE NULL::numeric
        END AS revenue_variance_pct,
    bp.cogs AS bp_cogs,
    COALESCE(pnl.cogs, 0::numeric) AS actual_cogs,
    bp.total_opex AS bp_opex,
    COALESCE(pnl.total_opex, 0::numeric) AS actual_opex,
    COALESCE(pnl.total_opex, 0::numeric) - bp.total_opex AS opex_variance,
    bp.ebitda AS bp_ebitda,
    COALESCE(pnl.ebitda, 0::numeric) AS actual_ebitda,
    COALESCE(pnl.ebitda, 0::numeric) - bp.ebitda AS ebitda_variance,
        CASE
            WHEN COALESCE(act.revenue, 0::numeric) >= (bp.revenue * 1.05) THEN 'green'::text
            WHEN COALESCE(act.revenue, 0::numeric) >= (bp.revenue * 0.90) THEN 'yellow'::text
            WHEN bp.revenue > 0::numeric THEN 'red'::text
            ELSE 'gray'::text
        END AS performance_signal
   FROM v_business_plan_outlet bp
     LEFT JOIN monthly_actuals act ON act.outlet_id = bp.outlet_id AND act.year = bp.year AND act.month = bp.month_num
     LEFT JOIN v_pnl_monthly pnl ON pnl.outlet_id = bp.outlet_id AND pnl.year = bp.year AND pnl.month = bp.month_num;

CREATE OR REPLACE VIEW v_budget_vs_actual AS
 SELECT pnl.company_id,
    pnl.outlet_id,
    pnl.outlet_name,
    pnl.outlet_code,
    pnl.year,
    pnl.month,
    pnl.period_date,
    pnl.period_status,
    round(COALESCE(ab.revenue_target, 0::numeric) / 12::numeric, 2) AS budget_revenue_monthly,
    pnl.revenue AS actual_revenue,
    pnl.revenue - round(COALESCE(ab.revenue_target, 0::numeric) / 12::numeric, 2) AS revenue_variance,
        CASE
            WHEN COALESCE(ab.revenue_target, 0::numeric) > 0::numeric THEN round((pnl.revenue - round(ab.revenue_target / 12::numeric, 2)) / round(ab.revenue_target / 12::numeric, 2) * 100::numeric, 2)
            ELSE NULL::numeric
        END AS revenue_variance_pct,
    round(pnl.revenue * COALESCE(ab.cost_of_goods_pct, 0.40), 2) AS budget_cogs,
    pnl.cogs AS actual_cogs,
    pnl.contribution_margin AS actual_margin,
    pnl.contribution_margin_pct AS actual_margin_pct,
    round((COALESCE(ab.rent_annual, 0::numeric) + COALESCE(ab.condo_marketing_annual, 0::numeric)) / 12::numeric, 2) AS budget_location_monthly,
    pnl.location_costs AS actual_location,
    round(COALESCE(ab.staff_cost_annual, 0::numeric) / 12::numeric, 2) AS budget_staff_monthly,
    pnl.staff_costs AS actual_staff,
    pnl.ebitda AS actual_ebitda,
        CASE
            WHEN pnl.revenue >= (round(COALESCE(ab.revenue_target, 0::numeric) / 12::numeric, 2) * 1.05) THEN 'green'::text
            WHEN pnl.revenue >= (round(COALESCE(ab.revenue_target, 0::numeric) / 12::numeric, 2) * 0.90) THEN 'yellow'::text
            ELSE 'red'::text
        END AS revenue_signal,
        CASE
            WHEN pnl.ebitda > 0::numeric AND pnl.contribution_margin_pct >= 55::numeric THEN 'green'::text
            WHEN pnl.ebitda > 0::numeric THEN 'yellow'::text
            ELSE 'red'::text
        END AS profitability_signal
   FROM v_pnl_monthly pnl
     LEFT JOIN annual_budgets ab ON ab.company_id = pnl.company_id AND ab.outlet_id = pnl.outlet_id AND ab.year = pnl.year;

CREATE OR REPLACE VIEW v_business_plan_chain AS
 SELECT company_id,
    year,
    month_num,
    period_date,
    count(DISTINCT outlet_id) AS outlets_count,
    sum(revenue) AS total_revenue,
    sum(
        CASE
            WHEN data_source = 'consuntivo'::text THEN revenue
            ELSE 0::numeric
        END) AS actual_revenue,
    sum(
        CASE
            WHEN data_source = 'budget'::text THEN revenue
            ELSE 0::numeric
        END) AS forecast_revenue,
    sum(cogs) AS total_cogs,
    sum(contribution_margin) AS total_contribution_margin,
        CASE
            WHEN sum(revenue) > 0::numeric THEN round(sum(contribution_margin) / sum(revenue) * 100::numeric, 2)
            ELSE 0::numeric
        END AS avg_margin_pct,
    sum(rent) AS total_rent,
    sum(condo_marketing) AS total_condo_marketing,
    sum(admin_cost) AS total_admin_cost,
    sum(staff_cost) AS total_staff_cost,
    sum(other_costs) AS total_other_costs,
    sum(total_opex) AS total_opex,
    sum(ebitda) AS total_ebitda,
        CASE
            WHEN sum(revenue) > 0::numeric THEN round(sum(ebitda) / sum(revenue) * 100::numeric, 2)
            ELSE 0::numeric
        END AS ebitda_margin_pct,
    round(avg(revenue), 2) AS avg_revenue_per_outlet,
    round(avg(ebitda), 2) AS avg_ebitda_per_outlet
   FROM v_business_plan_outlet
  GROUP BY company_id, year, month_num, period_date
  ORDER BY month_num;

CREATE OR REPLACE VIEW v_executive_dashboard AS
 SELECT company_id,
    year,
    month,
    period_date,
    count(DISTINCT outlet_id) AS active_outlets,
    sum(revenue) AS total_revenue,
    sum(cogs) AS total_cogs,
    sum(contribution_margin) AS total_contribution_margin,
        CASE
            WHEN sum(revenue) > 0::numeric THEN round(sum(contribution_margin) / sum(revenue) * 100::numeric, 2)
            ELSE 0::numeric
        END AS avg_margin_pct,
    sum(total_opex) AS total_opex,
    sum(ebitda) AS total_ebitda,
        CASE
            WHEN sum(revenue) > 0::numeric THEN round(sum(ebitda) / sum(revenue) * 100::numeric, 2)
            ELSE 0::numeric
        END AS ebitda_margin_pct,
    sum(net_result) AS total_net_result,
    round(avg(revenue), 2) AS avg_revenue_per_outlet,
    round(avg(ebitda), 2) AS avg_ebitda_per_outlet
   FROM v_pnl_monthly
  GROUP BY company_id, year, month, period_date;

CREATE OR REPLACE VIEW v_outlet_comparison AS
 SELECT pnl.company_id,
    pnl.outlet_id,
    pnl.outlet_name,
    pnl.outlet_code,
    o.sqm,
    o.opening_date,
    o.rent_monthly,
    pnl.year,
    pnl.month,
    pnl.revenue,
    pnl.cogs,
    pnl.contribution_margin,
    pnl.contribution_margin_pct,
    pnl.location_costs,
    pnl.staff_costs,
    pnl.general_admin_costs,
    pnl.ebitda,
        CASE
            WHEN o.sqm > 0::numeric THEN round(pnl.revenue / o.sqm, 2)
            ELSE NULL::numeric
        END AS revenue_per_sqm,
        CASE
            WHEN o.sqm > 0::numeric THEN round(pnl.ebitda / o.sqm, 2)
            ELSE NULL::numeric
        END AS ebitda_per_sqm,
        CASE
            WHEN pnl.revenue > 0::numeric THEN round(pnl.staff_costs / pnl.revenue * 100::numeric, 2)
            ELSE NULL::numeric
        END AS staff_cost_ratio,
        CASE
            WHEN pnl.revenue > 0::numeric THEN round(pnl.location_costs / pnl.revenue * 100::numeric, 2)
            ELSE NULL::numeric
        END AS rent_ratio,
        CASE
            WHEN pnl.revenue > 0::numeric THEN round(pnl.ebitda / pnl.revenue * 100::numeric, 2)
            ELSE NULL::numeric
        END AS ebitda_margin_pct,
        CASE
            WHEN o.opening_date IS NOT NULL THEN EXTRACT(year FROM age(to_date(((pnl.year || '-'::text) || lpad(pnl.month::text, 2, '0'::text)) || '-01'::text, 'YYYY-MM-DD'::text)::timestamp with time zone, o.opening_date::timestamp with time zone)) * 12::numeric + EXTRACT(month FROM age(to_date(((pnl.year || '-'::text) || lpad(pnl.month::text, 2, '0'::text)) || '-01'::text, 'YYYY-MM-DD'::text)::timestamp with time zone, o.opening_date::timestamp with time zone))
            ELSE NULL::numeric
        END AS months_since_opening
   FROM v_pnl_monthly pnl
     JOIN outlets o ON o.id = pnl.outlet_id;

CREATE OR REPLACE VIEW v_outlet_ranking AS
 SELECT pnl.company_id,
    pnl.outlet_id,
    pnl.outlet_name,
    pnl.outlet_code,
    pnl.year,
    sum(pnl.revenue) AS ytd_revenue,
    sum(pnl.ebitda) AS ytd_ebitda,
    round(avg(pnl.contribution_margin_pct), 2) AS avg_margin_pct,
    sum(pnl.staff_costs) AS ytd_staff_costs,
        CASE
            WHEN o.sqm > 0::numeric THEN round(sum(pnl.revenue) / o.sqm, 2)
            ELSE NULL::numeric
        END AS revenue_per_sqm,
        CASE
            WHEN sum(pnl.revenue) > 0::numeric THEN round(sum(pnl.staff_costs) / sum(pnl.revenue) * 100::numeric, 2)
            ELSE NULL::numeric
        END AS staff_cost_ratio,
    ab.revenue_bp AS bp_target,
        CASE
            WHEN COALESCE(ab.revenue_bp, 0::numeric) > 0::numeric THEN round(sum(pnl.revenue) / ab.revenue_bp * 100::numeric, 2)
            ELSE NULL::numeric
        END AS bp_achievement_pct,
    rank() OVER (ORDER BY (sum(pnl.revenue)) DESC) AS rank_revenue,
    rank() OVER (ORDER BY (sum(pnl.ebitda)) DESC) AS rank_ebitda,
    rank() OVER (ORDER BY (
        CASE
            WHEN sum(pnl.revenue) > 0::numeric THEN sum(pnl.ebitda) / sum(pnl.revenue)
            ELSE 0::numeric
        END) DESC) AS rank_efficiency
   FROM v_pnl_monthly pnl
     JOIN outlets o ON o.id = pnl.outlet_id
     LEFT JOIN annual_budgets ab ON ab.company_id = pnl.company_id AND ab.outlet_id = pnl.outlet_id AND ab.year = pnl.year
  GROUP BY pnl.company_id, pnl.outlet_id, pnl.outlet_name, pnl.outlet_code, pnl.year, o.sqm, ab.revenue_bp;

CREATE OR REPLACE VIEW v_yoy_comparison AS
 SELECT curr.company_id,
    curr.outlet_id,
    curr.outlet_name,
    curr.outlet_code,
    curr.month,
    curr.year AS current_year,
    prev.year AS previous_year,
    curr.revenue AS current_revenue,
    prev.revenue AS previous_revenue,
    curr.revenue - COALESCE(prev.revenue, 0::numeric) AS revenue_delta,
        CASE
            WHEN COALESCE(prev.revenue, 0::numeric) > 0::numeric THEN round((curr.revenue - prev.revenue) / prev.revenue * 100::numeric, 2)
            ELSE NULL::numeric
        END AS revenue_growth_pct,
    curr.ebitda AS current_ebitda,
    prev.ebitda AS previous_ebitda,
    curr.ebitda - COALESCE(prev.ebitda, 0::numeric) AS ebitda_delta,
    curr.contribution_margin_pct AS current_margin_pct,
    prev.contribution_margin_pct AS previous_margin_pct
   FROM v_pnl_monthly curr
     LEFT JOIN v_pnl_monthly prev ON prev.company_id = curr.company_id AND prev.outlet_id = curr.outlet_id AND prev.year = (curr.year - 1) AND prev.month = curr.month;

DROP TRIGGER IF EXISTS set_updated_at_active_invoices ON active_invoices;
CREATE TRIGGER set_updated_at_active_invoices BEFORE UPDATE ON active_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS budget_entries_lock_trigger ON budget_entries;
CREATE TRIGGER budget_entries_lock_trigger BEFORE UPDATE ON budget_entries FOR EACH ROW EXECUTE FUNCTION budget_entries_lock_check();

DROP TRIGGER IF EXISTS trg_update_bank_balance ON cash_movements;
CREATE TRIGGER trg_update_bank_balance AFTER INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION fn_update_bank_balance_after_movement();

DROP TRIGGER IF EXISTS trg_companies_updated ON companies;
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_contracts_notice ON contracts;
CREATE TRIGGER trg_contracts_notice BEFORE INSERT OR UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION calc_notice_deadline();

DROP TRIGGER IF EXISTS set_updated_at_electronic_invoices ON electronic_invoices;
CREATE TRIGGER set_updated_at_electronic_invoices BEFORE UPDATE ON electronic_invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoice_to_payable ON electronic_invoices;
CREATE TRIGGER trg_invoice_to_payable AFTER INSERT ON electronic_invoices FOR EACH ROW EXECUTE FUNCTION fn_invoice_to_payable();

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_fiscal_deadline_updated ON fiscal_deadlines;
CREATE TRIGGER trg_fiscal_deadline_updated BEFORE UPDATE ON fiscal_deadlines FOR EACH ROW EXECUTE FUNCTION update_fiscal_deadline_timestamp();

DROP TRIGGER IF EXISTS trg_monthly_actuals_updated ON monthly_actuals;
CREATE TRIGGER trg_monthly_actuals_updated BEFORE UPDATE ON monthly_actuals FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_outlet_attachments_updated ON outlet_attachments;
CREATE TRIGGER trg_outlet_attachments_updated BEFORE UPDATE ON outlet_attachments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_outlets_updated ON outlets;
CREATE TRIGGER trg_outlets_updated BEFORE UPDATE ON outlets FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_auto_categorize_payable ON payables;
CREATE TRIGGER trg_auto_categorize_payable BEFORE INSERT ON payables FOR EACH ROW EXECUTE FUNCTION fn_auto_categorize_payable();

DROP TRIGGER IF EXISTS trg_payable_status ON payables;
CREATE TRIGGER trg_payable_status BEFORE INSERT OR UPDATE ON payables FOR EACH ROW EXECUTE FUNCTION update_payable_status();

DROP TRIGGER IF EXISTS trg_prevent_duplicate_payable ON payables;
CREATE TRIGGER trg_prevent_duplicate_payable BEFORE INSERT ON payables FOR EACH ROW EXECUTE FUNCTION fn_prevent_duplicate_payable();

DROP TRIGGER IF EXISTS set_updated_at_sdi_config ON sdi_config;
CREATE TRIGGER set_updated_at_sdi_config BEFORE UPDATE ON sdi_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE active_invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_anomaly_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE ai_categorization_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE annual_budgets ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

ALTER TABLE balance_sheet_data ENABLE ROW LEVEL SECURITY;

ALTER TABLE balance_sheet_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_balances ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_statements ENABLE ROW LEVEL SECURITY;

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_approval_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_confronto ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_cost_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE budget_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE cash_budget ENABLE ROW LEVEL SECURITY;

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

ALTER TABLE cash_position ENABLE ROW LEVEL SECURITY;

ALTER TABLE chart_of_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_amount_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_deadlines ENABLE ROW LEVEL SECURITY;

ALTER TABLE contract_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

ALTER TABLE corrispettivi_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

ALTER TABLE csv_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE daily_receipts_ade ENABLE ROW LEVEL SECURITY;

ALTER TABLE daily_revenue ENABLE ROW LEVEL SECURITY;

ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE electronic_invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE employee_costs ENABLE ROW LEVEL SECURITY;

ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE employee_outlet_allocations ENABLE ROW LEVEL SECURITY;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

ALTER TABLE fiscal_deadlines ENABLE ROW LEVEL SECURITY;

ALTER TABLE import_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE import_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE loan_tranches ENABLE ROW LEVEL SECURITY;

ALTER TABLE loans ENABLE ROW LEVEL SECURITY;

ALTER TABLE manual_balance_entries ENABLE ROW LEVEL SECURITY;

ALTER TABLE monthly_actuals ENABLE ROW LEVEL SECURITY;

ALTER TABLE monthly_cost_lines ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_attachments ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_bank_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_cost_template ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_simulations ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlet_suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;

ALTER TABLE payable_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_batch_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_batches ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE payment_schedule ENABLE ROW LEVEL SECURITY;

ALTER TABLE pos_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE receipt_imports ENABLE ROW LEVEL SECURITY;

ALTER TABLE reconciliation_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE reconciliation_rejected_pairs ENABLE ROW LEVEL SECURITY;

ALTER TABLE recurring_costs ENABLE ROW LEVEL SECURITY;

ALTER TABLE sdi_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE sdi_sync_log ENABLE ROW LEVEL SECURITY;

ALTER TABLE supplier_allocation_details ENABLE ROW LEVEL SECURITY;

ALTER TABLE supplier_allocation_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_outlet_access ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE yapily_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE yapily_consents ENABLE ROW LEVEL SECURITY;

ALTER TABLE yapily_payments ENABLE ROW LEVEL SECURITY;

ALTER TABLE yapily_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "active_invoices_select" ON active_invoices;
CREATE POLICY "active_invoices_select" ON active_invoices AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "active_invoices_write" ON active_invoices;
CREATE POLICY "active_invoices_write" ON active_invoices AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "ai_anomaly_select" ON ai_anomaly_log;
CREATE POLICY "ai_anomaly_select" ON ai_anomaly_log AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "ai_anomaly_write" ON ai_anomaly_log;
CREATE POLICY "ai_anomaly_write" ON ai_anomaly_log AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "ai_rules_select" ON ai_categorization_rules;
CREATE POLICY "ai_rules_select" ON ai_categorization_rules AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "ai_rules_write" ON ai_categorization_rules;
CREATE POLICY "ai_rules_write" ON ai_categorization_rules AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "budgets_select" ON annual_budgets;
CREATE POLICY "budgets_select" ON annual_budgets AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "budgets_write" ON annual_budgets;
CREATE POLICY "budgets_write" ON annual_budgets AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "company_isolation" ON app_config;
CREATE POLICY "company_isolation" ON app_config AS PERMISSIVE
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid))
  WITH CHECK ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "app_users_select" ON app_users;
CREATE POLICY "app_users_select" ON app_users AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "app_users_write" ON app_users;
CREATE POLICY "app_users_write" ON app_users AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "balance_sheet_data_select" ON balance_sheet_data;
CREATE POLICY "balance_sheet_data_select" ON balance_sheet_data AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "balance_sheet_data_write" ON balance_sheet_data;
CREATE POLICY "balance_sheet_data_write" ON balance_sheet_data AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "balance_sheet_imports_select" ON balance_sheet_imports;
CREATE POLICY "balance_sheet_imports_select" ON balance_sheet_imports AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "balance_sheet_imports_write" ON balance_sheet_imports;
CREATE POLICY "balance_sheet_imports_write" ON balance_sheet_imports AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "bank_select" ON bank_accounts;
CREATE POLICY "bank_select" ON bank_accounts AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "bank_write" ON bank_accounts;
CREATE POLICY "bank_write" ON bank_accounts AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "balances_select" ON bank_balances;
CREATE POLICY "balances_select" ON bank_balances AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM bank_accounts ba
  WHERE ((ba.id = bank_balances.bank_account_id) AND (ba.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "balances_write" ON bank_balances;
CREATE POLICY "balances_write" ON bank_balances AS PERMISSIVE
  USING ((EXISTS ( SELECT 1
   FROM bank_accounts ba
  WHERE ((ba.id = bank_balances.bank_account_id) AND (ba.company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))))));

DROP POLICY IF EXISTS "bank_imports_select" ON bank_imports;
CREATE POLICY "bank_imports_select" ON bank_imports AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "bank_imports_write" ON bank_imports;
CREATE POLICY "bank_imports_write" ON bank_imports AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "bank_statements_company" ON bank_statements;
CREATE POLICY "bank_statements_company" ON bank_statements AS PERMISSIVE
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "bank_transactions_select" ON bank_transactions;
CREATE POLICY "bank_transactions_select" ON bank_transactions AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "bank_transactions_write" ON bank_transactions;
CREATE POLICY "bank_transactions_write" ON bank_transactions AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "company_isolation" ON bank_transactions;
CREATE POLICY "company_isolation" ON bank_transactions AS PERMISSIVE
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS "budget_approval_log_no_delete" ON budget_approval_log;
CREATE POLICY "budget_approval_log_no_delete" ON budget_approval_log AS PERMISSIVE FOR DELETE TO authenticated
  USING (false);

DROP POLICY IF EXISTS "budget_approval_log_no_direct_write" ON budget_approval_log;
CREATE POLICY "budget_approval_log_no_direct_write" ON budget_approval_log AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "budget_approval_log_no_update" ON budget_approval_log;
CREATE POLICY "budget_approval_log_no_update" ON budget_approval_log AS PERMISSIVE FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS "budget_approval_log_select" ON budget_approval_log;
CREATE POLICY "budget_approval_log_select" ON budget_approval_log AS PERMISSIVE FOR SELECT TO authenticated
  USING ((has_jwt_role('budget_approver'::text) AND ((jwt_company_id() IS NULL) OR (company_id = jwt_company_id()))));

DROP POLICY IF EXISTS "budget_confronto_budget_approver_write" ON budget_confronto;
CREATE POLICY "budget_confronto_budget_approver_write" ON budget_confronto AS PERMISSIVE TO authenticated
  USING ((has_jwt_role('budget_approver'::text) AND ((jwt_company_id() IS NULL) OR (company_id = jwt_company_id()))))
  WITH CHECK ((has_jwt_role('budget_approver'::text) AND ((jwt_company_id() IS NULL) OR (company_id = jwt_company_id()))));

DROP POLICY IF EXISTS "budget_confronto_select" ON budget_confronto;
CREATE POLICY "budget_confronto_select" ON budget_confronto AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "budget_confronto_write" ON budget_confronto;
CREATE POLICY "budget_confronto_write" ON budget_confronto AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "budget_lines_select" ON budget_cost_lines;
CREATE POLICY "budget_lines_select" ON budget_cost_lines AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM annual_budgets ab
  WHERE ((ab.id = budget_cost_lines.budget_id) AND (ab.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "budget_entries_budget_approver_write" ON budget_entries;
CREATE POLICY "budget_entries_budget_approver_write" ON budget_entries AS PERMISSIVE TO authenticated
  USING ((has_jwt_role('budget_approver'::text) AND ((jwt_company_id() IS NULL) OR (company_id = jwt_company_id()))))
  WITH CHECK ((has_jwt_role('budget_approver'::text) AND ((jwt_company_id() IS NULL) OR (company_id = jwt_company_id()))));

DROP POLICY IF EXISTS "budget_entries_select" ON budget_entries;
CREATE POLICY "budget_entries_select" ON budget_entries AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "budget_entries_write" ON budget_entries;
CREATE POLICY "budget_entries_write" ON budget_entries AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "cash_budget_select" ON cash_budget;
CREATE POLICY "cash_budget_select" ON cash_budget AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "cash_budget_write" ON cash_budget;
CREATE POLICY "cash_budget_write" ON cash_budget AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "cash_select" ON cash_movements;
CREATE POLICY "cash_select" ON cash_movements AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "cash_write" ON cash_movements;
CREATE POLICY "cash_write" ON cash_movements AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "cash_position_select" ON cash_position;
CREATE POLICY "cash_position_select" ON cash_position AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "cash_position_write" ON cash_position;
CREATE POLICY "cash_position_write" ON cash_position AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "chart_of_accounts_select" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_select" ON chart_of_accounts AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "chart_of_accounts_write" ON chart_of_accounts;
CREATE POLICY "chart_of_accounts_write" ON chart_of_accounts AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "companies_select" ON companies;
CREATE POLICY "companies_select" ON companies AS PERMISSIVE FOR SELECT
  USING ((id = get_my_company_id()));

DROP POLICY IF EXISTS "companies_update" ON companies;
CREATE POLICY "companies_update" ON companies AS PERMISSIVE FOR UPDATE
  USING (((id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "company_settings_select" ON company_settings;
CREATE POLICY "company_settings_select" ON company_settings AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "company_settings_write" ON company_settings;
CREATE POLICY "company_settings_write" ON company_settings AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "amount_history_select" ON contract_amount_history;
CREATE POLICY "amount_history_select" ON contract_amount_history AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM contracts c
  WHERE ((c.id = contract_amount_history.contract_id) AND (c.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "deadlines_select" ON contract_deadlines;
CREATE POLICY "deadlines_select" ON contract_deadlines AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM contracts c
  WHERE ((c.id = contract_deadlines.contract_id) AND (c.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "contract_documents_select" ON contract_documents;
CREATE POLICY "contract_documents_select" ON contract_documents AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "contract_documents_write" ON contract_documents;
CREATE POLICY "contract_documents_write" ON contract_documents AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "contracts_select" ON contracts;
CREATE POLICY "contracts_select" ON contracts AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "contracts_write" ON contracts;
CREATE POLICY "contracts_write" ON contracts AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "corrispettivi_select" ON corrispettivi_log;
CREATE POLICY "corrispettivi_select" ON corrispettivi_log AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "corrispettivi_write" ON corrispettivi_log;
CREATE POLICY "corrispettivi_write" ON corrispettivi_log AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "cost_cat_select" ON cost_categories;
CREATE POLICY "cost_cat_select" ON cost_categories AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "cost_cat_write" ON cost_categories;
CREATE POLICY "cost_cat_write" ON cost_categories AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "cost_centers_select" ON cost_centers;
CREATE POLICY "cost_centers_select" ON cost_centers AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "cost_centers_write" ON cost_centers;
CREATE POLICY "cost_centers_write" ON cost_centers AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "csv_select" ON csv_mappings;
CREATE POLICY "csv_select" ON csv_mappings AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "csv_write" ON csv_mappings;
CREATE POLICY "csv_write" ON csv_mappings AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "receipts_select" ON daily_receipts_ade;
CREATE POLICY "receipts_select" ON daily_receipts_ade AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "receipts_write" ON daily_receipts_ade;
CREATE POLICY "receipts_write" ON daily_receipts_ade AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "revenue_select" ON daily_revenue;
CREATE POLICY "revenue_select" ON daily_revenue AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND has_outlet_access(outlet_id)));

DROP POLICY IF EXISTS "revenue_write" ON daily_revenue;
CREATE POLICY "revenue_write" ON daily_revenue AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "document_versions_select" ON document_versions;
CREATE POLICY "document_versions_select" ON document_versions AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "document_versions_write" ON document_versions;
CREATE POLICY "document_versions_write" ON document_versions AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "documents_select" ON documents;
CREATE POLICY "documents_select" ON documents AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "documents_write" ON documents;
CREATE POLICY "documents_write" ON documents AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "invoices_select" ON electronic_invoices;
CREATE POLICY "invoices_select" ON electronic_invoices AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "invoices_write" ON electronic_invoices;
CREATE POLICY "invoices_write" ON electronic_invoices AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "employee_costs_select" ON employee_costs;
CREATE POLICY "employee_costs_select" ON employee_costs AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "employee_costs_write" ON employee_costs;
CREATE POLICY "employee_costs_write" ON employee_costs AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "employee_documents_select" ON employee_documents;
CREATE POLICY "employee_documents_select" ON employee_documents AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "employee_documents_write" ON employee_documents;
CREATE POLICY "employee_documents_write" ON employee_documents AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "employee_outlet_allocations_select" ON employee_outlet_allocations;
CREATE POLICY "employee_outlet_allocations_select" ON employee_outlet_allocations AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "employee_outlet_allocations_write" ON employee_outlet_allocations;
CREATE POLICY "employee_outlet_allocations_write" ON employee_outlet_allocations AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "employees_select" ON employees;
CREATE POLICY "employees_select" ON employees AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND ((outlet_id IS NULL) OR has_outlet_access(outlet_id))));

DROP POLICY IF EXISTS "employees_write" ON employees;
CREATE POLICY "employees_write" ON employees AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "fiscal_deadlines_delete" ON fiscal_deadlines;
CREATE POLICY "fiscal_deadlines_delete" ON fiscal_deadlines AS PERMISSIVE FOR DELETE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'cfo'::user_role]))));

DROP POLICY IF EXISTS "fiscal_deadlines_insert" ON fiscal_deadlines;
CREATE POLICY "fiscal_deadlines_insert" ON fiscal_deadlines AS PERMISSIVE FOR INSERT
  WITH CHECK ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "fiscal_deadlines_select" ON fiscal_deadlines;
CREATE POLICY "fiscal_deadlines_select" ON fiscal_deadlines AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "fiscal_deadlines_update" ON fiscal_deadlines;
CREATE POLICY "fiscal_deadlines_update" ON fiscal_deadlines AS PERMISSIVE FOR UPDATE
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "imports_select" ON import_batches;
CREATE POLICY "imports_select" ON import_batches AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "imports_write" ON import_batches;
CREATE POLICY "imports_write" ON import_batches AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "import_documents_select" ON import_documents;
CREATE POLICY "import_documents_select" ON import_documents AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "import_documents_write" ON import_documents;
CREATE POLICY "import_documents_write" ON import_documents AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "invoices_select" ON invoices;
CREATE POLICY "invoices_select" ON invoices AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "invoices_write" ON invoices;
CREATE POLICY "invoices_write" ON invoices AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "tranches_select" ON loan_tranches;
CREATE POLICY "tranches_select" ON loan_tranches AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM loans l
  WHERE ((l.id = loan_tranches.loan_id) AND (l.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "tranches_write" ON loan_tranches;
CREATE POLICY "tranches_write" ON loan_tranches AS PERMISSIVE
  USING ((EXISTS ( SELECT 1
   FROM loans l
  WHERE ((l.id = loan_tranches.loan_id) AND (l.company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)))));

DROP POLICY IF EXISTS "loans_select" ON loans;
CREATE POLICY "loans_select" ON loans AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "loans_write" ON loans;
CREATE POLICY "loans_write" ON loans AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "manual_balance_entries_company" ON manual_balance_entries;
CREATE POLICY "manual_balance_entries_company" ON manual_balance_entries AS PERMISSIVE
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "actuals_select" ON monthly_actuals;
CREATE POLICY "actuals_select" ON monthly_actuals AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND ((outlet_id IS NULL) OR has_outlet_access(outlet_id))));

DROP POLICY IF EXISTS "actuals_write" ON monthly_actuals;
CREATE POLICY "actuals_write" ON monthly_actuals AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])) AND ((status <> 'chiuso'::period_status) OR (get_my_role() = 'super_advisor'::user_role))));

DROP POLICY IF EXISTS "cost_lines_select" ON monthly_cost_lines;
CREATE POLICY "cost_lines_select" ON monthly_cost_lines AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM monthly_actuals ma
  WHERE ((ma.id = monthly_cost_lines.monthly_actual_id) AND (ma.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "cost_lines_write" ON monthly_cost_lines;
CREATE POLICY "cost_lines_write" ON monthly_cost_lines AS PERMISSIVE
  USING ((EXISTS ( SELECT 1
   FROM monthly_actuals ma
  WHERE ((ma.id = monthly_cost_lines.monthly_actual_id) AND (ma.company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role])) AND ((ma.status <> 'chiuso'::period_status) OR (get_my_role() = 'super_advisor'::user_role))))));

DROP POLICY IF EXISTS "notif_prefs_select" ON notification_preferences;
CREATE POLICY "notif_prefs_select" ON notification_preferences AS PERMISSIVE FOR SELECT
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "notif_prefs_update" ON notification_preferences;
CREATE POLICY "notif_prefs_update" ON notification_preferences AS PERMISSIVE FOR UPDATE
  USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "notif_prefs_upsert" ON notification_preferences;
CREATE POLICY "notif_prefs_upsert" ON notification_preferences AS PERMISSIVE FOR INSERT
  WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "notifications_insert" ON notifications;
CREATE POLICY "notifications_insert" ON notifications AS PERMISSIVE FOR INSERT
  WITH CHECK ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND ((user_id = auth.uid()) OR (user_id IS NULL))));

DROP POLICY IF EXISTS "notifications_update" ON notifications;
CREATE POLICY "notifications_update" ON notifications AS PERMISSIVE FOR UPDATE
  USING (((company_id = get_my_company_id()) AND ((user_id = auth.uid()) OR (user_id IS NULL))));

DROP POLICY IF EXISTS "attachments_select" ON outlet_attachments;
CREATE POLICY "attachments_select" ON outlet_attachments AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "attachments_write" ON outlet_attachments;
CREATE POLICY "attachments_write" ON outlet_attachments AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "outlet_banks_select" ON outlet_bank_accounts;
CREATE POLICY "outlet_banks_select" ON outlet_bank_accounts AS PERMISSIVE FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS "outlet_banks_write" ON outlet_bank_accounts;
CREATE POLICY "outlet_banks_write" ON outlet_bank_accounts AS PERMISSIVE
  USING ((get_my_role() = 'super_advisor'::user_role));

DROP POLICY IF EXISTS "outlet_costs_select" ON outlet_cost_template;
CREATE POLICY "outlet_costs_select" ON outlet_cost_template AS PERMISSIVE FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS "outlet_costs_write" ON outlet_cost_template;
CREATE POLICY "outlet_costs_write" ON outlet_cost_template AS PERMISSIVE
  USING ((get_my_role() = 'super_advisor'::user_role));

DROP POLICY IF EXISTS "Users can manage company simulations" ON outlet_simulations;
CREATE POLICY "Users can manage company simulations" ON outlet_simulations AS PERMISSIVE
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS "outlet_suppliers_select" ON outlet_suppliers;
CREATE POLICY "outlet_suppliers_select" ON outlet_suppliers AS PERMISSIVE FOR SELECT
  USING (has_outlet_access(outlet_id));

DROP POLICY IF EXISTS "outlet_suppliers_write" ON outlet_suppliers;
CREATE POLICY "outlet_suppliers_write" ON outlet_suppliers AS PERMISSIVE
  USING ((get_my_role() = 'super_advisor'::user_role));

DROP POLICY IF EXISTS "outlets_insert" ON outlets;
CREATE POLICY "outlets_insert" ON outlets AS PERMISSIVE FOR INSERT
  WITH CHECK (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "outlets_select" ON outlets;
CREATE POLICY "outlets_select" ON outlets AS PERMISSIVE FOR SELECT
  USING (((company_id = get_my_company_id()) AND has_outlet_access(id)));

DROP POLICY IF EXISTS "outlets_update" ON outlets;
CREATE POLICY "outlets_update" ON outlets AS PERMISSIVE FOR UPDATE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = 'super_advisor'::user_role)));

DROP POLICY IF EXISTS "actions_select" ON payable_actions;
CREATE POLICY "actions_select" ON payable_actions AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM payables p
  WHERE ((p.id = payable_actions.payable_id) AND (p.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "actions_write" ON payable_actions;
CREATE POLICY "actions_write" ON payable_actions AS PERMISSIVE
  USING ((EXISTS ( SELECT 1
   FROM payables p
  WHERE ((p.id = payable_actions.payable_id) AND (p.company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))))));

DROP POLICY IF EXISTS "payables_select" ON payables;
CREATE POLICY "payables_select" ON payables AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "payables_write" ON payables;
CREATE POLICY "payables_write" ON payables AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "payment_batch_items_company" ON payment_batch_items;
CREATE POLICY "payment_batch_items_company" ON payment_batch_items AS PERMISSIVE
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "payment_batches_company" ON payment_batches;
CREATE POLICY "payment_batches_company" ON payment_batches AS PERMISSIVE
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "payment_records_select" ON payment_records;
CREATE POLICY "payment_records_select" ON payment_records AS PERMISSIVE FOR SELECT
  USING ((EXISTS ( SELECT 1
   FROM payables p
  WHERE ((p.id = payment_records.payable_id) AND (p.company_id = get_my_company_id())))));

DROP POLICY IF EXISTS "payment_records_write" ON payment_records;
CREATE POLICY "payment_records_write" ON payment_records AS PERMISSIVE
  USING ((EXISTS ( SELECT 1
   FROM payables p
  WHERE ((p.id = payment_records.payable_id) AND (p.company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))))));

DROP POLICY IF EXISTS "payment_schedule_select" ON payment_schedule;
CREATE POLICY "payment_schedule_select" ON payment_schedule AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "payment_schedule_write" ON payment_schedule;
CREATE POLICY "payment_schedule_write" ON payment_schedule AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "pos_imports_select" ON pos_imports;
CREATE POLICY "pos_imports_select" ON pos_imports AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "pos_imports_write" ON pos_imports;
CREATE POLICY "pos_imports_write" ON pos_imports AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "receipt_imports_select" ON receipt_imports;
CREATE POLICY "receipt_imports_select" ON receipt_imports AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "receipt_imports_write" ON receipt_imports;
CREATE POLICY "receipt_imports_write" ON receipt_imports AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "reconciliation_log_company" ON reconciliation_log;
CREATE POLICY "reconciliation_log_company" ON reconciliation_log AS PERMISSIVE
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "reconciliation_rejected_pairs_company" ON reconciliation_rejected_pairs;
CREATE POLICY "reconciliation_rejected_pairs_company" ON reconciliation_rejected_pairs AS PERMISSIVE
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "recurring_costs_select" ON recurring_costs;
CREATE POLICY "recurring_costs_select" ON recurring_costs AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "recurring_costs_write" ON recurring_costs;
CREATE POLICY "recurring_costs_write" ON recurring_costs AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "sdi_config_select" ON sdi_config;
CREATE POLICY "sdi_config_select" ON sdi_config AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "sdi_config_write" ON sdi_config;
CREATE POLICY "sdi_config_write" ON sdi_config AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "sdi_sync_log_select_own_company" ON sdi_sync_log;
CREATE POLICY "sdi_sync_log_select_own_company" ON sdi_sync_log AS PERMISSIVE FOR SELECT
  USING ((company_id = (((auth.jwt() -> 'app_metadata'::text) ->> 'company_id'::text))::uuid));

DROP POLICY IF EXISTS "company_isolation" ON supplier_allocation_details;
CREATE POLICY "company_isolation" ON supplier_allocation_details AS PERMISSIVE
  USING ((rule_id IN ( SELECT supplier_allocation_rules.id
   FROM supplier_allocation_rules
  WHERE (supplier_allocation_rules.company_id IN ( SELECT user_profiles.company_id
           FROM user_profiles
          WHERE (user_profiles.id = auth.uid()))))));

DROP POLICY IF EXISTS "company_isolation" ON supplier_allocation_rules;
CREATE POLICY "company_isolation" ON supplier_allocation_rules AS PERMISSIVE
  USING ((company_id IN ( SELECT user_profiles.company_id
   FROM user_profiles
  WHERE (user_profiles.id = auth.uid()))));

DROP POLICY IF EXISTS "suppliers_select" ON suppliers;
CREATE POLICY "suppliers_select" ON suppliers AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "suppliers_write" ON suppliers;
CREATE POLICY "suppliers_write" ON suppliers AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "user_outlet_access_select" ON user_outlet_access;
CREATE POLICY "user_outlet_access_select" ON user_outlet_access AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "user_outlet_access_write" ON user_outlet_access;
CREATE POLICY "user_outlet_access_write" ON user_outlet_access AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "profiles_own_update" ON user_profiles;
CREATE POLICY "profiles_own_update" ON user_profiles AS PERMISSIVE FOR UPDATE
  USING ((id = auth.uid()));

DROP POLICY IF EXISTS "profiles_select" ON user_profiles;
CREATE POLICY "profiles_select" ON user_profiles AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "yapily_accounts_select" ON yapily_accounts;
CREATE POLICY "yapily_accounts_select" ON yapily_accounts AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "yapily_accounts_write" ON yapily_accounts;
CREATE POLICY "yapily_accounts_write" ON yapily_accounts AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "yapily_consents_select" ON yapily_consents;
CREATE POLICY "yapily_consents_select" ON yapily_consents AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "yapily_consents_write" ON yapily_consents;
CREATE POLICY "yapily_consents_write" ON yapily_consents AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "yapily_payments_select" ON yapily_payments;
CREATE POLICY "yapily_payments_select" ON yapily_payments AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "yapily_payments_write" ON yapily_payments;
CREATE POLICY "yapily_payments_write" ON yapily_payments AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

DROP POLICY IF EXISTS "yapily_transactions_select" ON yapily_transactions;
CREATE POLICY "yapily_transactions_select" ON yapily_transactions AS PERMISSIVE FOR SELECT
  USING ((company_id = get_my_company_id()));

DROP POLICY IF EXISTS "yapily_transactions_write" ON yapily_transactions;
CREATE POLICY "yapily_transactions_write" ON yapily_transactions AS PERMISSIVE
  USING (((company_id = get_my_company_id()) AND (get_my_role() = ANY (ARRAY['super_advisor'::user_role, 'contabile'::user_role]))));

-- Le 7 migrazioni delta (001-007) sono già incorporate in questo baseline.
-- Le marchiamo come applicate per evitare re-run su tenant nuovi.
INSERT INTO public._migrations_log (filename, checksum) VALUES
  ('20260417_001_add_company_id_rls_policies_16_tables.sql', 'incorporated-in-baseline'),
  ('20260417_002_remove_legacy_auth_policies.sql', 'incorporated-in-baseline'),
  ('20260417_003_add_company_id_3_tables.sql', 'incorporated-in-baseline'),
  ('20260417_004_create_yapily_tables.sql', 'incorporated-in-baseline'),
  ('20260417_005_create_get_yapily_credentials_rpc.sql', 'incorporated-in-baseline'),
  ('20260417_006_add_yapily_source_and_link.sql', 'incorporated-in-baseline'),
  ('20260421_007_budget_entries_fix_and_bilancio_gap.sql', 'incorporated-in-baseline')
ON CONFLICT (filename) DO NOTHING;
