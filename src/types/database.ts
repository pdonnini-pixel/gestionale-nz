npm warn exec The following package was not found and will be installed: supabase@2.97.0
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
      _deploy_temp: {
        Row: {
          chunk_order: number | null
          content: string | null
          created_at: string | null
          id: number
        }
        Insert: {
          chunk_order?: number | null
          content?: string | null
          created_at?: string | null
          id?: number
        }
        Update: {
          chunk_order?: number | null
          content?: string | null
          created_at?: string | null
          id?: number
        }
        Relationships: []
      }
      _yapily_diagnostic: {
        Row: {
          created_at: string | null
          id: string
          result: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          result?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: string
          result?: Json | null
        }
        Relationships: []
      }
      active_invoices: {
        Row: {
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
          updated_at: string | null
          yapily_environment: string | null
        }
        Insert: {
          company_id: string
          created_at?: string | null
          id?: string
          updated_at?: string | null
          yapily_environment?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string | null
          id?: string
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
          {
            foreignKeyName: "bank_balances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_balances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_balances_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
          bank_account_id: string
          closing_balance: number | null
          company_id: string
          created_at: string | null
          error_message: string | null
          file_type: string
          file_url: string | null
          filename: string
          id: string
          opening_balance: number | null
          period_from: string | null
          period_to: string | null
          status: string | null
          transaction_count: number | null
          uploaded_by: string | null
        }
        Insert: {
          bank_account_id: string
          closing_balance?: number | null
          company_id: string
          created_at?: string | null
          error_message?: string | null
          file_type: string
          file_url?: string | null
          filename: string
          id?: string
          opening_balance?: number | null
          period_from?: string | null
          period_to?: string | null
          status?: string | null
          transaction_count?: number | null
          uploaded_by?: string | null
        }
        Update: {
          bank_account_id?: string
          closing_balance?: number | null
          company_id?: string
          created_at?: string | null
          error_message?: string | null
          file_type?: string
          file_url?: string | null
          filename?: string
          id?: string
          opening_balance?: number | null
          period_from?: string | null
          period_to?: string | null
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
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "bank_statements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
          transaction_date: string
          transaction_type: string | null
          value_date: string | null
          yapily_transaction_id: string | null
        }
        Insert: {
          account_id?: string | null
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
          transaction_date: string
          transaction_type?: string | null
          value_date?: string | null
          yapily_transaction_id?: string | null
        }
        Update: {
          account_id?: string | null
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
          transaction_date?: string
          transaction_type?: string | null
          value_date?: string | null
          yapily_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "yapily_accounts"
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
          approved_at: string | null
          approved_by: string | null
          budget_amount: number | null
          company_id: string
          cost_center: string
          created_at: string | null
          id: string
          is_approved: boolean | null
          macro_group: string
          month: number
          note: string | null
          updated_at: string | null
          year: number
        }
        Insert: {
          account_code: string
          account_name: string
          actual_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string
          cost_center?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          macro_group: string
          month: number
          note?: string | null
          updated_at?: string | null
          year: number
        }
        Update: {
          account_code?: string
          account_name?: string
          actual_amount?: number | null
          approved_at?: string | null
          approved_by?: string | null
          budget_amount?: number | null
          company_id?: string
          cost_center?: string
          created_at?: string | null
          id?: string
          is_approved?: boolean | null
          macro_group?: string
          month?: number
          note?: string | null
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
      cash_movements: {
        Row: {
          ai_categorized_at: string | null
          ai_category_id: string | null
          ai_confidence: number | null
          ai_method: string | null
          amount: number
          balance_after: number | null
          bank_account_id: string | null
          company_id: string
          cost_category_id: string | null
          counterpart: string | null
          created_at: string | null
          date: string
          description: string | null
          id: string
          import_batch_id: string | null
          is_reconciled: boolean | null
          notes: string | null
          outlet_id: string | null
          reconciled_at: string | null
          reconciled_by: string | null
          reconciled_with: string | null
          source: Database["public"]["Enums"]["import_source"] | null
          type: Database["public"]["Enums"]["transaction_type"]
          value_date: string | null
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
          yapily_transaction_id: string | null
        }
        Insert: {
          ai_categorized_at?: string | null
          ai_category_id?: string | null
          ai_confidence?: number | null
          ai_method?: string | null
          amount: number
          balance_after?: number | null
          bank_account_id?: string | null
          company_id: string
          cost_category_id?: string | null
          counterpart?: string | null
          created_at?: string | null
          date: string
          description?: string | null
          id?: string
          import_batch_id?: string | null
          is_reconciled?: boolean | null
          notes?: string | null
          outlet_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciled_with?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          type: Database["public"]["Enums"]["transaction_type"]
          value_date?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
          yapily_transaction_id?: string | null
        }
        Update: {
          ai_categorized_at?: string | null
          ai_category_id?: string | null
          ai_confidence?: number | null
          ai_method?: string | null
          amount?: number
          balance_after?: number | null
          bank_account_id?: string | null
          company_id?: string
          cost_category_id?: string | null
          counterpart?: string | null
          created_at?: string | null
          date?: string
          description?: string | null
          id?: string
          import_batch_id?: string | null
          is_reconciled?: boolean | null
          notes?: string | null
          outlet_id?: string | null
          reconciled_at?: string | null
          reconciled_by?: string | null
          reconciled_with?: string | null
          source?: Database["public"]["Enums"]["import_source"] | null
          type?: Database["public"]["Enums"]["transaction_type"]
          value_date?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
          yapily_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_movements_ai_category_id_fkey"
            columns: ["ai_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_ai_category_id_fkey"
            columns: ["ai_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "cash_movements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "cash_movements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "cash_movements_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "cash_movements_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "cost_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_cost_category_id_fkey"
            columns: ["cost_category_id"]
            isOneToOne: false
            referencedRelation: "v_recurring_costs"
            referencedColumns: ["cost_category_id"]
          },
          {
            foreignKeyName: "cash_movements_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "outlets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_bp_vs_actual_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "cash_movements_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_business_plan_outlet"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "cash_movements_outlet_id_fkey"
            columns: ["outlet_id"]
            isOneToOne: false
            referencedRelation: "v_outlet_card"
            referencedColumns: ["outlet_id"]
          },
          {
            foreignKeyName: "cash_movements_reconciled_by_fkey"
            columns: ["reconciled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_movements_yapily_transaction_id_fkey"
            columns: ["yapily_transaction_id"]
            isOneToOne: false
            referencedRelation: "yapily_transactions"
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
          code: string
          company_id: string
          created_at: string | null
          default_centers: string[] | null
          id: string
          is_active: boolean | null
          is_fixed: boolean | null
          is_recurring: boolean | null
          macro_group: string
          name: string
          note: string | null
          parent_id: string | null
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          annual_amount?: number | null
          code: string
          company_id?: string
          created_at?: string | null
          default_centers?: string[] | null
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          macro_group: string
          name: string
          note?: string | null
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          annual_amount?: number | null
          code?: string
          company_id?: string
          created_at?: string | null
          default_centers?: string[] | null
          id?: string
          is_active?: boolean | null
          is_fixed?: boolean | null
          is_recurring?: boolean | null
          macro_group?: string
          name?: string
          note?: string | null
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
          sede_legale: string | null
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
          sede_legale?: string | null
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
          sede_legale?: string | null
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
    