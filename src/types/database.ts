export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      active_invoices: {
        Row: {
          acube_uuid: string | null
          client_fiscal_code: string | null
          client_name: string
          client_vat: string | null
          codice_destinatario: string | null
          company_id: string
          created_at: string | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          outlet_id: string | null
          payment_method: string | null
          payment_terms: string | null
          pec_destinatario: string | null
          sdi_id: string | null
          sdi_notifications: Json | null
          sdi_status: string | null
          taxable_amount: number | null
          tipo_documento: string
          total_amount: number
          updated_at: string | null
          vat_amount: number | null
          vat_rate: number | null
          xml_content: string | null
          xml_file_path: string | null
        }
        Insert: {
          acube_uuid?: string | null
          client_fiscal_code?: string | null
          client_name: string
          client_vat?: string | null
          codice_destinatario?: string | null
          company_id: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          pec_destinatario?: string | null
          sdi_id?: string | null
          sdi_notifications?: Json | null
          sdi_status?: string | null
          taxable_amount?: number | null
          tipo_documento?: string
          total_amount: number
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          xml_content?: string | null
          xml_file_path?: string | null
        }
        Update: {
          acube_uuid?: string | null
          client_fiscal_code?: string | null
          client_name?: string
          client_vat?: string | null
          codice_destinatario?: string | null
          company_id?: string
          created_at?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          pec_destinatario?: string | null
          sdi_id?: string | null
          sdi_notifications?: Json | null
          sdi_status?: string | null
          taxable_amount?: number | null
          tipo_documento?: string
          total_amount?: number
          updated_at?: string | null
          vat_amount?: number | null
          vat_rate?: number | null
          xml_content?: string | null
          xml_file_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "active_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "active_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "active_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      acube_accounts: {
        Row: {
          account_id: string
          account_number: string | null
          balance: number | null
          bank_account_id: string | null
          bban: string | null
          business_registry_uuid: string
          connection_id: string | null
          consent_expires_at: string | null
          created_at: string
          currency_code: string
          enabled: boolean | null
          extra: Json | null
          iban: string | null
          name: string
          nature: string
          provider_country: string | null
          provider_name: string
          swift: string | null
          systems: string[] | null
          updated_at: string
          uuid: string
        }
        Insert: {
          account_id: string
          account_number?: string | null
          balance?: number | null
          bank_account_id?: string | null
          bban?: string | null
          business_registry_uuid: string
          connection_id?: string | null
          consent_expires_at?: string | null
          created_at?: string
          currency_code: string
          enabled?: boolean | null
          extra?: Json | null
          iban?: string | null
          name: string
          nature: string
          provider_country?: string | null
          provider_name: string
          swift?: string | null
          systems?: string[] | null
          updated_at?: string
          uuid: string
        }
        Update: {
          account_id?: string
          account_number?: string | null
          balance?: number | null
          bank_account_id?: string | null
          bban?: string | null
          business_registry_uuid?: string
          connection_id?: string | null
          consent_expires_at?: string | null
          created_at?: string
          currency_code?: string
          enabled?: boolean | null
          extra?: Json | null
          iban?: string | null
          name?: string
          nature?: string
          provider_country?: string | null
          provider_name?: string
          swift?: string | null
          systems?: string[] | null
          updated_at?: string
          uuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "acube_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acube_accounts_business_registry_uuid_fkey"
            columns: ["business_registry_uuid"]
            isOneToOne: false
            referencedRelation: "acube_business_registries"
            referencedColumns: ["uuid"]
          },
        ]
      }
      acube_business_registries: {
        Row: {
          business_name: string
          country: string | null
          created_at: string
          email: string
          email_alerts: boolean | null
          enabled: boolean | null
          fiscal_id: string
          locale: string | null
          stage: string
          sub_account_id: number | null
          type: string
          updated_at: string
          uuid: string
        }
        Insert: {
          business_name: string
          country?: string | null
          created_at?: string
          email: string
          email_alerts?: boolean | null
          enabled?: boolean | null
          fiscal_id: string
          locale?: string | null
          stage: string
          sub_account_id?: number | null
          type?: string
          updated_at?: string
          uuid: string
        }
        Update: {
          business_name?: string
          country?: string | null
          created_at?: string
          email?: string
          email_alerts?: boolean | null
          enabled?: boolean | null
          fiscal_id?: string
          locale?: string | null
          stage?: string
          sub_account_id?: number | null
          type?: string
          updated_at?: string
          uuid?: string
        }
        Relationships: []
      }
      acube_cassetto_fiscale_config: {
        Row: {
          appointee_assigned_at: string | null
          appointee_assigned_by_user_id: string | null
          appointee_fiscal_id: string | null
          business_registry_uuid: string
          company_id: string
          created_at: string
          error_message: string | null
          fiscal_id: string
          id: string
          last_status_check_at: string | null
          last_sync_at: string | null
          last_sync_invoices_count: number | null
          notes: string | null
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          appointee_assigned_at?: string | null
          appointee_assigned_by_user_id?: string | null
          appointee_fiscal_id?: string | null
          business_registry_uuid: string
          company_id: string
          created_at?: string
          error_message?: string | null
          fiscal_id: string
          id?: string
          last_status_check_at?: string | null
          last_sync_at?: string | null
          last_sync_invoices_count?: number | null
          notes?: string | null
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          appointee_assigned_at?: string | null
          appointee_assigned_by_user_id?: string | null
          appointee_fiscal_id?: string | null
          business_registry_uuid?: string
          company_id?: string
          created_at?: string
          error_message?: string | null
          fiscal_id?: string
          id?: string
          last_status_check_at?: string | null
          last_sync_at?: string | null
          last_sync_invoices_count?: number | null
          notes?: string | null
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acube_cassetto_fiscale_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      acube_cassetto_fiscale_pulls: {
        Row: {
          company_id: string
          completed_at: string | null
          config_id: string
          date_from: string | null
          date_to: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          invoice_type: string | null
          invoices_duplicates: number | null
          invoices_failed: number | null
          invoices_fetched: number | null
          invoices_inserted: number | null
          raw_response: Json | null
          started_at: string
          status: string
          triggered_by_cron: boolean | null
          triggered_by_user_id: string | null
        }
        Insert: {
          company_id: string
          completed_at?: string | null
          config_id: string
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          invoice_type?: string | null
          invoices_duplicates?: number | null
          invoices_failed?: number | null
          invoices_fetched?: number | null
          invoices_inserted?: number | null
          raw_response?: Json | null
          started_at?: string
          status: string
          triggered_by_cron?: boolean | null
          triggered_by_user_id?: string | null
        }
        Update: {
          company_id?: string
          completed_at?: string | null
          config_id?: string
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          invoice_type?: string | null
          invoices_duplicates?: number | null
          invoices_failed?: number | null
          invoices_fetched?: number | null
          invoices_inserted?: number | null
          raw_response?: Json | null
          started_at?: string
          status?: string
          triggered_by_cron?: boolean | null
          triggered_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acube_cassetto_fiscale_pulls_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acube_cassetto_fiscale_pulls_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "acube_cassetto_fiscale_config"
            referencedColumns: ["id"]
          },
        ]
      }
      acube_consents: {
        Row: {
          business_registry_uuid: string
          connect_url: string | null
          created_at: string
          days: number | null
          expires_at: string | null
          granted_at: string | null
          id: string
          notice_level: string | null
          raw_webhook: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          business_registry_uuid: string
          connect_url?: string | null
          created_at?: string
          days?: number | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          notice_level?: string | null
          raw_webhook?: Json | null
          status: string
          updated_at?: string
        }
        Update: {
          business_registry_uuid?: string
          connect_url?: string | null
          created_at?: string
          days?: number | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          notice_level?: string | null
          raw_webhook?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acube_consents_business_registry_uuid_fkey"
            columns: ["business_registry_uuid"]
            isOneToOne: false
            referencedRelation: "acube_business_registries"
            referencedColumns: ["uuid"]
          },
        ]
      }
      acube_sdi_business_registry_configs: {
        Row: {
          apply_signature: boolean | null
          created_at: string
          customer_invoice_enabled: boolean | null
          email: string | null
          fiscal_id: string
          legal_storage_active: boolean | null
          name: string
          raw_config: Json | null
          receipts_enabled: boolean | null
          stage: string
          supplier_invoice_enabled: boolean | null
          updated_at: string
          vat_number: string
        }
        Insert: {
          apply_signature?: boolean | null
          created_at?: string
          customer_invoice_enabled?: boolean | null
          email?: string | null
          fiscal_id: string
          legal_storage_active?: boolean | null
          name: string
          raw_config?: Json | null
          receipts_enabled?: boolean | null
          stage: string
          supplier_invoice_enabled?: boolean | null
          updated_at?: string
          vat_number: string
        }
        Update: {
          apply_signature?: boolean | null
          created_at?: string
          customer_invoice_enabled?: boolean | null
          email?: string | null
          fiscal_id?: string
          legal_storage_active?: boolean | null
          name?: string
          raw_config?: Json | null
          receipts_enabled?: boolean | null
          stage?: string
          supplier_invoice_enabled?: boolean | null
          updated_at?: string
          vat_number?: string
        }
        Relationships: []
      }
      acube_sdi_invoices: {
        Row: {
          acube_created_at: string | null
          acube_uuid: string
          business_fiscal_id: string
          created_at: string
          currency: string | null
          direction: string
          document_type: string | null
          downloaded: boolean | null
          downloaded_at: string | null
          fetched_at: string
          id: string
          invoice_date: string | null
          invoice_number: string | null
          legally_stored: boolean | null
          marking: string | null
          notifications: Json | null
          payload: Json
          recipient_code: string | null
          recipient_name: string | null
          recipient_uuid: string | null
          recipient_vat: string | null
          sdi_file_id: string | null
          sdi_file_name: string | null
          sender_country: string | null
          sender_name: string | null
          sender_uuid: string | null
          sender_vat: string | null
          signed: boolean | null
          to_pa: boolean | null
          total_amount: number | null
          transmission_format: string | null
          type: number | null
          updated_at: string
          xml_content: string | null
        }
        Insert: {
          acube_created_at?: string | null
          acube_uuid: string
          business_fiscal_id: string
          created_at?: string
          currency?: string | null
          direction: string
          document_type?: string | null
          downloaded?: boolean | null
          downloaded_at?: string | null
          fetched_at?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          legally_stored?: boolean | null
          marking?: string | null
          notifications?: Json | null
          payload: Json
          recipient_code?: string | null
          recipient_name?: string | null
          recipient_uuid?: string | null
          recipient_vat?: string | null
          sdi_file_id?: string | null
          sdi_file_name?: string | null
          sender_country?: string | null
          sender_name?: string | null
          sender_uuid?: string | null
          sender_vat?: string | null
          signed?: boolean | null
          to_pa?: boolean | null
          total_amount?: number | null
          transmission_format?: string | null
          type?: number | null
          updated_at?: string
          xml_content?: string | null
        }
        Update: {
          acube_created_at?: string | null
          acube_uuid?: string
          business_fiscal_id?: string
          created_at?: string
          currency?: string | null
          direction?: string
          document_type?: string | null
          downloaded?: boolean | null
          downloaded_at?: string | null
          fetched_at?: string
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          legally_stored?: boolean | null
          marking?: string | null
          notifications?: Json | null
          payload?: Json
          recipient_code?: string | null
          recipient_name?: string | null
          recipient_uuid?: string | null
          recipient_vat?: string | null
          sdi_file_id?: string | null
          sdi_file_name?: string | null
          sender_country?: string | null
          sender_name?: string | null
          sender_uuid?: string | null
          sender_vat?: string | null
          signed?: boolean | null
          to_pa?: boolean | null
          total_amount?: number | null
          transmission_format?: string | null
          type?: number | null
          updated_at?: string
          xml_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acube_sdi_invoices_business_fiscal_id_fkey"
            columns: ["business_fiscal_id"]
            isOneToOne: false
            referencedRelation: "acube_sdi_business_registry_configs"
            referencedColumns: ["fiscal_id"]
          },
        ]
      }
      acube_sdi_webhook_log: {
        Row: {
          business_fiscal_id: string | null
          event: string
          id: string
          invoice_uuid: string | null
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          raw_headers: Json | null
          received_at: string
          signature_valid: boolean | null
        }
        Insert: {
          business_fiscal_id?: string | null
          event: string
          id?: string
          invoice_uuid?: string | null
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          raw_headers?: Json | null
          received_at?: string
          signature_valid?: boolean | null
        }
        Update: {
          business_fiscal_id?: string | null
          event?: string
          id?: string
          invoice_uuid?: string | null
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          raw_headers?: Json | null
          received_at?: string
          signature_valid?: boolean | null
        }
        Relationships: []
      }
      acube_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          jwt: string
          stage: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          jwt: string
          stage: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          jwt?: string
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      acube_transactions: {
        Row: {
          acube_account_uuid: string
          acube_created_at: string | null
          acube_transaction_id: string
          acube_updated_at: string | null
          additional: string | null
          amount: number
          categorization_confidence: number | null
          category: string | null
          closing_balance: number | null
          created_at: string
          currency_code: string
          dedup_hash: string
          description: string | null
          duplicated: boolean | null
          end_to_end_id: string | null
          extra: Json | null
          fetched_at: string
          id: string
          made_on: string
          mcc: string | null
          merchant_id: string | null
          payee: string | null
          payer: string | null
          posting_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          acube_account_uuid: string
          acube_created_at?: string | null
          acube_transaction_id: string
          acube_updated_at?: string | null
          additional?: string | null
          amount: number
          categorization_confidence?: number | null
          category?: string | null
          closing_balance?: number | null
          created_at?: string
          currency_code: string
          dedup_hash: string
          description?: string | null
          duplicated?: boolean | null
          end_to_end_id?: string | null
          extra?: Json | null
          fetched_at?: string
          id?: string
          made_on: string
          mcc?: string | null
          merchant_id?: string | null
          payee?: string | null
          payer?: string | null
          posting_date?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          acube_account_uuid?: string
          acube_created_at?: string | null
          acube_transaction_id?: string
          acube_updated_at?: string | null
          additional?: string | null
          amount?: number
          categorization_confidence?: number | null
          category?: string | null
          closing_balance?: number | null
          created_at?: string
          currency_code?: string
          dedup_hash?: string
          description?: string | null
          duplicated?: boolean | null
          end_to_end_id?: string | null
          extra?: Json | null
          fetched_at?: string
          id?: string
          made_on?: string
          mcc?: string | null
          merchant_id?: string | null
          payee?: string | null
          payer?: string | null
          posting_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acube_transactions_acube_account_uuid_fkey"
            columns: ["acube_account_uuid"]
            isOneToOne: false
            referencedRelation: "acube_accounts"
            referencedColumns: ["uuid"]
          },
        ]
      }
      acube_webhook_log: {
        Row: {
          event: string
          id: string
          payload: Json
          processed: boolean
          processed_at: string | null
          processing_error: string | null
          received_at: string
          signature_valid: boolean
        }
        Insert: {
          event: string
          id?: string
          payload: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          signature_valid: boolean
        }
        Update: {
          event?: string
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
          signature_valid?: boolean
        }
        Relationships: []
      }
      ai_anomaly_log: {
        Row: {
          anomaly_type: string
          company_id: string
          created_at: string | null
          description: string | null
          details: Json | null
          entity_id: string
          entity_type: string
          id: string
          is_resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string | null
        }
        Insert: {
          anomaly_type: string
          company_id: string
          created_at?: string | null
          description?: string | null
          details?: Json | null
          entity_id: string
          entity_type: string
          id?: string
          is_resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
        }
        Update: {
          anomaly_type?: string
          company_id?: string
          created_at?: string | null
          description?: string | null
          details?: Json | null
          entity_id?: string
          entity_type?: string
          id?: string
          is_resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_anomaly_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_categorization_rules: {
        Row: {
          amount_max: number | null
          amount_min: number | null
          category_id: string
          company_id: string
          confidence: number | null
          counterpart_pattern: string | null
          created_at: string | null
          description_pattern: string | null
          id: string
          is_active: boolean | null
          last_used_at: string | null
          rule_type: string
          times_confirmed: number | null
        }
        Insert: {
          amount_max?: number | null
          amount_min?: number | null
          category_id: string
          company_id: string
          confidence?: number | null
          counterpart_pattern?: string | null
          created_at?: string | null
          description_pattern?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          rule_type: string
          times_confirmed?: number | null
        }
        Update: {
          amount_max?: number | null
          amount_min?: number | null
          category_id?: string
          company_id?: string
          confidence?: number | null
          counterpart_pattern?: string | null
          created_at?: string | null
          description_pattern?: string | null
          id?: string
          is_active?: boolean | null
          last_used_at?: string | null
          rule_type?: string
          times_confirmed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_categorization_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_categorization_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "ai_categorization_rules_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      annual_budgets: {
        Row: {
          admin_compensation_annual: number | null
          company_id: string
          condo_marketing_annual: number | null
          cost_of_goods_pct: number | null
          created_at: string | null
          id: string
          notes: string | null
          outlet_id: string | null
          rent_annual: number | null
          revenue_bp: number | null
          revenue_target: number | null
          staff_cost_annual: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          admin_compensation_annual?: number | null
          company_id: string
          condo_marketing_annual?: number | null
          cost_of_goods_pct?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          outlet_id?: string | null
          rent_annual?: number | null
          revenue_bp?: number | null
          revenue_target?: number | null
          staff_cost_annual?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          admin_compensation_annual?: number | null
          company_id?: string
          condo_marketing_annual?: number | null
          cost_of_goods_pct?: number | null
          created_at?: string | null
          id?: string
          notes?: string | null
          outlet_id?: string | null
          rent_annual?: number | null
          revenue_bp?: number | null
          revenue_target?: number | null
          staff_cost_annual?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "annual_budgets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_budgets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "annual_budgets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "annual_budgets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "annual_budgets_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      app_config: {
        Row: {
          company_id: string
          created_at: string | null
          id: string
          sdi_emission_enabled: boolean
          updated_at: string | null
          yapily_environment: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          sdi_emission_enabled?: boolean
          updated_at?: string | null
          yapily_environment?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
          sdi_emission_enabled?: boolean
          updated_at?: string | null
          yapily_environment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          auth_user_id: string | null
          cognome: string
          company_id: string
          created_at: string | null
          email: string
          id: string
          is_active: boolean | null
          nome: string
          outlet_access: string[] | null
          ruolo: string
          updated_at: string | null
        }
        Insert: {
          auth_user_id?: string | null
          cognome: string
          company_id?: string
          created_at?: string | null
          email: string
          id?: string
          is_active?: boolean | null
          nome: string
          outlet_access?: string[] | null
          ruolo?: string
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string | null
          cognome?: string
          company_id?: string
          created_at?: string | null
          email?: string
          id?: string
          is_active?: boolean | null
          nome?: string
          outlet_access?: string[] | null
          ruolo?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      balance_sheet_data: {
        Row: {
          account_code: string | null
          account_name: string
          amount: number
          company_id: string
          cost_center: string | null
          created_at: string | null
          id: string
          import_id: string | null
          parent_account: string | null
          period_type: string
          section: string
          sort_order: number | null
          year: number
        }
        Insert: {
          account_code?: string | null
          account_name: string
          amount?: number
          company_id?: string
          cost_center?: string | null
          created_at?: string | null
          id?: string
          import_id?: string | null
          parent_account?: string | null
          period_type: string
          section?: string
          sort_order?: number | null
          year: number
        }
        Update: {
          account_code?: string | null
          account_name?: string
          amount?: number
          company_id?: string
          cost_center?: string | null
          created_at?: string | null
          id?: string
          import_id?: string | null
          parent_account?: string | null
          period_type?: string
          section?: string
          sort_order?: number | null
          year?: number
        }
        Relationships: []
      }
      balance_sheet_imports: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          company_id: string
          created_at: string | null
          extracted_data: Json | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          note: string | null
          period_label: string | null
          period_type: string
          status: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploaded_by_name: string | null
          verified_at: string | null
          verified_by: string | null
          year: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          note?: string | null
          period_label?: string | null
          period_type?: string
          status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
          year: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          company_id?: string
          created_at?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          note?: string | null
          period_label?: string | null
          period_type?: string
          status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          verified_at?: string | null
          verified_by?: string | null
          year?: number
        }
        Relationships: []
      }
      bank_accounts: {
        Row: {
          account_name: string | null
          account_type: string | null
          acube_account_uuid: string | null
          balance_updated_at: string | null
          bank_name: string
          color: string | null
          company_id: string
          created_at: string | null
          credit_line: number | null
          currency: string | null
          current_balance: number | null
          iban: string | null
          id: string
          is_active: boolean | null
          is_manual: boolean | null
          last_update: string | null
          note: string | null
          outlet_code: string | null
          outlet_id: string | null
          updated_at: string | null
        }
        Insert: {
          account_name?: string | null
          account_type?: string | null
          acube_account_uuid?: string | null
          balance_updated_at?: string | null
          bank_name: string
          color?: string | null
          company_id: string
          created_at?: string | null
          credit_line?: number | null
          currency?: string | null
          current_balance?: number | null
          iban?: string | null
          id?: string
          is_active?: boolean | null
          is_manual?: boolean | null
          last_update?: string | null
          note?: string | null
          outlet_code?: string | null
          outlet_id?: string | null
          updated_at?: string | null
        }
        Update: {
          account_name?: string | null
          account_type?: string | null
          acube_account_uuid?: string | null
          balance_updated_at?: string | null
          bank_name?: string
          color?: string | null
          company_id?: string
          created_at?: string | null
          credit_line?: number | null
          currency?: string | null
          current_balance?: number | null
          iban?: string | null
          id?: string
          is_active?: boolean | null
          is_manual?: boolean | null
          last_update?: string | null
          note?: string | null
          outlet_code?: string | null
          outlet_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      bank_balances: {
        Row: {
          balance_accounting: number | null
          balance_available: number | null
          bank_account_id: string
          created_at: string | null
          date: string
          id: string
          source: Database["public"]["Enums"]["import_source"] | null
        }
        Insert: {
          balance_accounting?: number | null
          balance_available?: number | null
          bank_account_id: string
          created_at?: string | null
          date: string
          id?: string
          source?: Database["public"]["Enums"]["import_source"] | null
        }
        Update: {
          balance_accounting?: number | null
          balance_available?: number | null
          bank_account_id?: string
          created_at?: string | null
          date?: string
          id?: string
          source?: Database["public"]["Enums"]["import_source"] | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_balances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_imports: {
        Row: {
          bank_account_id: string | null
          company_id: string
          created_at: string | null
          error_message: string | null
          file_format: string | null
          file_name: string
          file_path: string | null
          file_size: number | null
          id: string
          import_type: string | null
          period_from: string | null
          period_to: string | null
          records_count: number | null
          status: string | null
          uploaded_at: string | null
        }
        Insert: {
          bank_account_id?: string | null
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          import_type?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          import_type?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Relationships: []
      }
      bank_statements: {
        Row: {
          bank_account_id: string | null
          closing_balance: number | null
          company_id: string
          created_at: string | null
          doc_kind: string | null
          error_message: string | null
          file_type: string
          file_url: string | null
          filename: string
          id: string
          opening_balance: number | null
          period_from: string | null
          period_month: number | null
          period_to: string | null
          period_year: number | null
          source_label: string | null
          status: string | null
          transaction_count: number | null
          uploaded_by: string | null
        }
        Insert: {
          bank_account_id?: string | null
          closing_balance?: number | null
          company_id: string
          created_at?: string | null
          doc_kind?: string | null
          error_message?: string | null
          file_type: string
          file_url?: string | null
          filename: string
          id?: string
          opening_balance?: number | null
          period_from?: string | null
          period_month?: number | null
          period_to?: string | null
          period_year?: number | null
          source_label?: string | null
          status?: string | null
          transaction_count?: number | null
          uploaded_by?: string | null
        }
        Update: {
          bank_account_id?: string | null
          closing_balance?: number | null
          company_id?: string
          created_at?: string | null
          doc_kind?: string | null
          error_message?: string | null
          file_type?: string
          file_url?: string | null
          filename?: string
          id?: string
          opening_balance?: number | null
          period_from?: string | null
          period_month?: number | null
          period_to?: string | null
          period_year?: number | null
          source_label?: string | null
          status?: string | null
          transaction_count?: number | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account_id: string | null
          acube_dedup_hash: string | null
          acube_transaction_id: string | null
          amount: number
          balance_after: number | null
          bank_account_id: string | null
          booking_date: string | null
          category: string | null
          company_id: string
          counterpart: string | null
          counterpart_iban: string | null
          counterpart_name: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          import_dedup_hash: string | null
          import_id: string | null
          invoice_id: string | null
          is_reconciled: boolean | null
          merchant_name: string | null
          note: string | null
          payment_schedule_id: string | null
          raw_data: Json | null
          reconciled_at: string | null
          reconciled_invoice_id: string | null
          reference: string | null
          running_balance: number | null
          source: string | null
          statement_id: string | null
          status: string | null
          supplier_id: string | null
          sync_run_id: string | null
          transaction_date: string
          transaction_type: string | null
          value_date: string | null
          yapily_transaction_id: string | null
        }
        Insert: {
          account_id?: string | null
          acube_dedup_hash?: string | null
          acube_transaction_id?: string | null
          amount: number
          balance_after?: number | null
          bank_account_id?: string | null
          booking_date?: string | null
          category?: string | null
          company_id?: string
          counterpart?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          import_dedup_hash?: string | null
          import_id?: string | null
          invoice_id?: string | null
          is_reconciled?: boolean | null
          merchant_name?: string | null
          note?: string | null
          payment_schedule_id?: string | null
          raw_data?: Json | null
          reconciled_at?: string | null
          reconciled_invoice_id?: string | null
          reference?: string | null
          running_balance?: number | null
          source?: string | null
          statement_id?: string | null
          status?: string | null
          supplier_id?: string | null
          sync_run_id?: string | null
          transaction_date: string
          transaction_type?: string | null
          value_date?: string | null
          yapily_transaction_id?: string | null
        }
        Update: {
          account_id?: string | null
          acube_dedup_hash?: string | null
          acube_transaction_id?: string | null
          amount?: number
          balance_after?: number | null
          bank_account_id?: string | null
          booking_date?: string | null
          category?: string | null
          company_id?: string
          counterpart?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          import_dedup_hash?: string | null
          import_id?: string | null
          invoice_id?: string | null
          is_reconciled?: boolean | null
          merchant_name?: string | null
          note?: string | null
          payment_schedule_id?: string | null
          raw_data?: Json | null
          reconciled_at?: string | null
          reconciled_invoice_id?: string | null
          reference?: string | null
          running_balance?: number | null
          source?: string | null
          statement_id?: string | null
          status?: string | null
          supplier_id?: string | null
          sync_run_id?: string | null
          transaction_date?: string
          transaction_type?: string | null
          value_date?: string | null
          yapily_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_invoice_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "bank_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_bt_statement"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_approval_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_user_id: string
          company_id: string
          cost_center: string
          created_at: string
          id: string
          reason: string | null
          rows_affected: number
          year: number
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_user_id: string
          company_id: string
          cost_center: string
          created_at?: string
          id?: string
          reason?: string | null
          rows_affected?: number
          year: number
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_user_id?: string
          company_id?: string
          cost_center?: string
          created_at?: string
          id?: string
          reason?: string | null
          rows_affected?: number
          year?: number
        }
        Relationships: []
      }
      budget_confronto: {
        Row: {
          account_code: string
          amount: number | null
          company_id: string
          cost_center: string
          created_at: string | null
          entry_type: string
          id: string
          month: number
          rettifica_amount: number | null
          rettifica_pct: number | null
          stato: string
          updated_at: string | null
          year: number
        }
        Insert: {
          account_code: string
          amount?: number | null
          company_id: string
          cost_center: string
          created_at?: string | null
          entry_type: string
          id?: string
          month?: number
          rettifica_amount?: number | null
          rettifica_pct?: number | null
          stato?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          account_code?: string
          amount?: number | null
          company_id?: string
          cost_center?: string
          created_at?: string | null
          entry_type?: string
          id?: string
          month?: number
          rettifica_amount?: number | null
          rettifica_pct?: number | null
          stato?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "budget_confronto_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_cost_lines: {
        Row: {
          amount: number
          budget_id: string
          cost_category_id: string | null
          id: string
          label: string | null
          notes: string | null
        }
        Insert: {
          amount?: number
          budget_id: string
          cost_category_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
        }
        Update: {
          amount?: number
          budget_id?: string
          cost_category_id?: string | null
          id?: string
          label?: string | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_cost_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "annual_budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_cost_lines_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_cost_lines_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
        ]
      }
      budget_entries: {
        Row: {
          account_code: string
          account_name: string
          actual_amount: number | null
          actual_breakdown: Json | null
          actual_refreshed_at: string | null
          approved_at: string | null
          approved_by: string | null
          budget_amount: number | null
          company_id: string
          cost_center: string
          created_at: string | null
          id: string
          is_approved: boolean | null
          is_placeholder: boolean
          macro_group: string
          month: number
          note: string | null
          unlock_reason: string | null
          unlocked_at: string | null
          unlocked_by: string | null
          updated_at: string | null
          year: number
        }
        Insert: {
          account_code: string
          account_name: string
          actual_amount?: number | null
          actual_breakdown?: Json | null
          actual_refreshed_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string
          cost_center?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          is_placeholder?: boolean
          macro_group: string
          month: number
          note?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string | null
          year: number
        }
        Update: {
          account_code?: string
          account_name?: string
          actual_amount?: number | null
          actual_breakdown?: Json | null
          actual_refreshed_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string
          cost_center?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          is_placeholder?: boolean
          macro_group?: string
          month?: number
          note?: string | null
          unlock_reason?: string | null
          unlocked_at?: string | null
          unlocked_by?: string | null
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      cash_budget: {
        Row: {
          company_id: string
          created_at: string | null
          expected_inflows: number | null
          expected_net: number | null
          expected_outflows: number | null
          id: string
          month: number
          notes: string | null
          target_min_balance: number | null
          year: number
        }
        Insert: {
          company_id: string
          created_at?: string | null
          expected_inflows?: number | null
          expected_net?: number | null
          expected_outflows?: number | null
          id?: string
          month: number
          notes?: string | null
          target_min_balance?: number | null
          year: number
        }
        Update: {
          company_id?: string
          created_at?: string | null
          expected_inflows?: number | null
          expected_net?: number | null
          expected_outflows?: number | null
          id?: string
          month?: number
          notes?: string | null
          target_min_balance?: number | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_budget_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_movement_ai: {
        Row: {
          ai_categorized_at: string | null
          ai_category_id: string | null
          ai_confidence: number | null
          ai_method: string | null
          bank_transaction_id: string
          company_id: string
          cost_category_id: string | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          ai_categorized_at?: string | null
          ai_category_id?: string | null
          ai_confidence?: number | null
          ai_method?: string | null
          bank_transaction_id: string
          company_id: string
          cost_category_id?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          ai_categorized_at?: string | null
          ai_category_id?: string | null
          ai_confidence?: number | null
          ai_method?: string | null
          bank_transaction_id?: string
          company_id?: string
          cost_category_id?: string | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movement_ai_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: true
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movement_ai_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: true
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "cash_movement_ai_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: true
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_position: {
        Row: {
          balance: number
          bank_account_id: string | null
          company_id: string
          created_at: string | null
          id: string
          note: string | null
          record_date: string
          source: string | null
        }
        Insert: {
          balance?: number
          bank_account_id?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          note?: string | null
          record_date: string
          source?: string | null
        }
        Update: {
          balance?: number
          bank_account_id?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          note?: string | null
          record_date?: string
          source?: string | null
        }
        Relationships: []
      }
      chart_of_accounts: {
        Row: {
          annual_amount: number | null
          ce_section: string | null
          code: string
          company_id: string
          created_at: string | null
          default_centers: string[] | null
          id: string
          is_active: boolean | null
          is_admin_compensation: boolean
          is_cash: boolean
          is_fixed: boolean | null
          is_recurring: boolean | null
          is_revenue: boolean | null
          level: number | null
          macro_group: string
          name: string
          note: string | null
          outlet_link: string | null
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          annual_amount?: number | null
          ce_section?: string | null
          code: string
          company_id?: string
          created_at?: string | null
          default_centers?: string[] | null
          id?: string
          is_active?: boolean | null
          is_admin_compensation?: boolean
          is_cash?: boolean
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          is_revenue?: boolean | null
          level?: number | null
          macro_group: string
          name: string
          note?: string | null
          outlet_link?: string | null
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          annual_amount?: number | null
          ce_section?: string | null
          code?: string
          company_id?: string
          created_at?: string | null
          default_centers?: string[] | null
          id?: string
          is_active?: boolean | null
          is_admin_compensation?: boolean
          is_cash?: boolean
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          is_revenue?: boolean | null
          level?: number | null
          macro_group?: string
          name?: string
          note?: string | null
          outlet_link?: string | null
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string | null
          fiscal_code: string | null
          id: string
          legal_address: string | null
          name: string
          notes: string | null
          pec: string | null
          point_of_sale_label: string
          sdi_code: string | null
          settings: Json | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          created_at?: string | null
          fiscal_code?: string | null
          id?: string
          legal_address?: string | null
          name: string
          notes?: string | null
          pec?: string | null
          point_of_sale_label?: string
          sdi_code?: string | null
          settings?: Json | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          created_at?: string | null
          fiscal_code?: string | null
          id?: string
          legal_address?: string | null
          name?: string
          notes?: string | null
          pec?: string | null
          point_of_sale_label?: string
          sdi_code?: string | null
          settings?: Json | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: []
      }
      company_settings: {
        Row: {
          amministratore: string | null
          ateco: string | null
          capitale_sociale: string | null
          codice_fiscale: string | null
          codice_sdi: string | null
          company_id: string
          created_at: string | null
          data_costituzione: string | null
          forma_giuridica: string | null
          id: string
          note: string | null
          partita_iva: string | null
          pec: string | null
          ragione_sociale: string
          rea: string | null
          regime_fiscale: string
          sede_cap: string | null
          sede_comune: string | null
          sede_indirizzo: string | null
          sede_legale: string | null
          sede_provincia: string | null
          soci: Json | null
          updated_at: string | null
        }
        Insert: {
          amministratore?: string | null
          ateco?: string | null
          capitale_sociale?: string | null
          codice_fiscale?: string | null
          codice_sdi?: string | null
          company_id?: string
          created_at?: string | null
          data_costituzione?: string | null
          forma_giuridica?: string | null
          id?: string
          note?: string | null
          partita_iva?: string | null
          pec?: string | null
          ragione_sociale?: string
          rea?: string | null
          regime_fiscale?: string
          sede_cap?: string | null
          sede_comune?: string | null
          sede_indirizzo?: string | null
          sede_legale?: string | null
          sede_provincia?: string | null
          soci?: Json | null
          updated_at?: string | null
        }
        Update: {
          amministratore?: string | null
          ateco?: string | null
          capitale_sociale?: string | null
          codice_fiscale?: string | null
          codice_sdi?: string | null
          company_id?: string
          created_at?: string | null
          data_costituzione?: string | null
          forma_giuridica?: string | null
          id?: string
          note?: string | null
          partita_iva?: string | null
          pec?: string | null
          ragione_sociale?: string
          rea?: string | null
          regime_fiscale?: string
          sede_cap?: string | null
          sede_comune?: string | null
          sede_indirizzo?: string | null
          sede_legale?: string | null
          sede_provincia?: string | null
          soci?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      contract_amount_history: {
        Row: {
          contract_id: string
          created_at: string | null
          effective_date: string
          id: string
          new_amount: number | null
          previous_amount: number | null
          reason: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string | null
          effective_date: string
          id?: string
          new_amount?: number | null
          previous_amount?: number | null
          reason?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string | null
          effective_date?: string
          id?: string
          new_amount?: number | null
          previous_amount?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_amount_history_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_amount_history_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_amount_history_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      contract_deadlines: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          contract_id: string
          deadline_date: string
          description: string
          id: string
          is_completed: boolean | null
          notes: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          contract_id: string
          deadline_date: string
          description: string
          id?: string
          is_completed?: boolean | null
          notes?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          contract_id?: string
          deadline_date?: string
          description?: string
          id?: string
          is_completed?: boolean | null
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_deadlines_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_deadlines_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      contract_documents: {
        Row: {
          category: string | null
          company_id: string
          contract_id: string | null
          created_at: string | null
          file_name: string
          file_path: string | null
          file_size: number | null
          id: string
          outlet_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          category?: string | null
          company_id?: string
          contract_id?: string | null
          created_at?: string | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          category?: string | null
          company_id?: string
          contract_id?: string | null
          created_at?: string | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_contracts_expiring"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_documents_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["contract_id"]
          },
        ]
      }
      contracts: {
        Row: {
          annual_amount: number | null
          auto_renewal: boolean | null
          company_id: string
          contract_number: string | null
          contract_type: string
          cost_category_id: string | null
          counterpart: string | null
          created_at: string | null
          deposit_amount: number | null
          end_date: string | null
          escalation_date: string | null
          escalation_frequency_months: number | null
          escalation_rate: number | null
          escalation_type: string | null
          id: string
          min_revenue_clause: number | null
          min_revenue_period: string | null
          monthly_amount: number | null
          name: string
          notes: string | null
          notice_days: number | null
          notice_deadline: string | null
          outlet_id: string | null
          renewal_date: string | null
          renewal_period_months: number | null
          sqm: number | null
          start_date: string
          status: Database["public"]["Enums"]["contract_status"] | null
          updated_at: string | null
          variable_rent_pct: number | null
          variable_rent_threshold: number | null
          vat_rate: number | null
        }
        Insert: {
          annual_amount?: number | null
          auto_renewal?: boolean | null
          company_id: string
          contract_number?: string | null
          contract_type: string
          cost_category_id?: string | null
          counterpart?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          end_date?: string | null
          escalation_date?: string | null
          escalation_frequency_months?: number | null
          escalation_rate?: number | null
          escalation_type?: string | null
          id?: string
          min_revenue_clause?: number | null
          min_revenue_period?: string | null
          monthly_amount?: number | null
          name: string
          notes?: string | null
          notice_days?: number | null
          notice_deadline?: string | null
          outlet_id?: string | null
          renewal_date?: string | null
          renewal_period_months?: number | null
          sqm?: number | null
          start_date: string
          status?: Database["public"]["Enums"]["contract_status"] | null
          updated_at?: string | null
          variable_rent_pct?: number | null
          variable_rent_threshold?: number | null
          vat_rate?: number | null
        }
        Update: {
          annual_amount?: number | null
          auto_renewal?: boolean | null
          company_id?: string
          contract_number?: string | null
          contract_type?: string
          cost_category_id?: string | null
          counterpart?: string | null
          created_at?: string | null
          deposit_amount?: number | null
          end_date?: string | null
          escalation_date?: string | null
          escalation_frequency_months?: number | null
          escalation_rate?: number | null
          escalation_type?: string | null
          id?: string
          min_revenue_clause?: number | null
          min_revenue_period?: string | null
          monthly_amount?: number | null
          name?: string
          notes?: string | null
          notice_days?: number | null
          notice_deadline?: string | null
          outlet_id?: string | null
          renewal_date?: string | null
          renewal_period_months?: number | null
          sqm?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["contract_status"] | null
          updated_at?: string | null
          variable_rent_pct?: number | null
          variable_rent_threshold?: number | null
          vat_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      corrispettivi_log: {
        Row: {
          ade_receipt_id: string | null
          company_id: string
          created_at: string | null
          date: string
          device_serial: string | null
          error_details: Json | null
          id: string
          outlet_id: string
          submission_status: string | null
          submitted_at: string | null
          total_amount: number
          vat_breakdown: Json | null
          xml_content: string | null
        }
        Insert: {
          ade_receipt_id?: string | null
          company_id: string
          created_at?: string | null
          date: string
          device_serial?: string | null
          error_details?: Json | null
          id?: string
          outlet_id: string
          submission_status?: string | null
          submitted_at?: string | null
          total_amount: number
          vat_breakdown?: Json | null
          xml_content?: string | null
        }
        Update: {
          ade_receipt_id?: string | null
          company_id?: string
          created_at?: string | null
          date?: string
          device_serial?: string | null
          error_details?: Json | null
          id?: string
          outlet_id?: string
          submission_status?: string | null
          submitted_at?: string | null
          total_amount?: number
          vat_breakdown?: Json | null
          xml_content?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "corrispettivi_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrispettivi_log_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corrispettivi_log_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "corrispettivi_log_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "corrispettivi_log_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      cost_categories: {
        Row: {
          auto_debit_card: boolean
          ce_account_code: string | null
          code: string
          color: string | null
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          is_fixed: boolean | null
          is_recurring: boolean | null
          is_system: boolean | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"]
          matching_keywords: string[] | null
          name: string
          notes: string | null
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          auto_debit_card?: boolean
          ce_account_code?: string | null
          code: string
          color?: string | null
          company_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          is_system?: boolean | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"]
          matching_keywords?: string[] | null
          name: string
          notes?: string | null
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          auto_debit_card?: boolean
          ce_account_code?: string | null
          code?: string
          color?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          is_system?: boolean | null
          macro_group?: Database["public"]["Enums"]["cost_macro_group"]
          matching_keywords?: string[] | null
          name?: string
          notes?: string | null
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_categories_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          code: string
          color: string | null
          company_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          label: string
          role: string
          sort_order: number | null
        }
        Insert: {
          code: string
          color?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label: string
          role?: string
          sort_order?: number | null
        }
        Update: {
          code?: string
          color?: string | null
          company_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          label?: string
          role?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      csv_mappings: {
        Row: {
          auto_rules: Json | null
          column_mapping: Json
          company_id: string
          created_at: string | null
          date_format: string | null
          decimal_separator: string | null
          delimiter: string | null
          encoding: string | null
          id: string
          is_default: boolean | null
          name: string
          skip_rows: number | null
          source: Database["public"]["Enums"]["import_source"]
          thousand_separator: string | null
        }
        Insert: {
          auto_rules?: Json | null
          column_mapping: Json
          company_id: string
          created_at?: string | null
          date_format?: string | null
          decimal_separator?: string | null
          delimiter?: string | null
          encoding?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          skip_rows?: number | null
          source: Database["public"]["Enums"]["import_source"]
          thousand_separator?: string | null
        }
        Update: {
          auto_rules?: Json | null
          column_mapping?: Json
          company_id?: string
          created_at?: string | null
          date_format?: string | null
          decimal_separator?: string | null
          delimiter?: string | null
          encoding?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          skip_rows?: number | null
          source?: Database["public"]["Enums"]["import_source"]
          thousand_separator?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "csv_mappings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_receipts_ade: {
        Row: {
          company_id: string
          created_at: string | null
          daily_revenue_id: string | null
          date: string
          device_serial: string | null
          id: string
          import_batch_id: string | null
          is_reconciled: boolean | null
          non_taxable_amount: number | null
          outlet_id: string
          source: Database["public"]["Enums"]["import_source"] | null
          total_amount: number | null
          vat_amount: number | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          daily_revenue_id?: string | null
          date: string
          device_serial?: string | null
          id?: string
          import_batch_id?: string | null
          is_reconciled?: boolean | null
          non_taxable_amount?: number | null
          outlet_id: string
          source?: Database["public"]["Enums"]["import_source"] | null
          total_amount?: number | null
          vat_amount?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          daily_revenue_id?: string | null
          date?: string
          device_serial?: string | null
          id?: string
          import_batch_id?: string | null
          is_reconciled?: boolean | null
          non_taxable_amount?: number | null
          outlet_id?: string
          source?: Database["public"]["Enums"]["import_source"] | null
          total_amount?: number | null
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_receipts_ade_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_daily_revenue_id_fkey"
            columns: ["daily_revenue_id"]
            isOneToOne: false
            referencedRelation: "daily_revenue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_receipts_ade_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      daily_revenue: {
        Row: {
          avg_ticket: number | null
          card_amount: number | null
          cash_amount: number | null
          company_id: string
          created_at: string | null
          date: string
          gross_revenue: number | null
          id: string
          import_batch_id: string | null
          net_revenue: number | null
          notes: string | null
          other_amount: number | null
          outlet_id: string
          source: Database["public"]["Enums"]["import_source"] | null
          transactions_count: number | null
        }
        Insert: {
          avg_ticket?: number | null
          card_amount?: number | null
          cash_amount?: number | null
          company_id: string
          created_at?: string | null
          date: string
          gross_revenue?: number | null
          id?: string
          import_batch_id?: string | null
          net_revenue?: number | null
          notes?: string | null
          other_amount?: number | null
          outlet_id: string
          source?: Database["public"]["Enums"]["import_source"] | null
          transactions_count?: number | null
        }
        Update: {
          avg_ticket?: number | null
          card_amount?: number | null
          cash_amount?: number | null
          company_id?: string
          created_at?: string | null
          date?: string
          gross_revenue?: number | null
          id?: string
          import_batch_id?: string | null
          net_revenue?: number | null
          notes?: string | null
          other_amount?: number | null
          outlet_id?: string
          source?: Database["public"]["Enums"]["import_source"] | null
          transactions_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_revenue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      document_versions: {
        Row: {
          company_id: string
          created_at: string | null
          document_id: string
          document_table: string
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          storage_bucket: string | null
          uploaded_by: string | null
          uploaded_by_name: string | null
          version_number: number
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          document_id: string
          document_table?: string
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          storage_bucket?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          version_number?: number
        }
        Update: {
          company_id?: string
          created_at?: string | null
          document_id?: string
          document_table?: string
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          storage_bucket?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string
          company_id: string
          created_at: string | null
          currency: string | null
          description: string | null
          document_status: string | null
          document_type: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          import_batch_id: string | null
          import_source: string | null
          import_status: string | null
          invoice_date: string | null
          invoice_number: string | null
          month: number | null
          parsed_data: Json | null
          processed_at: string | null
          receiver_vat: string | null
          reference_id: string | null
          reference_type: string | null
          retention_end: string | null
          retention_start: string | null
          retention_status: string | null
          sdi_id: string | null
          sdi_status: string | null
          sender_vat: string | null
          storage_bucket: string | null
          storage_path: string | null
          tax_amount: number | null
          total_amount: number | null
          upload_status: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploaded_by_name: string | null
          validation_errors: Json | null
          validation_status: string | null
          xml_content: string | null
          year: number | null
        }
        Insert: {
          category?: string
          company_id?: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          document_status?: string | null
          document_type?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          import_batch_id?: string | null
          import_source?: string | null
          import_status?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          month?: number | null
          parsed_data?: Json | null
          processed_at?: string | null
          receiver_vat?: string | null
          reference_id?: string | null
          reference_type?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          sender_vat?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          upload_status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          validation_errors?: Json | null
          validation_status?: string | null
          xml_content?: string | null
          year?: number | null
        }
        Update: {
          category?: string
          company_id?: string
          created_at?: string | null
          currency?: string | null
          description?: string | null
          document_status?: string | null
          document_type?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          import_batch_id?: string | null
          import_source?: string | null
          import_status?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          month?: number | null
          parsed_data?: Json | null
          processed_at?: string | null
          receiver_vat?: string | null
          reference_id?: string | null
          reference_type?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          sender_vat?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          tax_amount?: number | null
          total_amount?: number | null
          upload_status?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          validation_errors?: Json | null
          validation_status?: string | null
          xml_content?: string | null
          year?: number | null
        }
        Relationships: []
      }
      electronic_invoices: {
        Row: {
          acube_uuid: string | null
          bank_transaction_id: string | null
          cash_movement_id: string | null
          codice_destinatario: string | null
          company_id: string
          cost_category_id: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          gross_amount: number | null
          id: string
          import_batch_id: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_reconciled: boolean | null
          monthly_cost_line_id: string | null
          net_amount: number | null
          notes: string | null
          outlet_id: string | null
          payment_method: string | null
          payment_terms: string | null
          retention_end: string | null
          retention_start: string | null
          retention_status: string | null
          sdi_id: string | null
          sdi_status: string | null
          source: Database["public"]["Enums"]["import_source"] | null
          storage_path: string | null
          supplier_fiscal_code: string | null
          supplier_name: string | null
          supplier_vat: string | null
          tipo_documento: string | null
          updated_at: string | null
          vat_amount: number | null
          xml_content: string | null
          xml_file_path: string | null
        }
        Insert: {
          acube_uuid?: string | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          codice_destinatario?: string | null
          company_id: string
          cost_category_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          gross_amount?: number | null
          id?: string
          import_batch_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_reconciled?: boolean | null
          monthly_cost_line_id?: string | null
          net_amount?: number | null
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          storage_path?: string | null
          supplier_fiscal_code?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          tipo_documento?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          xml_content?: string | null
          xml_file_path?: string | null
        }
        Update: {
          acube_uuid?: string | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          codice_destinatario?: string | null
          company_id?: string
          cost_category_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          gross_amount?: number | null
          id?: string
          import_batch_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_reconciled?: boolean | null
          monthly_cost_line_id?: string | null
          net_amount?: number | null
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          storage_path?: string | null
          supplier_fiscal_code?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          tipo_documento?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          xml_content?: string | null
          xml_file_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "electronic_invoices_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_monthly_cost_line_id_fkey"
            columns: ["monthly_cost_line_id"]
            isOneToOne: false
            referencedRelation: "monthly_cost_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      employee_cost_imports: {
        Row: {
          company_id: string
          file_name: string | null
          file_total: number | null
          id: string
          imported_at: string | null
          imported_by: string | null
          month: number
          note: string | null
          rows_new_employees: number | null
          rows_total: number | null
          scostamento: number | null
          total_netto: number | null
          year: number
        }
        Insert: {
          company_id: string
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          month: number
          note?: string | null
          rows_new_employees?: number | null
          rows_total?: number | null
          scostamento?: number | null
          total_netto?: number | null
          year: number
        }
        Update: {
          company_id?: string
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          month?: number
          note?: string | null
          rows_new_employees?: number | null
          rows_total?: number | null
          scostamento?: number | null
          total_netto?: number | null
          year?: number
        }
        Relationships: []
      }
      employee_costs: {
        Row: {
          altri_costi: number | null
          company_id: string
          contributi: number | null
          created_at: string | null
          employee_id: string | null
          id: string
          import_id: string | null
          inail: number | null
          month: number
          netto: number | null
          note: string | null
          retribuzione: number | null
          source: string | null
          tfr: number | null
          year: number
        }
        Insert: {
          altri_costi?: number | null
          company_id?: string
          contributi?: number | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          import_id?: string | null
          inail?: number | null
          month: number
          netto?: number | null
          note?: string | null
          retribuzione?: number | null
          source?: string | null
          tfr?: number | null
          year: number
        }
        Update: {
          altri_costi?: number | null
          company_id?: string
          contributi?: number | null
          created_at?: string | null
          employee_id?: string | null
          id?: string
          import_id?: string | null
          inail?: number | null
          month?: number
          netto?: number | null
          note?: string | null
          retribuzione?: number | null
          source?: string | null
          tfr?: number | null
          year?: number
        }
        Relationships: []
      }
      employee_documents: {
        Row: {
          company_id: string
          created_at: string | null
          doc_type: string
          employee_id: string | null
          extracted_data: Json | null
          file_name: string
          file_path: string | null
          file_size: number | null
          id: string
          month: number | null
          status: string | null
          uploaded_at: string | null
          year: number | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          doc_type?: string
          employee_id?: string | null
          extracted_data?: Json | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          month?: number | null
          status?: string | null
          uploaded_at?: string | null
          year?: number | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          doc_type?: string
          employee_id?: string | null
          extracted_data?: Json | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          month?: number | null
          status?: string | null
          uploaded_at?: string | null
          year?: number | null
        }
        Relationships: []
      }
      employee_outlet_allocations: {
        Row: {
          allocation_pct: number
          company_id: string
          created_at: string | null
          employee_id: string
          id: string
          is_primary: boolean | null
          outlet_code: string
          role_at_outlet: string | null
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          allocation_pct?: number
          company_id?: string
          created_at?: string | null
          employee_id: string
          id?: string
          is_primary?: boolean | null
          outlet_code: string
          role_at_outlet?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          allocation_pct?: number
          company_id?: string
          created_at?: string | null
          employee_id?: string
          id?: string
          is_primary?: boolean | null
          outlet_code?: string
          role_at_outlet?: string | null
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_outlet_allocations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          codice_fiscale: string | null
          cognome: string | null
          company_id: string
          contract_type: Database["public"]["Enums"]["contract_type"] | null
          contratto_tipo: string | null
          created_at: string | null
          data_assunzione: string | null
          data_cessazione: string | null
          durata_mesi: number | null
          filiale: string | null
          first_name: string
          fiscal_code: string | null
          fte_ratio: number | null
          gross_annual_cost: number | null
          gross_monthly_cost: number | null
          hire_date: string | null
          id: string
          is_active: boolean | null
          last_name: string
          level: string | null
          livello: string | null
          matricola: string | null
          mesi_disp_con_causale: number | null
          mesi_disp_senza_causale: number | null
          net_monthly_salary: number | null
          nome: string | null
          note: string | null
          notes: string | null
          ore_settimanali: number | null
          outlet_id: string | null
          part_time_pct: number | null
          proroghe: number | null
          proroghe_disponibili: number | null
          qualifica: string | null
          role_description: string | null
          scadenza_td: string | null
          stato_td: string | null
          termination_date: string | null
          updated_at: string | null
          weekly_hours: number | null
        }
        Insert: {
          codice_fiscale?: string | null
          cognome?: string | null
          company_id: string
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
          contratto_tipo?: string | null
          created_at?: string | null
          data_assunzione?: string | null
          data_cessazione?: string | null
          durata_mesi?: number | null
          filiale?: string | null
          first_name: string
          fiscal_code?: string | null
          fte_ratio?: number | null
          gross_annual_cost?: number | null
          gross_monthly_cost?: number | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name: string
          level?: string | null
          livello?: string | null
          matricola?: string | null
          mesi_disp_con_causale?: number | null
          mesi_disp_senza_causale?: number | null
          net_monthly_salary?: number | null
          nome?: string | null
          note?: string | null
          notes?: string | null
          ore_settimanali?: number | null
          outlet_id?: string | null
          part_time_pct?: number | null
          proroghe?: number | null
          proroghe_disponibili?: number | null
          qualifica?: string | null
          role_description?: string | null
          scadenza_td?: string | null
          stato_td?: string | null
          termination_date?: string | null
          updated_at?: string | null
          weekly_hours?: number | null
        }
        Update: {
          codice_fiscale?: string | null
          cognome?: string | null
          company_id?: string
          contract_type?: Database["public"]["Enums"]["contract_type"] | null
          contratto_tipo?: string | null
          created_at?: string | null
          data_assunzione?: string | null
          data_cessazione?: string | null
          durata_mesi?: number | null
          filiale?: string | null
          first_name?: string
          fiscal_code?: string | null
          fte_ratio?: number | null
          gross_annual_cost?: number | null
          gross_monthly_cost?: number | null
          hire_date?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string
          level?: string | null
          livello?: string | null
          matricola?: string | null
          mesi_disp_con_causale?: number | null
          mesi_disp_senza_causale?: number | null
          net_monthly_salary?: number | null
          nome?: string | null
          note?: string | null
          notes?: string | null
          ore_settimanali?: number | null
          outlet_id?: string | null
          part_time_pct?: number | null
          proroghe?: number | null
          proroghe_disponibili?: number | null
          qualifica?: string | null
          role_description?: string | null
          scadenza_td?: string | null
          stato_td?: string | null
          termination_date?: string | null
          updated_at?: string | null
          weekly_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      fattura_xml_export: {
        Row: {
          batch_id: string
          client_name: string | null
          company_id: string
          created_at: string
          created_by: string | null
          file_name: string
          id: string
          imponibile: number | null
          imposta: number | null
          invoice_date: string | null
          invoice_number: string | null
          progressivo: number
          quadra: boolean | null
          totale: number | null
          xml_content: string
        }
        Insert: {
          batch_id: string
          client_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_name: string
          id?: string
          imponibile?: number | null
          imposta?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          progressivo: number
          quadra?: boolean | null
          totale?: number | null
          xml_content: string
        }
        Update: {
          batch_id?: string
          client_name?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          file_name?: string
          id?: string
          imponibile?: number | null
          imposta?: number | null
          invoice_date?: string | null
          invoice_number?: string | null
          progressivo?: number
          quadra?: boolean | null
          totale?: number | null
          xml_content?: string
        }
        Relationships: [
          {
            foreignKeyName: "fattura_xml_export_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_snapshots: {
        Row: {
          company_id: string | null
          created_at: string | null
          created_by: string | null
          id: string
          payload: Json | null
          rows_count: number | null
          source_table: string | null
          year: number | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          payload?: Json | null
          rows_count?: number | null
          source_table?: string | null
          year?: number | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          payload?: Json | null
          rows_count?: number | null
          source_table?: string | null
          year?: number | null
        }
        Relationships: []
      }
      fiscal_deadlines: {
        Row: {
          amount: number | null
          amount_paid: number | null
          company_id: string
          created_at: string | null
          created_by: string | null
          deadline_type: string
          description: string | null
          disposizione_amount: number | null
          disposizione_bank_account_id: string | null
          disposizione_date: string | null
          disposizione_note: string | null
          due_date: string
          f24_code: string | null
          id: string
          is_recurring: boolean | null
          notes: string | null
          paid_date: string | null
          payment_method: string | null
          recurrence_day: number | null
          recurrence_rule: string | null
          reminder_date: string | null
          status: string
          tax_period: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          amount_paid?: number | null
          company_id: string
          created_at?: string | null
          created_by?: string | null
          deadline_type: string
          description?: string | null
          disposizione_amount?: number | null
          disposizione_bank_account_id?: string | null
          disposizione_date?: string | null
          disposizione_note?: string | null
          due_date: string
          f24_code?: string | null
          id?: string
          is_recurring?: boolean | null
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          recurrence_day?: number | null
          recurrence_rule?: string | null
          reminder_date?: string | null
          status?: string
          tax_period?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          amount_paid?: number | null
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          deadline_type?: string
          description?: string | null
          disposizione_amount?: number | null
          disposizione_bank_account_id?: string | null
          disposizione_date?: string | null
          disposizione_note?: string | null
          due_date?: string
          f24_code?: string | null
          id?: string
          is_recurring?: boolean | null
          notes?: string | null
          paid_date?: string | null
          payment_method?: string | null
          recurrence_day?: number | null
          recurrence_rule?: string | null
          reminder_date?: string | null
          status?: string
          tax_period?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fiscal_deadlines_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      help_chat_messages: {
        Row: {
          company_id: string
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
        }
        Insert: {
          company_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
        }
        Update: {
          company_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_chat_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "help_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      help_chat_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          company_id: string
          created_at: string
          id: string
          last_message_at: string | null
          message_count: number
          page_path: string
          page_title: string | null
          status: string
          title: string | null
          updated_at: string
          user_id: string
          user_name: string | null
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          company_id: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          page_path: string
          page_title?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
          user_name?: string | null
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          company_id?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          page_path?: string
          page_title?: string | null
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "help_chat_sessions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          bank_account_id: string | null
          company_id: string
          completed_at: string | null
          created_at: string | null
          error_log: Json | null
          error_rows: number | null
          file_name: string | null
          file_path: string | null
          id: string
          imported_at: string | null
          imported_by: string | null
          notes: string | null
          outlet_id: string | null
          period_from: string | null
          period_to: string | null
          processed_rows: number | null
          rows_error: number | null
          rows_imported: number | null
          rows_skipped: number | null
          rows_total: number | null
          source: Database["public"]["Enums"]["import_source"]
          status: Database["public"]["Enums"]["import_status"] | null
          total_rows: number | null
        }
        Insert: {
          bank_account_id?: string | null
          company_id: string
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          error_rows?: number | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          notes?: string | null
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          processed_rows?: number | null
          rows_error?: number | null
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          source: Database["public"]["Enums"]["import_source"]
          status?: Database["public"]["Enums"]["import_status"] | null
          total_rows?: number | null
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          error_rows?: number | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          notes?: string | null
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          processed_rows?: number | null
          rows_error?: number | null
          rows_imported?: number | null
          rows_skipped?: number | null
          rows_total?: number | null
          source?: Database["public"]["Enums"]["import_source"]
          status?: Database["public"]["Enums"]["import_status"] | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_batches_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "import_batches_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "import_batches_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      import_documents: {
        Row: {
          company_id: string
          created_at: string | null
          file_name: string
          file_path: string | null
          file_size: number | null
          file_type: string | null
          id: string
          source: string | null
          uploaded_at: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          source?: string | null
          uploaded_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          file_type?: string | null
          id?: string
          source?: string | null
          uploaded_at?: string | null
        }
        Relationships: []
      }
      imposte_annuali: {
        Row: {
          amount: number
          company_id: string
          created_at: string | null
          id: string
          updated_at: string | null
          year: number
        }
        Insert: {
          amount?: number
          company_id: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          amount?: number
          company_id?: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "imposte_annuali_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      inail_rates: {
        Row: {
          company_id: string
          created_at: string
          id: string
          note: string | null
          outlet_id: string | null
          pat_label: string
          rate_percent: number | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          note?: string | null
          outlet_id?: string | null
          pat_label: string
          rate_percent?: number | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          note?: string | null
          outlet_id?: string | null
          pat_label?: string
          rate_percent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inail_rates_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inail_rates_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inail_rates_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "inail_rates_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "inail_rates_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      invoices: {
        Row: {
          account_code: string | null
          company_id: string
          cost_center: string | null
          created_at: string | null
          currency: string | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string
          net_amount: number | null
          note: string | null
          payment_method: string | null
          payment_terms: string | null
          pdf_file_path: string | null
          sdi_id: string | null
          status: string | null
          supplier_id: string | null
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          xml_file_path: string | null
        }
        Insert: {
          account_code?: string | null
          company_id?: string
          cost_center?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          net_amount?: number | null
          note?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          pdf_file_path?: string | null
          sdi_id?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          xml_file_path?: string | null
        }
        Update: {
          account_code?: string | null
          company_id?: string
          cost_center?: string | null
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          net_amount?: number | null
          note?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          pdf_file_path?: string | null
          sdi_id?: string | null
          status?: string | null
          supplier_id?: string | null
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          xml_file_path?: string | null
        }
        Relationships: []
      }
      loan_tranches: {
        Row: {
          accrued_interest: number | null
          amount: number
          disbursement_date: string
          id: string
          interest_rate: number | null
          loan_id: string
          maturity_days: number | null
          notes: string | null
          tranche_number: number
        }
        Insert: {
          accrued_interest?: number | null
          amount: number
          disbursement_date: string
          id?: string
          interest_rate?: number | null
          loan_id: string
          maturity_days?: number | null
          notes?: string | null
          tranche_number: number
        }
        Update: {
          accrued_interest?: number | null
          amount?: number
          disbursement_date?: string
          id?: string
          interest_rate?: number | null
          loan_id?: string
          maturity_days?: number | null
          notes?: string | null
          tranche_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "loan_tranches_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_tranches_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "v_loans_overview"
            referencedColumns: ["loan_id"]
          },
        ]
      }
      loans: {
        Row: {
          bank_account_id: string | null
          beneficiaries: Json | null
          company_id: string
          created_at: string | null
          description: string | null
          end_date: string | null
          id: string
          installment_amount: number | null
          installment_frequency: string | null
          interest_rate: number | null
          is_active: boolean | null
          lender: string | null
          loan_type: string | null
          note: string | null
          notes: string | null
          original_amount: number | null
          remaining_amount: number | null
          start_date: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          bank_account_id?: string | null
          beneficiaries?: Json | null
          company_id: string
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          installment_amount?: number | null
          installment_frequency?: string | null
          interest_rate?: number | null
          is_active?: boolean | null
          lender?: string | null
          loan_type?: string | null
          note?: string | null
          notes?: string | null
          original_amount?: number | null
          remaining_amount?: number | null
          start_date?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          bank_account_id?: string | null
          beneficiaries?: Json | null
          company_id?: string
          created_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          installment_amount?: number | null
          installment_frequency?: string | null
          interest_rate?: number | null
          is_active?: boolean | null
          lender?: string | null
          loan_type?: string | null
          note?: string | null
          notes?: string | null
          original_amount?: number | null
          remaining_amount?: number | null
          start_date?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_balance_entries: {
        Row: {
          balance: number
          balance_date: string
          bank_account_id: string
          company_id: string
          created_at: string | null
          entered_by: string | null
          id: string
          notes: string | null
        }
        Insert: {
          balance: number
          balance_date: string
          bank_account_id: string
          company_id: string
          created_at?: string | null
          entered_by?: string | null
          id?: string
          notes?: string | null
        }
        Update: {
          balance?: number
          balance_date?: string
          bank_account_id?: string
          company_id?: string
          created_at?: string | null
          entered_by?: string | null
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_balance_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_balance_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_actuals: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_inventory: number | null
          company_id: string
          created_at: string | null
          id: string
          month: number
          notes: string | null
          opening_inventory: number | null
          outlet_id: string | null
          purchases: number | null
          returns_to_warehouse: number | null
          revenue: number | null
          status: Database["public"]["Enums"]["period_status"] | null
          updated_at: string | null
          year: number
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_inventory?: number | null
          company_id: string
          created_at?: string | null
          id?: string
          month: number
          notes?: string | null
          opening_inventory?: number | null
          outlet_id?: string | null
          purchases?: number | null
          returns_to_warehouse?: number | null
          revenue?: number | null
          status?: Database["public"]["Enums"]["period_status"] | null
          updated_at?: string | null
          year: number
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_inventory?: number | null
          company_id?: string
          created_at?: string | null
          id?: string
          month?: number
          notes?: string | null
          opening_inventory?: number | null
          outlet_id?: string | null
          purchases?: number | null
          returns_to_warehouse?: number | null
          revenue?: number | null
          status?: Database["public"]["Enums"]["period_status"] | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      monthly_cost_lines: {
        Row: {
          amount: number
          cost_category_id: string | null
          created_at: string | null
          document_ref: string | null
          id: string
          label: string | null
          monthly_actual_id: string
          notes: string | null
          source: Database["public"]["Enums"]["import_source"] | null
        }
        Insert: {
          amount?: number
          cost_category_id?: string | null
          created_at?: string | null
          document_ref?: string | null
          id?: string
          label?: string | null
          monthly_actual_id: string
          notes?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
        }
        Update: {
          amount?: number
          cost_category_id?: string | null
          created_at?: string | null
          document_ref?: string | null
          id?: string
          label?: string | null
          monthly_actual_id?: string
          notes?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_cost_lines_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_cost_lines_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "monthly_cost_lines_monthly_actual_id_fkey"
            columns: ["monthly_actual_id"]
            isOneToOne: false
            referencedRelation: "monthly_actuals"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          categories_enabled: string[] | null
          company_id: string
          created_at: string | null
          email_enabled: boolean | null
          id: string
          in_app_enabled: boolean | null
          reminder_days_before: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          categories_enabled?: string[] | null
          company_id: string
          created_at?: string | null
          email_enabled?: boolean | null
          id?: string
          in_app_enabled?: boolean | null
          reminder_days_before?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          categories_enabled?: string[] | null
          company_id?: string
          created_at?: string | null
          email_enabled?: boolean | null
          id?: string
          in_app_enabled?: boolean | null
          reminder_days_before?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_label: string | null
          action_url: string | null
          category: string
          company_id: string
          created_at: string | null
          dismissed: boolean | null
          expires_at: string | null
          id: string
          message: string
          read: boolean | null
          read_at: string | null
          reference_id: string | null
          reference_type: string | null
          severity: string
          title: string
          user_id: string | null
        }
        Insert: {
          action_label?: string | null
          action_url?: string | null
          category: string
          company_id: string
          created_at?: string | null
          dismissed?: boolean | null
          expires_at?: string | null
          id?: string
          message: string
          read?: boolean | null
          read_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          severity?: string
          title: string
          user_id?: string | null
        }
        Update: {
          action_label?: string | null
          action_url?: string | null
          category?: string
          company_id?: string
          created_at?: string | null
          dismissed?: boolean | null
          expires_at?: string | null
          id?: string
          message?: string
          read?: boolean | null
          read_at?: string | null
          reference_id?: string | null
          reference_type?: string | null
          severity?: string
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_attachments: {
        Row: {
          attachment_type: string
          company_id: string
          created_at: string | null
          extracted_data: Json | null
          file_name: string | null
          file_path: string | null
          file_size: number | null
          id: string
          is_required: boolean | null
          is_uploaded: boolean | null
          label: string
          mime_type: string | null
          notes: string | null
          outlet_id: string
          updated_at: string | null
          uploaded_at: string | null
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          attachment_type: string
          company_id: string
          created_at?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          is_required?: boolean | null
          is_uploaded?: boolean | null
          label: string
          mime_type?: string | null
          notes?: string | null
          outlet_id: string
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          attachment_type?: string
          company_id?: string
          created_at?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_path?: string | null
          file_size?: number | null
          id?: string
          is_required?: boolean | null
          is_uploaded?: boolean | null
          label?: string
          mime_type?: string | null
          notes?: string | null
          outlet_id?: string
          updated_at?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlet_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_attachments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_attachments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_attachments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_attachments_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_bank_accounts: {
        Row: {
          bank_account_id: string
          id: string
          is_primary: boolean | null
          notes: string | null
          outlet_id: string
        }
        Insert: {
          bank_account_id: string
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          outlet_id: string
        }
        Update: {
          bank_account_id?: string
          id?: string
          is_primary?: boolean | null
          notes?: string | null
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_bank_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      outlet_cost_template: {
        Row: {
          budget_annual: number | null
          budget_monthly: number | null
          cost_category_id: string
          id: string
          is_active: boolean | null
          is_fixed: boolean | null
          notes: string | null
          outlet_id: string
        }
        Insert: {
          budget_annual?: number | null
          budget_monthly?: number | null
          cost_category_id: string
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          notes?: string | null
          outlet_id: string
        }
        Update: {
          budget_annual?: number | null
          budget_monthly?: number | null
          cost_category_id?: string
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          notes?: string | null
          outlet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_cost_template_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_cost_template_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "outlet_cost_template_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_cost_template_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_cost_template_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_cost_template_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      outlet_simulations: {
        Row: {
          company_id: string
          cost_edits: Json | null
          created_at: string | null
          created_by: string | null
          id: string
          name: string
          notes: string | null
          rev_edits: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          company_id: string
          cost_edits?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          rev_edits?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          company_id?: string
          cost_edits?: Json | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          rev_edits?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outlet_simulations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      outlet_suppliers: {
        Row: {
          avg_monthly_volume: number | null
          default_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms: number | null
          id: string
          is_active: boolean | null
          notes: string | null
          outlet_id: string
          supplier_id: string
        }
        Insert: {
          avg_monthly_volume?: number | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms?: number | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          outlet_id: string
          supplier_id: string
        }
        Update: {
          avg_monthly_volume?: number | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms?: number | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          outlet_id?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outlet_suppliers_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outlet_suppliers_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_suppliers_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_suppliers_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "outlet_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      outlets: {
        Row: {
          address: string | null
          admin_cost_monthly: number | null
          advance_payment: number | null
          bp_status: string | null
          brand: string | null
          cap: string | null
          city: string | null
          closing_date: string | null
          code: string | null
          company_id: string
          concedente: string | null
          condo_marketing_monthly: number | null
          contract_duration_months: number | null
          contract_end: string | null
          contract_min_months: number | null
          contract_start: string | null
          cost_center_key: string | null
          created_at: string | null
          delivery_date: string | null
          deposit_amount: number | null
          deposit_guarantee: number | null
          email: string | null
          exit_clause_month: number | null
          exit_revenue_threshold: number | null
          id: string
          is_active: boolean | null
          mall_manager: string | null
          mall_name: string | null
          min_revenue_period: string | null
          min_revenue_target: number | null
          name: string
          notes: string | null
          opening_confirmed: boolean | null
          opening_date: string | null
          outlet_type: string | null
          phone: string | null
          photo_url: string | null
          province: string | null
          region: string | null
          rent_annual: number | null
          rent_free_days: number | null
          rent_monthly: number | null
          rent_per_sqm: number | null
          rent_year2_annual: number | null
          rent_year3_annual: number | null
          sell_sqm: number | null
          setup_cost: number | null
          sqm: number | null
          staff_budget_monthly: number | null
          target_cogs_pct: number | null
          target_margin_pct: number | null
          target_revenue_steady: number | null
          target_revenue_year1: number | null
          target_revenue_year2: number | null
          unit_code: string | null
          updated_at: string | null
          variable_rent_pct: number | null
        }
        Insert: {
          address?: string | null
          admin_cost_monthly?: number | null
          advance_payment?: number | null
          bp_status?: string | null
          brand?: string | null
          cap?: string | null
          city?: string | null
          closing_date?: string | null
          code?: string | null
          company_id: string
          concedente?: string | null
          condo_marketing_monthly?: number | null
          contract_duration_months?: number | null
          contract_end?: string | null
          contract_min_months?: number | null
          contract_start?: string | null
          cost_center_key?: string | null
          created_at?: string | null
          delivery_date?: string | null
          deposit_amount?: number | null
          deposit_guarantee?: number | null
          email?: string | null
          exit_clause_month?: number | null
          exit_revenue_threshold?: number | null
          id?: string
          is_active?: boolean | null
          mall_manager?: string | null
          mall_name?: string | null
          min_revenue_period?: string | null
          min_revenue_target?: number | null
          name: string
          notes?: string | null
          opening_confirmed?: boolean | null
          opening_date?: string | null
          outlet_type?: string | null
          phone?: string | null
          photo_url?: string | null
          province?: string | null
          region?: string | null
          rent_annual?: number | null
          rent_free_days?: number | null
          rent_monthly?: number | null
          rent_per_sqm?: number | null
          rent_year2_annual?: number | null
          rent_year3_annual?: number | null
          sell_sqm?: number | null
          setup_cost?: number | null
          sqm?: number | null
          staff_budget_monthly?: number | null
          target_cogs_pct?: number | null
          target_margin_pct?: number | null
          target_revenue_steady?: number | null
          target_revenue_year1?: number | null
          target_revenue_year2?: number | null
          unit_code?: string | null
          updated_at?: string | null
          variable_rent_pct?: number | null
        }
        Update: {
          address?: string | null
          admin_cost_monthly?: number | null
          advance_payment?: number | null
          bp_status?: string | null
          brand?: string | null
          cap?: string | null
          city?: string | null
          closing_date?: string | null
          code?: string | null
          company_id?: string
          concedente?: string | null
          condo_marketing_monthly?: number | null
          contract_duration_months?: number | null
          contract_end?: string | null
          contract_min_months?: number | null
          contract_start?: string | null
          cost_center_key?: string | null
          created_at?: string | null
          delivery_date?: string | null
          deposit_amount?: number | null
          deposit_guarantee?: number | null
          email?: string | null
          exit_clause_month?: number | null
          exit_revenue_threshold?: number | null
          id?: string
          is_active?: boolean | null
          mall_manager?: string | null
          mall_name?: string | null
          min_revenue_period?: string | null
          min_revenue_target?: number | null
          name?: string
          notes?: string | null
          opening_confirmed?: boolean | null
          opening_date?: string | null
          outlet_type?: string | null
          phone?: string | null
          photo_url?: string | null
          province?: string | null
          region?: string | null
          rent_annual?: number | null
          rent_free_days?: number | null
          rent_monthly?: number | null
          rent_per_sqm?: number | null
          rent_year2_annual?: number | null
          rent_year3_annual?: number | null
          sell_sqm?: number | null
          setup_cost?: number | null
          sqm?: number | null
          staff_budget_monthly?: number | null
          target_cogs_pct?: number | null
          target_margin_pct?: number | null
          target_revenue_steady?: number | null
          target_revenue_year1?: number | null
          target_revenue_year2?: number | null
          unit_code?: string | null
          updated_at?: string | null
          variable_rent_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payable_actions: {
        Row: {
          action_type: string
          amount: number | null
          bank_account_id: string | null
          id: string
          new_due_date: string | null
          new_status: Database["public"]["Enums"]["payable_status"] | null
          note: string | null
          old_due_date: string | null
          old_status: Database["public"]["Enums"]["payable_status"] | null
          operator_name: string | null
          payable_id: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          performed_at: string | null
          performed_by: string | null
          requested_at: string | null
        }
        Insert: {
          action_type: string
          amount?: number | null
          bank_account_id?: string | null
          id?: string
          new_due_date?: string | null
          new_status?: Database["public"]["Enums"]["payable_status"] | null
          note?: string | null
          old_due_date?: string | null
          old_status?: Database["public"]["Enums"]["payable_status"] | null
          operator_name?: string | null
          payable_id: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_at?: string | null
          performed_by?: string | null
          requested_at?: string | null
        }
        Update: {
          action_type?: string
          amount?: number | null
          bank_account_id?: string | null
          id?: string
          new_due_date?: string | null
          new_status?: Database["public"]["Enums"]["payable_status"] | null
          note?: string | null
          old_due_date?: string | null
          old_status?: Database["public"]["Enums"]["payable_status"] | null
          operator_name?: string | null
          payable_id?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          performed_at?: string | null
          performed_by?: string | null
          requested_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payable_actions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_actions_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_actions_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_actions_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "payable_actions_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payable_credit_note_links: {
        Row: {
          amount: number
          applied_at: string | null
          company_id: string
          created_at: string
          created_by: string | null
          credit_note_payable_id: string
          id: string
          payable_id: string
          status: string
        }
        Insert: {
          amount?: number
          applied_at?: string | null
          company_id: string
          created_at?: string
          created_by?: string | null
          credit_note_payable_id: string
          id?: string
          payable_id: string
          status?: string
        }
        Update: {
          amount?: number
          applied_at?: string | null
          company_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_payable_id?: string
          id?: string
          payable_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payable_credit_note_links_credit_note_payable_id_fkey"
            columns: ["credit_note_payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_credit_note_links_credit_note_payable_id_fkey"
            columns: ["credit_note_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_credit_note_links_credit_note_payable_id_fkey"
            columns: ["credit_note_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "payable_credit_note_links_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_credit_note_links_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payable_credit_note_links_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
        ]
      }
      payables: {
        Row: {
          acube_uuid: string | null
          amount_paid: number | null
          amount_remaining: number | null
          bank_transaction_id: string | null
          cash_movement_id: string | null
          closed_manually: boolean
          company_id: string
          cost_category_id: string | null
          created_at: string | null
          due_date: string
          electronic_invoice_id: string | null
          gross_amount: number
          iban: string | null
          id: string
          import_batch_id: string | null
          installment_number: number | null
          installment_total: number | null
          invoice_date: string
          invoice_number: string
          is_auto_debit: boolean
          is_forecast: boolean
          is_placeholder: boolean
          is_provisional_paid: boolean
          manual_close_reason: string | null
          net_amount: number | null
          notes: string | null
          original_due_date: string | null
          outlet_id: string | null
          parent_payable_id: string | null
          payment_bank_account_id: string | null
          payment_date: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code: string | null
          payment_method_label: string | null
          postpone_count: number | null
          postponed_to: string | null
          previous_status: Database["public"]["Enums"]["payable_status"] | null
          priority: number | null
          provisional_paid_at: string | null
          recurring_cost_id: string | null
          resolved_by: string | null
          resolved_date: string | null
          status: Database["public"]["Enums"]["payable_status"] | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_vat: string | null
          suspend_date: string | null
          suspend_reason: string | null
          updated_at: string | null
          vat_amount: number | null
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          acube_uuid?: string | null
          amount_paid?: number | null
          amount_remaining?: number | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          closed_manually?: boolean
          company_id: string
          cost_category_id?: string | null
          created_at?: string | null
          due_date: string
          electronic_invoice_id?: string | null
          gross_amount: number
          iban?: string | null
          id?: string
          import_batch_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          invoice_date: string
          invoice_number: string
          is_auto_debit?: boolean
          is_forecast?: boolean
          is_placeholder?: boolean
          is_provisional_paid?: boolean
          manual_close_reason?: string | null
          net_amount?: number | null
          notes?: string | null
          original_due_date?: string | null
          outlet_id?: string | null
          parent_payable_id?: string | null
          payment_bank_account_id?: string | null
          payment_date?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code?: string | null
          payment_method_label?: string | null
          postpone_count?: number | null
          postponed_to?: string | null
          previous_status?: Database["public"]["Enums"]["payable_status"] | null
          priority?: number | null
          provisional_paid_at?: string | null
          recurring_cost_id?: string | null
          resolved_by?: string | null
          resolved_date?: string | null
          status?: Database["public"]["Enums"]["payable_status"] | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          suspend_date?: string | null
          suspend_reason?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          acube_uuid?: string | null
          amount_paid?: number | null
          amount_remaining?: number | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          closed_manually?: boolean
          company_id?: string
          cost_category_id?: string | null
          created_at?: string | null
          due_date?: string
          electronic_invoice_id?: string | null
          gross_amount?: number
          iban?: string | null
          id?: string
          import_batch_id?: string | null
          installment_number?: number | null
          installment_total?: number | null
          invoice_date?: string
          invoice_number?: string
          is_auto_debit?: boolean
          is_forecast?: boolean
          is_placeholder?: boolean
          is_provisional_paid?: boolean
          manual_close_reason?: string | null
          net_amount?: number | null
          notes?: string | null
          original_due_date?: string | null
          outlet_id?: string | null
          parent_payable_id?: string | null
          payment_bank_account_id?: string | null
          payment_date?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
          payment_method_code?: string | null
          payment_method_label?: string | null
          postpone_count?: number | null
          postponed_to?: string | null
          previous_status?: Database["public"]["Enums"]["payable_status"] | null
          priority?: number | null
          provisional_paid_at?: string | null
          recurring_cost_id?: string | null
          resolved_by?: string | null
          resolved_date?: string | null
          status?: Database["public"]["Enums"]["payable_status"] | null
          supplier_id?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          suspend_date?: string | null
          suspend_reason?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "payables_electronic_invoice_id_fkey"
            columns: ["electronic_invoice_id"]
            isOneToOne: false
            referencedRelation: "electronic_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_electronic_invoice_id_fkey"
            columns: ["electronic_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_electronic_invoices_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_parent_payable_id_fkey"
            columns: ["parent_payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_parent_payable_id_fkey"
            columns: ["parent_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_parent_payable_id_fkey"
            columns: ["parent_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "payables_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_recurring_cost_id_fkey"
            columns: ["recurring_cost_id"]
            isOneToOne: false
            referencedRelation: "recurring_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_batch_items: {
        Row: {
          acube_authorize_url: string | null
          acube_payment_provider: string | null
          acube_payment_uuid: string | null
          acube_status: string | null
          amount: number
          batch_id: string
          beneficiary_iban: string | null
          beneficiary_name: string
          company_id: string
          created_at: string | null
          currency: string | null
          due_date: string | null
          executed_at: string | null
          execution_notes: string | null
          id: string
          invoice_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          payable_id: string | null
          payment_reason: string | null
          priority: number | null
          status: string | null
        }
        Insert: {
          acube_authorize_url?: string | null
          acube_payment_provider?: string | null
          acube_payment_uuid?: string | null
          acube_status?: string | null
          amount: number
          batch_id: string
          beneficiary_iban?: string | null
          beneficiary_name: string
          company_id: string
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          executed_at?: string | null
          execution_notes?: string | null
          id?: string
          invoice_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          payable_id?: string | null
          payment_reason?: string | null
          priority?: number | null
          status?: string | null
        }
        Update: {
          acube_authorize_url?: string | null
          acube_payment_provider?: string | null
          acube_payment_uuid?: string | null
          acube_status?: string | null
          amount?: number
          batch_id?: string
          beneficiary_iban?: string | null
          beneficiary_name?: string
          company_id?: string
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          executed_at?: string | null
          execution_notes?: string | null
          id?: string
          invoice_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          payable_id?: string | null
          payment_reason?: string | null
          priority?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payment_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_batch_items_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_batches: {
        Row: {
          acube_completed_at: string | null
          acube_initiated_at: string | null
          balance_after: number | null
          balance_before: number | null
          bank_account_id: string
          batch_number: string
          company_id: string
          created_at: string | null
          created_by: string | null
          executed_at: string | null
          executed_by: string | null
          id: string
          notes: string | null
          payment_count: number | null
          sent_at: string | null
          sent_to_email: string | null
          status: string | null
          total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          acube_completed_at?: string | null
          acube_initiated_at?: string | null
          balance_after?: number | null
          balance_before?: number | null
          bank_account_id: string
          batch_number: string
          company_id: string
          created_at?: string | null
          created_by?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          payment_count?: number | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          acube_completed_at?: string | null
          acube_initiated_at?: string | null
          balance_after?: number | null
          balance_before?: number | null
          bank_account_id?: string
          batch_number?: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          executed_at?: string | null
          executed_by?: string | null
          id?: string
          notes?: string | null
          payment_count?: number | null
          sent_at?: string | null
          sent_to_email?: string | null
          status?: string | null
          total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_import_anomalies: {
        Row: {
          affected_invoice_ids: string[]
          anomaly_type: string
          come_risolvere: string | null
          company_id: string
          created_at: string
          descrizione: string | null
          id: string
          resolved_at: string | null
          resolved_by: string | null
          stato: string
          supplier_id: string | null
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          affected_invoice_ids?: string[]
          anomaly_type: string
          come_risolvere?: string | null
          company_id: string
          created_at?: string
          descrizione?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          stato?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          affected_invoice_ids?: string[]
          anomaly_type?: string
          come_risolvere?: string | null
          company_id?: string
          created_at?: string
          descrizione?: string | null
          id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          stato?: string
          supplier_id?: string | null
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_import_anomalies_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_schedule: {
        Row: {
          amount: number
          bank_account_id: string | null
          bank_reference: string | null
          company_id: string
          created_at: string | null
          due_date: string
          id: string
          installment_number: number | null
          invoice_id: string | null
          note: string | null
          paid_amount: number | null
          paid_date: string | null
          payment_method: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          bank_reference?: string | null
          company_id?: string
          created_at?: string | null
          due_date: string
          id?: string
          installment_number?: number | null
          invoice_id?: string | null
          note?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_method?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          bank_reference?: string | null
          company_id?: string
          created_at?: string | null
          due_date?: string
          id?: string
          installment_number?: number | null
          invoice_id?: string | null
          note?: string | null
          paid_amount?: number | null
          paid_date?: string | null
          payment_method?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      personnel_gross_cost: {
        Row: {
          company_id: string
          compensi_amm: number
          contr_ebinter: number
          contr_est: number
          contr_gestione_separata: number
          contr_inps: number
          created_at: string
          filiale_code: string
          id: string
          import_id: string | null
          inail_pat: Json
          month: number
          numero_dipendenti: number | null
          outlet_id: string | null
          outlet_label: string | null
          retribuzioni_lorde: number | null
          source_file: string | null
          tfr_fondo: number
          totale_retribuzioni: number | null
          updated_at: string
          year: number
        }
        Insert: {
          company_id: string
          compensi_amm?: number
          contr_ebinter?: number
          contr_est?: number
          contr_gestione_separata?: number
          contr_inps?: number
          created_at?: string
          filiale_code: string
          id?: string
          import_id?: string | null
          inail_pat?: Json
          month: number
          numero_dipendenti?: number | null
          outlet_id?: string | null
          outlet_label?: string | null
          retribuzioni_lorde?: number | null
          source_file?: string | null
          tfr_fondo?: number
          totale_retribuzioni?: number | null
          updated_at?: string
          year: number
        }
        Update: {
          company_id?: string
          compensi_amm?: number
          contr_ebinter?: number
          contr_est?: number
          contr_gestione_separata?: number
          contr_inps?: number
          created_at?: string
          filiale_code?: string
          id?: string
          import_id?: string | null
          inail_pat?: Json
          month?: number
          numero_dipendenti?: number | null
          outlet_id?: string | null
          outlet_label?: string | null
          retribuzioni_lorde?: number | null
          source_file?: string | null
          tfr_fondo?: number
          totale_retribuzioni?: number | null
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "personnel_gross_cost_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "personnel_gross_cost_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      personnel_gross_cost_employee: {
        Row: {
          company_id: string
          contribuzione: number
          created_at: string
          employee_id: string | null
          employee_name: string | null
          id: string
          import_id: string | null
          inail: number
          is_admin: boolean
          lordo: number
          matricola: string
          month: number
          outlet_code: string | null
          retribuzione: number
          source_file: string | null
          tfr: number
          updated_at: string
          year: number
        }
        Insert: {
          company_id: string
          contribuzione?: number
          created_at?: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          inail?: number
          is_admin?: boolean
          lordo?: number
          matricola: string
          month: number
          outlet_code?: string | null
          retribuzione?: number
          source_file?: string | null
          tfr?: number
          updated_at?: string
          year: number
        }
        Update: {
          company_id?: string
          contribuzione?: number
          created_at?: string
          employee_id?: string | null
          employee_name?: string | null
          id?: string
          import_id?: string | null
          inail?: number
          is_admin?: boolean
          lordo?: number
          matricola?: string
          month?: number
          outlet_code?: string | null
          retribuzione?: number
          source_file?: string | null
          tfr?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "personnel_gross_cost_employee_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_employee_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_employee_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employee_costs_by_outlet"
            referencedColumns: ["employee_id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_employee_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "personnel_gross_cost_employee_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      personnel_gross_cost_employee_imports: {
        Row: {
          company_id: string
          employees_total: number | null
          file_name: string | null
          file_total: number | null
          id: string
          imported_at: string
          imported_by: string | null
          note: string | null
          period_label: string | null
          rows_total: number | null
        }
        Insert: {
          company_id: string
          employees_total?: number | null
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          note?: string | null
          period_label?: string | null
          rows_total?: number | null
        }
        Update: {
          company_id?: string
          employees_total?: number | null
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          note?: string | null
          period_label?: string | null
          rows_total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "personnel_gross_cost_employee_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      personnel_gross_cost_imports: {
        Row: {
          company_id: string
          file_name: string | null
          file_total: number | null
          id: string
          imported_at: string
          imported_by: string | null
          month: number | null
          note: string | null
          outlets_total: number | null
          year: number | null
        }
        Insert: {
          company_id: string
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          month?: number | null
          note?: string | null
          outlets_total?: number | null
          year?: number | null
        }
        Update: {
          company_id?: string
          file_name?: string | null
          file_total?: number | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          month?: number | null
          note?: string | null
          outlets_total?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "personnel_gross_cost_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_imports: {
        Row: {
          company_id: string
          created_at: string | null
          error_message: string | null
          file_format: string | null
          file_name: string
          file_path: string | null
          file_size: number | null
          id: string
          outlet_id: string | null
          period_from: string | null
          period_to: string | null
          records_count: number | null
          status: string | null
          uploaded_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_imports_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_imports: {
        Row: {
          company_id: string
          created_at: string | null
          error_message: string | null
          file_format: string | null
          file_name: string
          file_path: string | null
          file_size: number | null
          id: string
          outlet_id: string | null
          period_from: string | null
          period_to: string | null
          records_count: number | null
          status: string | null
          uploaded_at: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          file_format?: string | null
          file_name?: string
          file_path?: string | null
          file_size?: number | null
          id?: string
          outlet_id?: string | null
          period_from?: string | null
          period_to?: string | null
          records_count?: number | null
          status?: string | null
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipt_imports_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "company_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_imports_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_log: {
        Row: {
          applied_amount: number | null
          bank_transaction_id: string | null
          company_id: string
          confidence: number
          confirmed_at: string | null
          id: string
          match_type: string
          notes: string | null
          payable_id: string | null
          performed_at: string
          performed_by: string | null
          score_amount: number | null
          score_date: number | null
          score_name: number | null
          status: string
        }
        Insert: {
          applied_amount?: number | null
          bank_transaction_id?: string | null
          company_id: string
          confidence: number
          confirmed_at?: string | null
          id?: string
          match_type: string
          notes?: string | null
          payable_id?: string | null
          performed_at?: string
          performed_by?: string | null
          score_amount?: number | null
          score_date?: number | null
          score_name?: number | null
          status?: string
        }
        Update: {
          applied_amount?: number | null
          bank_transaction_id?: string | null
          company_id?: string
          confidence?: number
          confirmed_at?: string | null
          id?: string
          match_type?: string
          notes?: string | null
          payable_id?: string | null
          performed_at?: string
          performed_by?: string | null
          score_amount?: number | null
          score_date?: number | null
          score_name?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_log_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "reconciliation_log_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
        ]
      }
      recurring_costs: {
        Row: {
          amount: number
          company_id: string
          cost_category_id: string | null
          cost_center: string
          created_at: string | null
          day_of_month: number | null
          description: string
          end_date: string | null
          frequency: string
          id: string
          is_active: boolean | null
          month_start: number | null
          notes: string | null
          payment_method: string | null
          start_date: string | null
          supplier_name: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number
          company_id: string
          cost_category_id?: string | null
          cost_center: string
          created_at?: string | null
          day_of_month?: number | null
          description: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          month_start?: number | null
          notes?: string | null
          payment_method?: string | null
          start_date?: string | null
          supplier_name?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          cost_category_id?: string | null
          cost_center?: string
          created_at?: string | null
          day_of_month?: number | null
          description?: string
          end_date?: string | null
          frequency?: string
          id?: string
          is_active?: boolean | null
          month_start?: number | null
          notes?: string | null
          payment_method?: string | null
          start_date?: string | null
          supplier_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_costs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_costs_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_costs_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
        ]
      }
      riba_distinta_lines: {
        Row: {
          company_id: string
          created_at: string
          distinta_id: string
          id: string
          match_status: string
          matched_payable_id: string | null
          matched_payable_ids: string[] | null
          matched_supplier_id: string | null
          raw_amount: number | null
          raw_due_date: string | null
          raw_invoice: string | null
          raw_supplier: string | null
          raw_vat: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          distinta_id: string
          id?: string
          match_status?: string
          matched_payable_id?: string | null
          matched_payable_ids?: string[] | null
          matched_supplier_id?: string | null
          raw_amount?: number | null
          raw_due_date?: string | null
          raw_invoice?: string | null
          raw_supplier?: string | null
          raw_vat?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          distinta_id?: string
          id?: string
          match_status?: string
          matched_payable_id?: string | null
          matched_payable_ids?: string[] | null
          matched_supplier_id?: string | null
          raw_amount?: number | null
          raw_due_date?: string | null
          raw_invoice?: string | null
          raw_supplier?: string | null
          raw_vat?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "riba_distinta_lines_distinta_id_fkey"
            columns: ["distinta_id"]
            isOneToOne: false
            referencedRelation: "riba_distinte"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riba_distinta_lines_matched_payable_id_fkey"
            columns: ["matched_payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riba_distinta_lines_matched_payable_id_fkey"
            columns: ["matched_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riba_distinta_lines_matched_payable_id_fkey"
            columns: ["matched_payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "riba_distinta_lines_matched_supplier_id_fkey"
            columns: ["matched_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      riba_distinte: {
        Row: {
          bank_account_id: string | null
          company_id: string
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          declared_total: number | null
          file_name: string | null
          file_path: string | null
          id: string
          line_count: number
          matched_count: number
          matched_total: number
          note: string | null
          source_kind: string
          status: string
        }
        Insert: {
          bank_account_id?: string | null
          company_id: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_total?: number | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          line_count?: number
          matched_count?: number
          matched_total?: number
          note?: string | null
          source_kind?: string
          status?: string
        }
        Update: {
          bank_account_id?: string | null
          company_id?: string
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          declared_total?: number | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          line_count?: number
          matched_count?: number
          matched_total?: number
          note?: string | null
          source_kind?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "riba_distinte_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sdi_config: {
        Row: {
          accreditation_status: string | null
          activated_at: string | null
          channel_type: string | null
          codice_fiscale_trasmittente: string
          codice_sdi: string | null
          company_id: string
          created_at: string | null
          endpoint_url: string | null
          environment: string | null
          id: string
          last_test_at: string | null
          pec_ricezione: string | null
          progressivo_invio: number | null
          ssl_cert_secret_name: string | null
          ssl_key_secret_name: string | null
          updated_at: string | null
        }
        Insert: {
          accreditation_status?: string | null
          activated_at?: string | null
          channel_type?: string | null
          codice_fiscale_trasmittente: string
          codice_sdi?: string | null
          company_id: string
          created_at?: string | null
          endpoint_url?: string | null
          environment?: string | null
          id?: string
          last_test_at?: string | null
          pec_ricezione?: string | null
          progressivo_invio?: number | null
          ssl_cert_secret_name?: string | null
          ssl_key_secret_name?: string | null
          updated_at?: string | null
        }
        Update: {
          accreditation_status?: string | null
          activated_at?: string | null
          channel_type?: string | null
          codice_fiscale_trasmittente?: string
          codice_sdi?: string | null
          company_id?: string
          created_at?: string | null
          endpoint_url?: string | null
          environment?: string | null
          id?: string
          last_test_at?: string | null
          pec_ricezione?: string | null
          progressivo_invio?: number | null
          ssl_cert_secret_name?: string | null
          ssl_key_secret_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sdi_config_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: true
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      sdi_sync_log: {
        Row: {
          company_id: string
          corrispettivi_count: number | null
          created_at: string | null
          date_from: string | null
          date_to: string | null
          duration_ms: number | null
          errors: Json | null
          fatture_count: number | null
          id: string
          status: string
          trigger: string
          triggered_by: string | null
        }
        Insert: {
          company_id: string
          corrispettivi_count?: number | null
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          errors?: Json | null
          fatture_count?: number | null
          id?: string
          status?: string
          trigger: string
          triggered_by?: string | null
        }
        Update: {
          company_id?: string
          corrispettivi_count?: number | null
          created_at?: string | null
          date_from?: string | null
          date_to?: string | null
          duration_ms?: number | null
          errors?: Json | null
          fatture_count?: number | null
          id?: string
          status?: string
          trigger?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sdi_sync_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_allocation_details: {
        Row: {
          created_at: string | null
          fixed_value: number | null
          id: string
          outlet_id: string
          percentage: number | null
          rule_id: string
        }
        Insert: {
          created_at?: string | null
          fixed_value?: number | null
          id?: string
          outlet_id: string
          percentage?: number | null
          rule_id: string
        }
        Update: {
          created_at?: string | null
          fixed_value?: number | null
          id?: string
          outlet_id?: string
          percentage?: number | null
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_allocation_details_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_allocation_details_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "supplier_allocation_details_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "supplier_allocation_details_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "supplier_allocation_details_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "supplier_allocation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_allocation_rules: {
        Row: {
          allocation_mode: string
          company_id: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          allocation_mode: string
          company_id: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          allocation_mode?: string
          company_id?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_allocation_rules_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_opening_balances: {
        Row: {
          as_of_date: string | null
          company_id: string
          created_at: string | null
          fiscal_year: number
          id: string
          note: string | null
          opening_balance: number
          source: string | null
          supplier_id: string
          updated_at: string | null
        }
        Insert: {
          as_of_date?: string | null
          company_id: string
          created_at?: string | null
          fiscal_year: number
          id?: string
          note?: string | null
          opening_balance?: number
          source?: string | null
          supplier_id: string
          updated_at?: string | null
        }
        Update: {
          as_of_date?: string | null
          company_id?: string
          created_at?: string | null
          fiscal_year?: number
          id?: string
          note?: string | null
          opening_balance?: number
          source?: string | null
          supplier_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_opening_balances_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payment_proposals: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          company_id: string
          created_at: string
          id: string
          note: string | null
          prev_bank_account_id: string | null
          prev_base: string | null
          prev_method: string | null
          prev_prima_gg: number | null
          prev_rate: number | null
          proposed_bank_account_id: string | null
          proposed_base: string | null
          proposed_method: string | null
          proposed_prima_gg: number | null
          proposed_rate: number | null
          proposed_scad_label: string | null
          reviewed_by: string | null
          status: string
          supplier_id: string
          supplier_name: string | null
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          company_id: string
          created_at?: string
          id?: string
          note?: string | null
          prev_bank_account_id?: string | null
          prev_base?: string | null
          prev_method?: string | null
          prev_prima_gg?: number | null
          prev_rate?: number | null
          proposed_bank_account_id?: string | null
          proposed_base?: string | null
          proposed_method?: string | null
          proposed_prima_gg?: number | null
          proposed_rate?: number | null
          proposed_scad_label?: string | null
          reviewed_by?: string | null
          status?: string
          supplier_id: string
          supplier_name?: string | null
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          company_id?: string
          created_at?: string
          id?: string
          note?: string | null
          prev_bank_account_id?: string | null
          prev_base?: string | null
          prev_method?: string | null
          prev_prima_gg?: number | null
          prev_rate?: number | null
          proposed_bank_account_id?: string | null
          proposed_base?: string | null
          proposed_method?: string | null
          proposed_prima_gg?: number | null
          proposed_rate?: number | null
          proposed_scad_label?: string | null
          reviewed_by?: string | null
          status?: string
          supplier_id?: string
          supplier_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payment_proposals_proposed_bank_account_id_fkey"
            columns: ["proposed_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payment_proposals_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          cap: string | null
          category: string | null
          citta: string | null
          codice_fiscale: string | null
          codice_sdi: string | null
          company_id: string
          comune: string | null
          cost_center: string | null
          created_at: string | null
          default_cost_category_id: string | null
          default_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms: number | null
          email: string | null
          fiscal_code: string | null
          iban: string | null
          id: string
          indirizzo: string | null
          is_active: boolean | null
          is_deleted: boolean | null
          is_utility: boolean
          name: string
          nazione: string | null
          note: string | null
          notes: string | null
          numero_rate: number | null
          paese: string | null
          partita_iva: string | null
          payment_bank_account_id: string | null
          payment_base: string | null
          payment_method: string | null
          payment_terms: number | null
          pec: string | null
          prima_scadenza_gg: number | null
          provincia: string | null
          ragione_sociale: string | null
          regime_fiscale: string | null
          slug: string | null
          source: string | null
          telefono: string | null
          updated_at: string | null
          vat_number: string | null
        }
        Insert: {
          cap?: string | null
          category?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          codice_sdi?: string | null
          company_id: string
          comune?: string | null
          cost_center?: string | null
          created_at?: string | null
          default_cost_category_id?: string | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms?: number | null
          email?: string | null
          fiscal_code?: string | null
          iban?: string | null
          id?: string
          indirizzo?: string | null
          is_active?: boolean | null
          is_deleted?: boolean | null
          is_utility?: boolean
          name: string
          nazione?: string | null
          note?: string | null
          notes?: string | null
          numero_rate?: number | null
          paese?: string | null
          partita_iva?: string | null
          payment_bank_account_id?: string | null
          payment_base?: string | null
          payment_method?: string | null
          payment_terms?: number | null
          pec?: string | null
          prima_scadenza_gg?: number | null
          provincia?: string | null
          ragione_sociale?: string | null
          regime_fiscale?: string | null
          slug?: string | null
          source?: string | null
          telefono?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Update: {
          cap?: string | null
          category?: string | null
          citta?: string | null
          codice_fiscale?: string | null
          codice_sdi?: string | null
          company_id?: string
          comune?: string | null
          cost_center?: string | null
          created_at?: string | null
          default_cost_category_id?: string | null
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          default_payment_terms?: number | null
          email?: string | null
          fiscal_code?: string | null
          iban?: string | null
          id?: string
          indirizzo?: string | null
          is_active?: boolean | null
          is_deleted?: boolean | null
          is_utility?: boolean
          name?: string
          nazione?: string | null
          note?: string | null
          notes?: string | null
          numero_rate?: number | null
          paese?: string | null
          partita_iva?: string | null
          payment_bank_account_id?: string | null
          payment_base?: string | null
          payment_method?: string | null
          payment_terms?: number | null
          pec?: string | null
          prima_scadenza_gg?: number | null
          provincia?: string | null
          ragione_sociale?: string | null
          regime_fiscale?: string | null
          slug?: string | null
          source?: string | null
          telefono?: string | null
          updated_at?: string | null
          vat_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_default_cost_category_id_fkey"
            columns: ["default_cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_default_cost_category_id_fkey"
            columns: ["default_cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "suppliers_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_run_details: {
        Row: {
          amount: number | null
          company_id: string
          counterparty: string | null
          created_at: string
          currency: string | null
          detail_type: string
          doc_date: string | null
          error_message: string | null
          extra: Json | null
          feed: Database["public"]["Enums"]["sync_feed"]
          id: string
          items_count: number
          label: string
          reference: string | null
          sync_run_id: string
        }
        Insert: {
          amount?: number | null
          company_id: string
          counterparty?: string | null
          created_at?: string
          currency?: string | null
          detail_type: string
          doc_date?: string | null
          error_message?: string | null
          extra?: Json | null
          feed: Database["public"]["Enums"]["sync_feed"]
          id?: string
          items_count?: number
          label: string
          reference?: string | null
          sync_run_id: string
        }
        Update: {
          amount?: number | null
          company_id?: string
          counterparty?: string | null
          created_at?: string
          currency?: string | null
          detail_type?: string
          doc_date?: string | null
          error_message?: string | null
          extra?: Json | null
          feed?: Database["public"]["Enums"]["sync_feed"]
          id?: string
          items_count?: number
          label?: string
          reference?: string | null
          sync_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_run_details_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_run_details_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          company_id: string
          duration_ms: number | null
          error_message: string | null
          feed: Database["public"]["Enums"]["sync_feed"]
          id: string
          items_downloaded: number
          origine: Database["public"]["Enums"]["sync_origin"]
          period_from: string | null
          period_to: string | null
          run_at: string
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          company_id: string
          duration_ms?: number | null
          error_message?: string | null
          feed: Database["public"]["Enums"]["sync_feed"]
          id?: string
          items_downloaded?: number
          origine?: Database["public"]["Enums"]["sync_origin"]
          period_from?: string | null
          period_to?: string | null
          run_at?: string
          status: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          company_id?: string
          duration_ms?: number | null
          error_message?: string | null
          feed?: Database["public"]["Enums"]["sync_feed"]
          id?: string
          items_downloaded?: number
          origine?: Database["public"]["Enums"]["sync_origin"]
          period_from?: string | null
          period_to?: string | null
          run_at?: string
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      system_deploy_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      tickets: {
        Row: {
          aggiornato_il: string
          allegati: Json
          autofix_attempts: number
          autofix_last_attempt_at: string | null
          autofix_last_request_id: number | null
          autore: string
          autore_id: string | null
          commenti: Json
          creato_il: string
          descrizione: string | null
          id: string
          last_seen_by_author_at: string | null
          modulo: string
          note_fix: string | null
          priorita: string
          resolution_branch: string | null
          resolution_pr_url: string | null
          risolto_il: string | null
          screenshot_url: string | null
          stato: string
          tipo: string
          titolo: string
        }
        Insert: {
          aggiornato_il?: string
          allegati?: Json
          autofix_attempts?: number
          autofix_last_attempt_at?: string | null
          autofix_last_request_id?: number | null
          autore: string
          autore_id?: string | null
          commenti?: Json
          creato_il?: string
          descrizione?: string | null
          id?: string
          last_seen_by_author_at?: string | null
          modulo: string
          note_fix?: string | null
          priorita?: string
          resolution_branch?: string | null
          resolution_pr_url?: string | null
          risolto_il?: string | null
          screenshot_url?: string | null
          stato?: string
          tipo: string
          titolo: string
        }
        Update: {
          aggiornato_il?: string
          allegati?: Json
          autofix_attempts?: number
          autofix_last_attempt_at?: string | null
          autofix_last_request_id?: number | null
          autore?: string
          autore_id?: string | null
          commenti?: Json
          creato_il?: string
          descrizione?: string | null
          id?: string
          last_seen_by_author_at?: string | null
          modulo?: string
          note_fix?: string | null
          priorita?: string
          resolution_branch?: string | null
          resolution_pr_url?: string | null
          risolto_il?: string | null
          screenshot_url?: string | null
          stato?: string
          tipo?: string
          titolo?: string
        }
        Relationships: []
      }
      user_outlet_access: {
        Row: {
          can_write: boolean | null
          company_id: string
          outlet_id: string
          user_id: string
        }
        Insert: {
          can_write?: boolean | null
          company_id?: string
          outlet_id: string
          user_id: string
        }
        Update: {
          can_write?: boolean | null
          company_id?: string
          outlet_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_outlet_access_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_outlet_access_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_outlet_access_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "user_outlet_access_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "user_outlet_access_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "user_outlet_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          company_id: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          last_name: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean | null
          last_name?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          company_id?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          last_name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      cash_movements: {
        Row: {
          ai_categorized_at: string | null
          ai_category_id: string | null
          ai_confidence: number | null
          ai_method: string | null
          amount: number | null
          bank_account_id: string | null
          bank_transaction_id: string | null
          category: string | null
          company_id: string | null
          cost_category_id: string | null
          counterpart: string | null
          created_at: string | null
          date: string | null
          description: string | null
          id: string | null
          is_reconciled: boolean | null
          payable_id: string | null
          reconciled_with: string | null
          reference: string | null
          supplier_id: string | null
          type: Database["public"]["Enums"]["transaction_type"] | null
          verified: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_with"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_with"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_reconciled_invoice_id_fkey"
            columns: ["reconciled_with"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
          {
            foreignKeyName: "bank_transactions_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_bp_vs_actual_outlet: {
        Row: {
          actual_cogs: number | null
          actual_ebitda: number | null
          actual_opex: number | null
          actual_revenue: number | null
          bp_cogs: number | null
          bp_ebitda: number | null
          bp_opex: number | null
          bp_revenue: number | null
          company_id: string | null
          data_source: string | null
          ebitda_variance: number | null
          month: number | null
          opex_variance: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          performance_signal: string | null
          period_date: string | null
          revenue_variance: number | null
          revenue_variance_pct: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_budget_variance: {
        Row: {
          account_code: string | null
          account_name: string | null
          actual_amount: number | null
          approved_at: string | null
          approved_by: string | null
          budget_amount: number | null
          company_id: string | null
          cost_center: string | null
          created_at: string | null
          id: string | null
          is_approved: boolean | null
          macro_group: string | null
          month: number | null
          note: string | null
          updated_at: string | null
          variance: number | null
          variance_pct: number | null
          year: number | null
        }
        Insert: {
          account_code?: string | null
          account_name?: string | null
          actual_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          id?: string | null
          is_approved?: boolean | null
          macro_group?: string | null
          month?: number | null
          note?: string | null
          updated_at?: string | null
          variance?: never
          variance_pct?: never
          year?: number | null
        }
        Update: {
          account_code?: string | null
          account_name?: string | null
          actual_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string | null
          cost_center?: string | null
          created_at?: string | null
          id?: string | null
          is_approved?: boolean | null
          macro_group?: string | null
          month?: number | null
          note?: string | null
          updated_at?: string | null
          variance?: never
          variance_pct?: never
          year?: number | null
        }
        Relationships: []
      }
      v_budget_vs_actual: {
        Row: {
          actual_cogs: number | null
          actual_ebitda: number | null
          actual_location: number | null
          actual_margin: number | null
          actual_margin_pct: number | null
          actual_revenue: number | null
          actual_staff: number | null
          budget_cogs: number | null
          budget_location_monthly: number | null
          budget_revenue_monthly: number | null
          budget_staff_monthly: number | null
          company_id: string | null
          month: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          period_date: string | null
          period_status: Database["public"]["Enums"]["period_status"] | null
          profitability_signal: string | null
          revenue_signal: string | null
          revenue_variance: number | null
          revenue_variance_pct: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_business_plan_chain: {
        Row: {
          actual_revenue: number | null
          avg_ebitda_per_outlet: number | null
          avg_margin_pct: number | null
          avg_revenue_per_outlet: number | null
          company_id: string | null
          ebitda_margin_pct: number | null
          forecast_revenue: number | null
          month_num: number | null
          outlets_count: number | null
          period_date: string | null
          total_admin_cost: number | null
          total_cogs: number | null
          total_condo_marketing: number | null
          total_contribution_margin: number | null
          total_ebitda: number | null
          total_opex: number | null
          total_other_costs: number | null
          total_rent: number | null
          total_revenue: number | null
          total_staff_cost: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_business_plan_outlet: {
        Row: {
          admin_cost: number | null
          bp_status: string | null
          cogs: number | null
          company_id: string | null
          condo_marketing: number | null
          contribution_margin: number | null
          data_source: string | null
          ebitda: number | null
          month_num: number | null
          opening_date: string | null
          other_costs: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          period_date: string | null
          rent: number | null
          revenue: number | null
          revenue_type: string | null
          staff_cost: number | null
          total_opex: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_cash_position: {
        Row: {
          account_count: number | null
          company_id: string | null
          current_balance: number | null
          last_updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_contracts_expiring: {
        Row: {
          alert_level: string | null
          auto_renewal: boolean | null
          company_id: string | null
          contract_name: string | null
          contract_type: string | null
          counterpart: string | null
          days_to_expiry: number | null
          days_to_notice_deadline: number | null
          end_date: string | null
          id: string | null
          monthly_amount: number | null
          notice_deadline: string | null
          outlet_id: string | null
          outlet_name: string | null
          status: Database["public"]["Enums"]["contract_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_electronic_invoices_list: {
        Row: {
          acube_uuid: string | null
          bank_transaction_id: string | null
          cash_movement_id: string | null
          codice_destinatario: string | null
          company_id: string | null
          cost_category_id: string | null
          created_at: string | null
          description: string | null
          due_date: string | null
          gross_amount: number | null
          has_xml: boolean | null
          id: string | null
          import_batch_id: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_reconciled: boolean | null
          monthly_cost_line_id: string | null
          net_amount: number | null
          notes: string | null
          outlet_id: string | null
          payment_method: string | null
          payment_terms: string | null
          retention_end: string | null
          retention_start: string | null
          retention_status: string | null
          sdi_id: string | null
          sdi_status: string | null
          source: Database["public"]["Enums"]["import_source"] | null
          storage_path: string | null
          supplier_fiscal_code: string | null
          supplier_name: string | null
          supplier_vat: string | null
          tipo_documento: string | null
          updated_at: string | null
          vat_amount: number | null
          xml_file_path: string | null
        }
        Insert: {
          acube_uuid?: string | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          codice_destinatario?: string | null
          company_id?: string | null
          cost_category_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          gross_amount?: number | null
          has_xml?: never
          id?: string | null
          import_batch_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_reconciled?: boolean | null
          monthly_cost_line_id?: string | null
          net_amount?: number | null
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          storage_path?: string | null
          supplier_fiscal_code?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          tipo_documento?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          xml_file_path?: string | null
        }
        Update: {
          acube_uuid?: string | null
          bank_transaction_id?: string | null
          cash_movement_id?: string | null
          codice_destinatario?: string | null
          company_id?: string | null
          cost_category_id?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string | null
          gross_amount?: number | null
          has_xml?: never
          id?: string | null
          import_batch_id?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_reconciled?: boolean | null
          monthly_cost_line_id?: string | null
          net_amount?: number | null
          notes?: string | null
          outlet_id?: string | null
          payment_method?: string | null
          payment_terms?: string | null
          retention_end?: string | null
          retention_start?: string | null
          retention_status?: string | null
          sdi_id?: string | null
          sdi_status?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          storage_path?: string | null
          supplier_fiscal_code?: string | null
          supplier_name?: string | null
          supplier_vat?: string | null
          tipo_documento?: string | null
          updated_at?: string | null
          vat_amount?: number | null
          xml_file_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "electronic_invoices_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "electronic_invoices_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "v_recent_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_monthly_cost_line_id_fkey"
            columns: ["monthly_cost_line_id"]
            isOneToOne: false
            referencedRelation: "monthly_cost_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "electronic_invoices_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_employee_costs_by_outlet: {
        Row: {
          allocation_pct: number | null
          contributi_allocati: number | null
          employee_id: string | null
          employee_name: string | null
          inail_allocato: number | null
          month: number | null
          outlet_code: string | null
          retribuzione_allocata: number | null
          role_at_outlet: string | null
          tfr_allocato: number | null
          totale_allocato: number | null
          year: number | null
        }
        Relationships: []
      }
      v_executive_dashboard: {
        Row: {
          active_outlets: number | null
          avg_ebitda_per_outlet: number | null
          avg_margin_pct: number | null
          avg_revenue_per_outlet: number | null
          company_id: string | null
          ebitda_margin_pct: number | null
          month: number | null
          period_date: string | null
          total_cogs: number | null
          total_contribution_margin: number | null
          total_ebitda: number | null
          total_net_result: number | null
          total_opex: number | null
          total_revenue: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_fornitori_kpi: {
        Row: {
          company_id: string | null
          credito: number | null
          gross_positive: number | null
          gross_total: number | null
          last_date: string | null
          methods: string[] | null
          overdue: number | null
          paid: number | null
          paid_count: number | null
          pay_count: number | null
          pending: number | null
          pending_excl_nc: number | null
          reconciled_count: number | null
          supplier_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_loans_overview: {
        Row: {
          company_id: string | null
          description: string | null
          end_date: string | null
          first_disbursement: string | null
          interest_rate: number | null
          last_disbursement: string | null
          loan_id: string | null
          remaining_to_disburse: number | null
          start_date: string | null
          total_accrued_interest: number | null
          total_amount: number | null
          total_disbursed: number | null
          tranches_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "loans_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_outlet_card: {
        Row: {
          address: string | null
          admin_cost_monthly: number | null
          bank_accounts_count: number | null
          bp_status: string | null
          city: string | null
          code: string | null
          company_id: string | null
          condo_marketing_monthly: number | null
          contracts_count: number | null
          contracts_monthly_total: number | null
          cost_categories_count: number | null
          deposit_amount: number | null
          employees_count: number | null
          employees_fte: number | null
          employees_monthly_cost: number | null
          is_active: boolean | null
          mall_name: string | null
          min_revenue_period: string | null
          min_revenue_target: number | null
          months_since_opening: number | null
          name: string | null
          opening_date: string | null
          outlet_id: string | null
          outlet_type: string | null
          primary_bank: string | null
          province: string | null
          rent_monthly: number | null
          setup_cost: number | null
          sqm: number | null
          staff_budget_monthly: number | null
          suppliers_count: number | null
          target_cogs_pct: number | null
          target_margin_pct: number | null
          target_revenue_steady: number | null
          target_revenue_year1: number | null
          target_revenue_year2: number | null
          total_monthly_cost_budget: number | null
        }
        Relationships: [
          {
            foreignKeyName: "outlets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_outlet_comparison: {
        Row: {
          cogs: number | null
          company_id: string | null
          contribution_margin: number | null
          contribution_margin_pct: number | null
          ebitda: number | null
          ebitda_margin_pct: number | null
          ebitda_per_sqm: number | null
          general_admin_costs: number | null
          location_costs: number | null
          month: number | null
          months_since_opening: number | null
          opening_date: string | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          rent_monthly: number | null
          rent_ratio: number | null
          revenue: number | null
          revenue_per_sqm: number | null
          sqm: number | null
          staff_cost_ratio: number | null
          staff_costs: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_outlet_ranking: {
        Row: {
          avg_margin_pct: number | null
          bp_achievement_pct: number | null
          bp_target: number | null
          company_id: string | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          rank_ebitda: number | null
          rank_efficiency: number | null
          rank_revenue: number | null
          revenue_per_sqm: number | null
          staff_cost_ratio: number | null
          year: number | null
          ytd_ebitda: number | null
          ytd_revenue: number | null
          ytd_staff_costs: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_payables_aging: {
        Row: {
          company_id: string | null
          invoices_count: number | null
          not_yet_due: number | null
          overdue_0_30: number | null
          overdue_30_60: number | null
          overdue_60_90: number | null
          overdue_90_plus: number | null
          supplier_name: string | null
          total_remaining: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_payables_operative: {
        Row: {
          amount_paid: number | null
          amount_remaining: number | null
          bank_transaction_id: string | null
          cash_movement_id: string | null
          closed_manually: boolean | null
          company_id: string | null
          cost_category_name: string | null
          days_to_due: number | null
          due_date: string | null
          gross_amount: number | null
          id: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_auto_debit: boolean | null
          last_action_by: string | null
          last_action_date: string | null
          last_action_note: string | null
          last_action_type: string | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"] | null
          manual_close_reason: string | null
          notes: string | null
          original_due_date: string | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          payment_bank_account_id: string | null
          payment_date: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          payment_movement_amount: number | null
          payment_movement_date: string | null
          payment_movement_description: string | null
          payment_planned_bank_name: string | null
          payment_real_bank_id: string | null
          payment_real_bank_name: string | null
          payment_source: string | null
          postpone_count: number | null
          postponed_to: string | null
          priority: number | null
          status: Database["public"]["Enums"]["payable_status"] | null
          supplier_category: string | null
          supplier_iban: string | null
          supplier_id: string | null
          supplier_name: string | null
          supplier_ragione_sociale: string | null
          supplier_vat: string | null
          suspend_date: string | null
          suspend_reason: string | null
          urgency: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey"
            columns: ["payment_real_bank_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "bank_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["bank_transaction_id"]
          },
          {
            foreignKeyName: "payables_bank_transaction_id_fkey"
            columns: ["bank_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_payables_schedule: {
        Row: {
          amount_paid: number | null
          amount_remaining: number | null
          company_id: string | null
          cost_category_name: string | null
          days_to_due: number | null
          due_bucket: string | null
          due_date: string | null
          gross_amount: number | null
          invoice_date: string | null
          invoice_number: string | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"] | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          payable_id: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
          status: Database["public"]["Enums"]["payable_status"] | null
          supplier_category: string | null
          supplier_name: string | null
          urgency: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payables_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "payables_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_payment_schedule: {
        Row: {
          account_code: string | null
          account_name: string | null
          amount: number | null
          bank_account_id: string | null
          bank_name: string | null
          bank_reference: string | null
          company_id: string | null
          cost_center: string | null
          created_at: string | null
          due_date: string | null
          id: string | null
          installment_number: number | null
          invoice_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_total: number | null
          note: string | null
          paid_amount: number | null
          paid_date: string | null
          payment_method: string | null
          status: string | null
          supplier_name: string | null
          supplier_piva: string | null
          updated_at: string | null
        }
        Relationships: []
      }
      v_personnel_gross_cost: {
        Row: {
          amministratori_totale: number | null
          company_id: string | null
          compensi_amm: number | null
          contr_azienda: number | null
          contr_ebinter: number | null
          contr_est: number | null
          contr_gestione_separata: number | null
          contr_inps: number | null
          costo_lordo_outlet: number | null
          created_at: string | null
          filiale_code: string | null
          id: string | null
          import_id: string | null
          inail_calcolato: number | null
          inail_incompleto: boolean | null
          inail_pat: Json | null
          month: number | null
          numero_dipendenti: number | null
          outlet_id: string | null
          outlet_label: string | null
          retribuzioni_lorde: number | null
          source_file: string | null
          tfr_fondo: number | null
          totale_retribuzioni: number | null
          updated_at: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "personnel_gross_cost_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "personnel_gross_cost_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "personnel_gross_cost_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_pnl_monthly: {
        Row: {
          closing_inventory: number | null
          cogs: number | null
          company_id: string | null
          contribution_margin: number | null
          contribution_margin_pct: number | null
          ebitda: number | null
          financial_costs: number | null
          general_admin_costs: number | null
          location_costs: number | null
          month: number | null
          net_result: number | null
          opening_inventory: number | null
          other_costs: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          period_date: string | null
          period_status: Database["public"]["Enums"]["period_status"] | null
          purchases: number | null
          returns_to_warehouse: number | null
          revenue: number | null
          staff_costs: number | null
          total_opex: number | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_profit_and_loss: {
        Row: {
          account_code: string | null
          account_name: string | null
          cost_center: string | null
          parent_account: string | null
          period_type: string | null
          sort_order: number | null
          total_amount: number | null
          year: number | null
        }
        Relationships: []
      }
      v_recent_imports: {
        Row: {
          bank_name: string | null
          company_id: string | null
          completed_at: string | null
          file_name: string | null
          id: string | null
          imported_at: string | null
          imported_by_name: string | null
          outlet_name: string | null
          period_from: string | null
          period_to: string | null
          rows_error: number | null
          rows_imported: number | null
          rows_skipped: number | null
          rows_total: number | null
          source: Database["public"]["Enums"]["import_source"] | null
          status: Database["public"]["Enums"]["import_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      v_recurring_costs: {
        Row: {
          annual_amount: number | null
          company_id: string | null
          contract_id: string | null
          contract_name: string | null
          contract_type: string | null
          cost_category_code: string | null
          cost_category_id: string | null
          cost_category_name: string | null
          counterpart: string | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"] | null
          monthly_amount: number | null
          monthly_expected: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "contracts_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_revenue_trend: {
        Row: {
          avg_ticket: number | null
          card_pct: number | null
          company_id: string | null
          month: number | null
          month_date: string | null
          monthly_card: number | null
          monthly_cash: number | null
          monthly_gross_revenue: number | null
          monthly_net_revenue: number | null
          monthly_transactions: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          year: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_revenue_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "daily_revenue_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_staff_analysis: {
        Row: {
          active_employees: number | null
          annual_cost_per_sqm: number | null
          avg_monthly_cost: number | null
          avg_tenure_months: number | null
          company_id: string | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          total_annual_cost: number | null
          total_fte: number | null
          total_monthly_cost: number | null
          total_weekly_hours: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "employees_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
      v_yoy_comparison: {
        Row: {
          company_id: string | null
          current_ebitda: number | null
          current_margin_pct: number | null
          current_revenue: number | null
          current_year: number | null
          ebitda_delta: number | null
          month: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          previous_ebitda: number | null
          previous_margin_pct: number | null
          previous_revenue: number | null
          previous_year: number | null
          revenue_delta: number | null
          revenue_growth_pct: number | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "monthly_actuals_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
        ]
      }
    }
    Functions: {
      _acube_cedente_name_json: {
        Args: { p_fallback: string; p_payload: Json }
        Returns: string
      }
      _acube_extract_cedente_name: {
        Args: { p_fallback: string; p_xml: string }
        Returns: string
      }
      _acube_marking_to_sdi_status: {
        Args: { p_marking: string }
        Returns: string
      }
      _acube_xml_imponibile_iva: {
        Args: { p_xml: string }
        Returns: {
          imponibile: number
          imposta: number
        }[]
      }
      _caller_company_id: { Args: never; Returns: string }
      _suppliers_slugify: { Args: { input: string }; Returns: string }
      acube_cf_sync_inbound_production: {
        Args: { p_origine?: string; p_since?: string; p_stage?: string }
        Returns: Json
      }
      acube_ob_sync_all_production: {
        Args: { p_since?: string }
        Returns: {
          accounts: number
          error: string
          fiscal_id: string
          transactions: number
        }[]
      }
      acube_sdi_sync_inbound_production: {
        Args: { p_origine?: string; p_stage?: string }
        Returns: Json
      }
      acube_sdi_sync_outbound_production: {
        Args: { p_origine?: string; p_stage?: string }
        Returns: Json
      }
      align_payable_categories: {
        Args: { p_company_id: string }
        Returns: number
      }
      append_ticket_comment: {
        Args: { p_commento: Json; p_ticket_id: string }
        Returns: {
          aggiornato_il: string
          allegati: Json
          autofix_attempts: number
          autofix_last_attempt_at: string | null
          autofix_last_request_id: number | null
          autore: string
          autore_id: string | null
          commenti: Json
          creato_il: string
          descrizione: string | null
          id: string
          last_seen_by_author_at: string | null
          modulo: string
          note_fix: string | null
          priorita: string
          resolution_branch: string | null
          resolution_pr_url: string | null
          risolto_il: string | null
          screenshot_url: string | null
          stato: string
          tipo: string
          titolo: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      apply_credit_note_links: {
        Args: { p_close_date?: string; p_payable_id: string }
        Returns: number
      }
      approve_budget_outlet_year: {
        Args: { p_cost_center: string; p_year: number }
        Returns: number
      }
      bank_transaction_canonical_hash: {
        Args: {
          p_account_id: string
          p_amount: number
          p_date: string
          p_description: string
        }
        Returns: string
      }
      bank_tx_canonical_hash_occ: {
        Args: {
          p_acct: string
          p_amount: number
          p_date: string
          p_descr: string
          p_occ: number
        }
        Returns: string
      }
      bytea_to_text: { Args: { data: string }; Returns: string }
      causale_has_named_beneficiary: {
        Args: { p_text: string }
        Returns: boolean
      }
      check_pixel_and_alert: { Args: never; Returns: string }
      close_non_supplier_movements: { Args: never; Returns: Json }
      close_paid_fiscal_deadlines: { Args: never; Returns: Json }
      close_payable_manually: {
        Args: {
          p_amount?: number
          p_close_date: string
          p_id: string
          p_operator?: string
          p_reason?: string
        }
        Returns: {
          amount_paid: number
          amount_remaining: number
          closed_manually: boolean
          id: string
          manual_close_reason: string
          payment_date: string
          status: string
        }[]
      }
      close_utility_movements: { Args: never; Returns: Json }
      compute_bank_tx_dedup_hash: {
        Args: {
          p_amount: number
          p_bank_account_id: string
          p_description: string
          p_transaction_date: string
        }
        Returns: string
      }
      fn_backfill_payable_installments: {
        Args: { p_company: string }
        Returns: Json
      }
      fn_consolidate_duplicate_bank_accounts: {
        Args: never
        Returns: {
          out_canonical_id: string
          out_company_id: string
          out_dups_merged: number
          out_iban: string
          out_movements_left_on_dup: number
          out_movements_repointed: number
          out_refs_repointed: number
        }[]
      }
      fn_normalize_invoice_number: { Args: { p_num: string }; Returns: string }
      fn_parse_invoice_payments: {
        Args: { p_xml: string }
        Returns: {
          amount: number
          due_date: string
          installment: number
          method: string
        }[]
      }
      fn_parse_invoice_payments_json: {
        Args: { p_payload: Json }
        Returns: {
          amount: number
          due_date: string
          installment: number
          method: string
        }[]
      }
      fn_payable_is_riba: { Args: { p_payable_id: string }; Returns: boolean }
      fn_payment_anomaly_texts: {
        Args: { p_type: string }
        Returns: {
          come_risolvere: string
          descrizione: string
        }[]
      }
      fn_riba_provisional_close: {
        Args: { p_company_id?: string; p_include_backlog?: boolean }
        Returns: number
      }
      fn_supplier_config_anomaly: {
        Args: { p_supplier_id: string }
        Returns: string
      }
      fn_supplier_installment_schedule: {
        Args: {
          p_base: string
          p_emissione: string
          p_gross: number
          p_n_rate: number
          p_prima_gg: number
        }
        Returns: {
          due_date: string
          importo: number
          rata: number
        }[]
      }
      get_acube_credentials: {
        Args: { p_stage: string }
        Returns: {
          email: string
          password: string
        }[]
      }
      get_anthropic_api_key: {
        Args: never
        Returns: {
          api_key: string
        }[]
      }
      get_autofix_cron_secret: {
        Args: never
        Returns: {
          secret: string
        }[]
      }
      get_github_token: {
        Args: never
        Returns: {
          token: string
        }[]
      }
      get_my_company_id: { Args: never; Returns: string }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_or_associate_tenant_company: { Args: never; Returns: string }
      get_sdi_credentials: {
        Args: never
        Returns: {
          client_cert: string
          client_key: string
          server_cert: string
          server_key: string
        }[]
      }
      get_unseen_ticket_updates_count: { Args: never; Returns: number }
      get_yapily_credentials: { Args: never; Returns: Json }
      has_jwt_role: { Args: { role_name: string }; Returns: boolean }
      has_outlet_access: { Args: { p_outlet_id: string }; Returns: boolean }
      has_outlet_write: { Args: { p_outlet_id: string }; Returns: boolean }
      http: {
        Args: { request: Database["public"]["CompositeTypes"]["http_request"] }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "http_request"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_delete:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_get:
        | {
            Args: { uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_head: {
        Args: { uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_header: {
        Args: { field: string; value: string }
        Returns: Database["public"]["CompositeTypes"]["http_header"]
        SetofOptions: {
          from: "*"
          to: "http_header"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_list_curlopt: {
        Args: never
        Returns: {
          curlopt: string
          value: string
        }[]
      }
      http_patch: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_post:
        | {
            Args: { content: string; content_type: string; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: { data: Json; uri: string }
            Returns: Database["public"]["CompositeTypes"]["http_response"]
            SetofOptions: {
              from: "*"
              to: "http_response"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      http_put: {
        Args: { content: string; content_type: string; uri: string }
        Returns: Database["public"]["CompositeTypes"]["http_response"]
        SetofOptions: {
          from: "*"
          to: "http_response"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      http_reset_curlopt: { Args: never; Returns: boolean }
      http_set_curlopt: {
        Args: { curlopt: string; value: string }
        Returns: boolean
      }
      init_default_cost_categories: {
        Args: { p_company_id: string }
        Returns: undefined
      }
      invoice_cited_in_text: {
        Args: { p_descr: string; p_inv: string; p_min_len: number }
        Returns: boolean
      }
      invoice_number_keys: { Args: { p_inv: string }; Returns: string[] }
      jwt_company_id: { Args: never; Returns: string }
      log_bank_sync_run: {
        Args: { p_details?: Json; p_duration_ms?: number; p_items?: number }
        Returns: undefined
      }
      mark_ticket_seen: { Args: { p_ticket_id: string }; Returns: undefined }
      notify_invoices_without_xml: { Args: never; Returns: number }
      onboard_tenant: {
        Args: {
          p_chart_template?: string
          p_company: Json
          p_outlets: Json
          p_point_of_sale_label?: string
          p_suppliers?: Json
        }
        Returns: string
      }
      reconcile_movement: {
        Args: { p_bt_id: string; p_log_id?: string; p_payable_id: string }
        Returns: Json
      }
      reconcile_movement_group: {
        Args: { p_bt_id: string; p_payable_ids: string[] }
        Returns: Json
      }
      refresh_budget_consuntivo: {
        Args: { p_outlet_id?: string; p_year?: number }
        Returns: Json
      }
      reopen_payable: {
        Args: { p_id: string; p_operator?: string; p_reason?: string }
        Returns: {
          amount_paid: number
          amount_remaining: number
          bank_transaction_id: string
          closed_manually: boolean
          id: string
          payment_date: string
          reopened: boolean
          reopened_credit_notes: number
          status: string
          undone_reconciliations: number
        }[]
      }
      rerun_amount_reconciliation: { Args: never; Returns: Json }
      rerun_bijective_reconciliation: { Args: never; Returns: Json }
      rerun_group_reconciliation: { Args: never; Returns: Json }
      rerun_reconciliation: { Args: never; Returns: Json }
      rerun_riba_provisional_close: { Args: never; Returns: Json }
      rpc_apply_all_payment_proposals: { Args: never; Returns: number }
      rpc_apply_payment_proposal: { Args: { p_id: string }; Returns: boolean }
      rpc_automatch_riba_distinta: {
        Args: { p_distinta_id: string }
        Returns: Json
      }
      rpc_confirm_riba_distinta: {
        Args: { p_distinta_id: string }
        Returns: Json
      }
      rpc_confirm_riba_distinta_line: {
        Args: { p_line_id: string; p_payable_ids: string[] }
        Returns: Json
      }
      rpc_detect_notula_duplicates: {
        Args: { p_company: string }
        Returns: {
          acube_amount: number
          acube_date: string
          acube_id: string
          acube_number: string
          acube_status: string
          ambiguo: boolean
          manual_amount: number
          manual_date: string
          manual_id: string
          manual_number: string
          manual_status: string
          match_reason: string
          supplier_name: string
        }[]
      }
      rpc_discard_payment_proposal: { Args: { p_id: string }; Returns: boolean }
      rpc_link_riba_credit_note: {
        Args: { p_credit_note_id: string; p_target_payable_id: string }
        Returns: Json
      }
      rpc_merge_manual_notula: {
        Args: { p_acube_id: string; p_company: string; p_manual_id: string }
        Returns: Json
      }
      rpc_refresh_payment_anomalies: { Args: never; Returns: number }
      rpc_resolve_payment_anomaly: { Args: { p_id: string }; Returns: boolean }
      rpc_riba_provisional_close_backlog: { Args: never; Returns: Json }
      rpc_riba_provisional_undo: {
        Args: { p_payable_id: string }
        Returns: Json
      }
      rpc_unlink_riba_credit_note: {
        Args: { p_credit_note_id: string }
        Returns: Json
      }
      run_daily_reconciliation: { Args: never; Returns: Json }
      save_balance_sheet: {
        Args: { p_records: Json; p_replace_sections?: string[] }
        Returns: Json
      }
      save_budget_confronto_cell: {
        Args: {
          p_account_code: string
          p_amount: number
          p_cost_center: string
          p_entry_type: string
          p_month: number
          p_stato?: string
          p_year: number
        }
        Returns: Json
      }
      supplier_confirmed_in_text: {
        Args: { p_name: string; p_text: string; p_vat: string }
        Returns: boolean
      }
      supplier_confirmed_in_text_strict: {
        Args: { p_name: string; p_text: string; p_vat: string }
        Returns: boolean
      }
      text_to_bytea: { Args: { data: string }; Returns: string }
      ticket_autofix_run: {
        Args: {
          p_anon_key: string
          p_function_url: string
          p_max_tickets?: number
        }
        Returns: number
      }
      try_match_amount_bank_transaction: {
        Args: { p_bt_id: string }
        Returns: Json
      }
      try_match_bank_transaction: { Args: { p_bt_id: string }; Returns: Json }
      try_match_group_bank_transaction: {
        Args: { p_bt_id: string }
        Returns: Json
      }
      try_match_group_numbers_bank_transaction: {
        Args: { p_bt_id: string }
        Returns: Json
      }
      undo_reconcile_movement: { Args: { p_log_id: string }; Returns: Json }
      unlock_budget_outlet_year: {
        Args: { p_cost_center: string; p_reason: string; p_year: number }
        Returns: number
      }
      urlencode:
        | { Args: { data: Json }; Returns: string }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { string: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.urlencode(string => bytea), public.urlencode(string => varchar). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
    }
    Enums: {
      contract_status: "attivo" | "in_scadenza" | "scaduto" | "disdettato"
      contract_type: "indeterminato" | "determinato"
      cost_macro_group:
        | "costo_venduto"
        | "locazione"
        | "personale"
        | "generali_amministrative"
        | "finanziarie"
        | "oneri_diversi"
      import_source:
        | "csv_banca"
        | "csv_ade"
        | "csv_pos"
        | "api_pos"
        | "api_ade"
        | "manuale"
        | "csv_fatture"
        | "xml_sdi"
        | "pdf_bilancio"
        | "csv_cedolini"
        | "api_yapily"
        | "api_acube_ob"
        | "api_acube_sdi"
      import_status: "pending" | "processing" | "completed" | "error"
      payable_status:
        | "da_pagare"
        | "in_scadenza"
        | "scaduto"
        | "pagato"
        | "parziale"
        | "sospeso"
        | "rimandato"
        | "annullato"
        | "bloccato"
        | "nota_credito"
      payment_method:
        | "bonifico_ordinario"
        | "bonifico_urgente"
        | "bonifico_sepa"
        | "riba_30"
        | "riba_60"
        | "riba_90"
        | "riba_120"
        | "rid"
        | "sdd_core"
        | "sdd_b2b"
        | "rimessa_diretta"
        | "carta_credito"
        | "carta_debito"
        | "assegno"
        | "contanti"
        | "compensazione"
        | "f24"
        | "mav"
        | "rav"
        | "bollettino_postale"
        | "altro"
      period_status: "aperto" | "in_chiusura" | "chiuso"
      sync_feed:
        | "banche"
        | "fatture_passive"
        | "corrispettivi"
        | "cassetto_fiscale"
        | "fatture_attive"
      sync_origin: "auto_cron" | "manuale"
      sync_status: "ok" | "parziale" | "errore" | "vuoto"
      transaction_type: "entrata" | "uscita"
      user_role:
        | "super_advisor"
        | "cfo"
        | "coo"
        | "ceo"
        | "contabile"
        | "budget_approver"
        | "viewer"
    }
    CompositeTypes: {
      http_header: {
        field: string | null
        value: string | null
      }
      http_request: {
        method: unknown
        uri: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content_type: string | null
        content: string | null
      }
      http_response: {
        status: number | null
        content_type: string | null
        headers: Database["public"]["CompositeTypes"]["http_header"][] | null
        content: string | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      contract_status: ["attivo", "in_scadenza", "scaduto", "disdettato"],
      contract_type: ["indeterminato", "determinato"],
      cost_macro_group: [
        "costo_venduto",
        "locazione",
        "personale",
        "generali_amministrative",
        "finanziarie",
        "oneri_diversi",
      ],
      import_source: [
        "csv_banca",
        "csv_ade",
        "csv_pos",
        "api_pos",
        "api_ade",
        "manuale",
        "csv_fatture",
        "xml_sdi",
        "pdf_bilancio",
        "csv_cedolini",
        "api_yapily",
        "api_acube_ob",
        "api_acube_sdi",
      ],
      import_status: ["pending", "processing", "completed", "error"],
      payable_status: [
        "da_pagare",
        "in_scadenza",
        "scaduto",
        "pagato",
        "parziale",
        "sospeso",
        "rimandato",
        "annullato",
        "bloccato",
        "nota_credito",
      ],
      payment_method: [
        "bonifico_ordinario",
        "bonifico_urgente",
        "bonifico_sepa",
        "riba_30",
        "riba_60",
        "riba_90",
        "riba_120",
        "rid",
        "sdd_core",
        "sdd_b2b",
        "rimessa_diretta",
        "carta_credito",
        "carta_debito",
        "assegno",
        "contanti",
        "compensazione",
        "f24",
        "mav",
        "rav",
        "bollettino_postale",
        "altro",
      ],
      period_status: ["aperto", "in_chiusura", "chiuso"],
      sync_feed: [
        "banche",
        "fatture_passive",
        "corrispettivi",
        "cassetto_fiscale",
        "fatture_attive",
      ],
      sync_origin: ["auto_cron", "manuale"],
      sync_status: ["ok", "parziale", "errore", "vuoto"],
      transaction_type: ["entrata", "uscita"],
      user_role: [
        "super_advisor",
        "cfo",
        "coo",
        "ceo",
        "contabile",
        "budget_approver",
        "viewer",
      ],
    },
  },
} as const
