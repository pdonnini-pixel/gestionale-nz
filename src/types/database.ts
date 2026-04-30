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
            foreignKeyName: "electronic_invoices_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "electronic_invoices_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
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
          net_monthly_salary: number | null
          nome: string | null
          note: string | null
          notes: string | null
          ore_settimanali: number | null
          outlet_id: string | null
          role_description: string | null
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
          net_monthly_salary?: number | null
          nome?: string | null
          note?: string | null
          notes?: string | null
          ore_settimanali?: number | null
          outlet_id?: string | null
          role_description?: string | null
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
          net_monthly_salary?: number | null
          nome?: string | null
          note?: string | null
          notes?: string | null
          ore_settimanali?: number | null
          outlet_id?: string | null
          role_description?: string | null
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
      fiscal_deadlines: {
        Row: {
          amount: number | null
          amount_paid: number | null
          company_id: string
          created_at: string | null
          created_by: string | null
          deadline_type: string
          description: string | null
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
            foreignKeyName: "import_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "import_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "import_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
            foreignKeyName: "manual_balance_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "manual_balance_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "manual_balance_entries_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
            foreignKeyName: "outlet_bank_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "outlet_bank_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
          created_at: string | null
          delivery_date: string | null
          deposit_amount: number | null
          deposit_guarantee: number | null
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
          created_at?: string | null
          delivery_date?: string | null
          deposit_amount?: number | null
          deposit_guarantee?: number | null
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
          created_at?: string | null
          delivery_date?: string | null
          deposit_amount?: number | null
          deposit_guarantee?: number | null
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
            foreignKeyName: "payable_actions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payable_actions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payable_actions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
      payables: {
        Row: {
          amount_paid: number | null
          amount_remaining: number | null
          cash_movement_id: string | null
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
          amount_paid?: number | null
          amount_remaining?: number | null
          cash_movement_id?: string | null
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
          amount_paid?: number | null
          amount_remaining?: number | null
          cash_movement_id?: string | null
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
            foreignKeyName: "payables_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payables_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
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
            foreignKeyName: "payables_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payables_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payables_payment_bank_account_id_fkey"
            columns: ["payment_bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
            foreignKeyName: "payment_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payment_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payment_batches_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
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
      payment_records: {
        Row: {
          amount: number
          bank_account_id: string | null
          cash_movement_id: string | null
          created_at: string | null
          id: string
          notes: string | null
          payable_id: string
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"] | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          cash_movement_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payable_id: string
          payment_date: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          cash_movement_id?: string | null
          created_at?: string | null
          id?: string
          notes?: string | null
          payable_id?: string
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"] | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payment_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payment_records_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "payment_records_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_records_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
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
          cash_movement_id: string | null
          company_id: string
          confidence: number | null
          created_at: string | null
          id: string
          match_details: Json | null
          match_type: string
          new_payable_status: string | null
          notes: string | null
          payable_id: string | null
          performed_at: string | null
          performed_by: string | null
          previous_payable_status: string | null
        }
        Insert: {
          cash_movement_id?: string | null
          company_id: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          match_details?: Json | null
          match_type: string
          new_payable_status?: string | null
          notes?: string | null
          payable_id?: string | null
          performed_at?: string | null
          performed_by?: string | null
          previous_payable_status?: string | null
        }
        Update: {
          cash_movement_id?: string | null
          company_id?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          match_details?: Json | null
          match_type?: string
          new_payable_status?: string | null
          notes?: string | null
          payable_id?: string | null
          performed_at?: string | null
          performed_by?: string | null
          previous_payable_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_log_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
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
      reconciliation_rejected_pairs: {
        Row: {
          cash_movement_id: string
          company_id: string
          id: string
          payable_id: string
          rejected_at: string | null
          rejected_by: string | null
        }
        Insert: {
          cash_movement_id: string
          company_id: string
          id?: string
          payable_id: string
          rejected_at?: string | null
          rejected_by?: string | null
        }
        Update: {
          cash_movement_id?: string
          company_id?: string
          id?: string
          payable_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_rejected_pairs_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rejected_pairs_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rejected_pairs_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rejected_pairs_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rejected_pairs_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_rejected_pairs_payable_id_fkey"
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
          name: string
          nazione: string | null
          note: string | null
          notes: string | null
          paese: string | null
          partita_iva: string | null
          payment_method: string | null
          payment_terms: number | null
          pec: string | null
          provincia: string | null
          ragione_sociale: string | null
          regime_fiscale: string | null
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
          name: string
          nazione?: string | null
          note?: string | null
          notes?: string | null
          paese?: string | null
          partita_iva?: string | null
          payment_method?: string | null
          payment_terms?: number | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string | null
          regime_fiscale?: string | null
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
          name?: string
          nazione?: string | null
          note?: string | null
          notes?: string | null
          paese?: string | null
          partita_iva?: string | null
          payment_method?: string | null
          payment_terms?: number | null
          pec?: string | null
          provincia?: string | null
          ragione_sociale?: string | null
          regime_fiscale?: string | null
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
        ]
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
      yapily_accounts: {
        Row: {
          account_name: string | null
          account_type: string | null
          balance: number | null
          balance_updated_at: string | null
          bank_account_id: string | null
          company_id: string
          consent_id: string
          created_at: string | null
          currency: string | null
          iban: string | null
          id: string
          institution_id: string
          is_active: boolean | null
          last_synced_at: string | null
          yapily_account_id: string
        }
        Insert: {
          account_name?: string | null
          account_type?: string | null
          balance?: number | null
          balance_updated_at?: string | null
          bank_account_id?: string | null
          company_id: string
          consent_id: string
          created_at?: string | null
          currency?: string | null
          iban?: string | null
          id?: string
          institution_id: string
          is_active?: boolean | null
          last_synced_at?: string | null
          yapily_account_id: string
        }
        Update: {
          account_name?: string | null
          account_type?: string | null
          balance?: number | null
          balance_updated_at?: string | null
          bank_account_id?: string | null
          company_id?: string
          consent_id?: string
          created_at?: string | null
          currency?: string | null
          iban?: string | null
          id?: string
          institution_id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          yapily_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "yapily_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "bank_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_bank_accounts_detail"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "yapily_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_cash_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "yapily_accounts_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_treasury_position"
            referencedColumns: ["bank_account_id"]
          },
          {
            foreignKeyName: "yapily_accounts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_accounts_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "yapily_consents"
            referencedColumns: ["id"]
          },
        ]
      }
      yapily_consents: {
        Row: {
          company_id: string
          consent_token: string
          consent_type: string
          created_at: string | null
          expires_at: string | null
          id: string
          institution_id: string
          institution_name: string
          max_historical_days: number | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          company_id: string
          consent_token: string
          consent_type: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          institution_id: string
          institution_name: string
          max_historical_days?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          company_id?: string
          consent_token?: string
          consent_type?: string
          created_at?: string | null
          expires_at?: string | null
          id?: string
          institution_id?: string
          institution_name?: string
          max_historical_days?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yapily_consents_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      yapily_payments: {
        Row: {
          amount: number
          company_id: string
          completed_at: string | null
          consent_id: string | null
          creditor_iban: string
          creditor_name: string
          currency: string | null
          error_details: Json | null
          id: string
          idempotency_key: string | null
          initiated_at: string | null
          payable_id: string | null
          payment_type: string | null
          reference: string | null
          status: string | null
          yapily_payment_id: string | null
        }
        Insert: {
          amount: number
          company_id: string
          completed_at?: string | null
          consent_id?: string | null
          creditor_iban: string
          creditor_name: string
          currency?: string | null
          error_details?: Json | null
          id?: string
          idempotency_key?: string | null
          initiated_at?: string | null
          payable_id?: string | null
          payment_type?: string | null
          reference?: string | null
          status?: string | null
          yapily_payment_id?: string | null
        }
        Update: {
          amount?: number
          company_id?: string
          completed_at?: string | null
          consent_id?: string | null
          creditor_iban?: string
          creditor_name?: string
          currency?: string | null
          error_details?: Json | null
          id?: string
          idempotency_key?: string | null
          initiated_at?: string | null
          payable_id?: string | null
          payment_type?: string | null
          reference?: string | null
          status?: string | null
          yapily_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "yapily_payments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_payments_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "yapily_consents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_operative"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "v_payables_schedule"
            referencedColumns: ["payable_id"]
          },
        ]
      }
      yapily_transactions: {
        Row: {
          amount: number
          balance_after: number | null
          booking_date: string | null
          cash_movement_id: string | null
          category: string | null
          company_id: string
          created_at: string | null
          currency: string | null
          date: string
          description: string | null
          id: string
          merchant_name: string | null
          raw_data: Json | null
          reconciled: boolean | null
          reference: string | null
          status: string | null
          transaction_id: string
          yapily_account_id: string
        }
        Insert: {
          amount: number
          balance_after?: number | null
          booking_date?: string | null
          cash_movement_id?: string | null
          category?: string | null
          company_id: string
          created_at?: string | null
          currency?: string | null
          date: string
          description?: string | null
          id?: string
          merchant_name?: string | null
          raw_data?: Json | null
          reconciled?: boolean | null
          reference?: string | null
          status?: string | null
          transaction_id: string
          yapily_account_id: string
        }
        Update: {
          amount?: number
          balance_after?: number | null
          booking_date?: string | null
          cash_movement_id?: string | null
          category?: string | null
          company_id?: string
          created_at?: string | null
          currency?: string | null
          date?: string
          description?: string | null
          id?: string
          merchant_name?: string | null
          raw_data?: Json | null
          reconciled?: boolean | null
          reference?: string | null
          status?: string | null
          transaction_id?: string
          yapily_account_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "yapily_transactions_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "cash_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_transactions_cash_movement_id_fkey"
            columns: ["cash_movement_id"]
            isOneToOne: false
            referencedRelation: "v_unreconciled_movements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_transactions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "yapily_transactions_yapily_account_id_fkey"
            columns: ["yapily_account_id"]
            isOneToOne: false
            referencedRelation: "yapily_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_bank_accounts_detail: {
        Row: {
          account_name: string | null
          account_type: string | null
          balance_accounting: number | null
          balance_available: number | null
          bank_account_id: string | null
          bank_name: string | null
          company_id: string | null
          credit_line: number | null
          delta_30d: number | null
          iban: string | null
          last_balance_date: string | null
          month_inflows: number | null
          month_movements: number | null
          month_outflows: number | null
          net_available_30d: number | null
          outlet_id: string | null
          outlet_name: string | null
          payables_30d: number | null
          payables_60d: number | null
          payables_7d: number | null
          total_available: number | null
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
      v_bank_totals: {
        Row: {
          accounts_count: number | null
          company_id: string | null
          total_available: number | null
          total_balance: number | null
          total_credit_lines: number | null
          total_month_inflows: number | null
          total_month_outflows: number | null
          total_net_available_30d: number | null
          total_payables_30d: number | null
          total_payables_60d: number | null
          total_payables_7d: number | null
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
      v_cash_forecast: {
        Row: {
          company_id: string | null
          expected_inflows: number | null
          liquidity_signal: string | null
          projected_balance: number | null
          scheduled_outflows: number | null
          total_credit_line: number | null
          total_current_balance: number | null
          week_end: string | null
          week_num: number | null
          week_start: string | null
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
      v_cash_position: {
        Row: {
          bank_account_id: string | null
          bank_name: string | null
          company_id: string | null
          current_balance: number | null
          iban: string | null
          last_movement_date: string | null
          month_inflows: number | null
          month_movements_count: number | null
          month_net_flow: number | null
          month_outflows: number | null
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
      v_closing_status: {
        Row: {
          ade_receipts_days: number | null
          company_id: string | null
          completeness_score: number | null
          cost_lines_entered: number | null
          days_in_month: number | null
          has_revenue: boolean | null
          month: number | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          period_status: Database["public"]["Enums"]["period_status"] | null
          revenue: number | null
          total_costs_entered: number | null
          unreconciled_amount: number | null
          unreconciled_movements: number | null
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
          company_id: string | null
          cost_category_name: string | null
          days_to_due: number | null
          due_date: string | null
          gross_amount: number | null
          id: string | null
          invoice_date: string | null
          invoice_number: string | null
          last_action_by: string | null
          last_action_date: string | null
          last_action_note: string | null
          last_action_type: string | null
          macro_group: Database["public"]["Enums"]["cost_macro_group"] | null
          original_due_date: string | null
          outlet_code: string | null
          outlet_id: string | null
          outlet_name: string | null
          payment_method: Database["public"]["Enums"]["payment_method"] | null
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
      v_treasury_position: {
        Row: {
          account_type: string | null
          available_balance: number | null
          balance_change_30d: number | null
          bank_account_id: string | null
          bank_name: string | null
          company_id: string | null
          credit_line: number | null
          current_balance: number | null
          iban: string | null
          inflows_30d: number | null
          last_balance_date: string | null
          net_30d: number | null
          outflows_30d: number | null
          outlet_id: string | null
          outlet_name: string | null
          total_available: number | null
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
      v_unreconciled_movements: {
        Row: {
          amount: number | null
          balance_after: number | null
          bank_name: string | null
          company_id: string | null
          cost_category_id: string | null
          counterpart: string | null
          date: string | null
          days_pending: number | null
          description: string | null
          iban: string | null
          id: string | null
          outlet_id: string | null
          outlet_name: string | null
          source: Database["public"]["Enums"]["import_source"] | null
          suggested_category_id: string | null
          type: Database["public"]["Enums"]["transaction_type"] | null
          value_date: string | null
        }
        Relationships: [
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
      align_payable_categories: {
        Args: { p_company_id: string }
        Returns: number
      }
      bytea_to_text: { Args: { data: string }; Returns: string }
      get_my_company_id: { Args: never; Returns: string }
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_sdi_credentials: {
        Args: never
        Returns: {
          client_cert: string
          client_key: string
          server_cert: string
          server_key: string
        }[]
      }
      get_yapily_credentials: { Args: never; Returns: Json }
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
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      text_to_bytea: { Args: { data: string }; Returns: string }
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
      transaction_type: "entrata" | "uscita"
      user_role: "super_advisor" | "cfo" | "coo" | "ceo" | "contabile"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      transaction_type: ["entrata", "uscita"],
      user_role: ["super_advisor", "cfo", "coo", "ceo", "contabile"],
    },
  },
} as const
