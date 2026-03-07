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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_usage_log: {
        Row: {
          created_at: string | null
          firm_id: string | null
          id: string
          request_type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          request_type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          request_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_engagements: {
        Row: {
          caro_applicable: boolean | null
          caro_responses: Json | null
          client_id: string | null
          financial_year: string | null
          firm_id: string | null
          form_3cd: Json | null
          id: string
          notes_to_accounts: Json | null
          risk_assessment: Json | null
          status: string | null
        }
        Insert: {
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          client_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          id?: string
          notes_to_accounts?: Json | null
          risk_assessment?: Json | null
          status?: string | null
        }
        Update: {
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          client_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          id?: string
          notes_to_accounts?: Json | null
          risk_assessment?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_engagements_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_workpapers: {
        Row: {
          conclusion: string | null
          engagement_id: string | null
          id: string
          objective: string | null
          procedure: string | null
          section: string | null
          signed_by: string | null
          wp_ref: string | null
        }
        Insert: {
          conclusion?: string | null
          engagement_id?: string | null
          id?: string
          objective?: string | null
          procedure?: string | null
          section?: string | null
          signed_by?: string | null
          wp_ref?: string | null
        }
        Update: {
          conclusion?: string | null
          engagement_id?: string | null
          id?: string
          objective?: string | null
          procedure?: string | null
          section?: string | null
          signed_by?: string | null
          wp_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_workpapers_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_reconciliations: {
        Row: {
          bank_account: string | null
          book_balance: number | null
          client_id: string | null
          difference: number | null
          id: string
          reconciliation_date: string | null
          statement_balance: number | null
        }
        Insert: {
          bank_account?: string | null
          book_balance?: number | null
          client_id?: string | null
          difference?: number | null
          id?: string
          reconciliation_date?: string | null
          statement_balance?: number | null
        }
        Update: {
          bank_account?: string | null
          book_balance?: number | null
          client_id?: string | null
          difference?: number | null
          id?: string
          reconciliation_date?: string | null
          statement_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_reconciliations_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_profiles: {
        Row: {
          audit_questions: Json | null
          banking_data: Json | null
          client_id: string | null
          id: string
          loan_data: Json | null
        }
        Insert: {
          audit_questions?: Json | null
          banking_data?: Json | null
          client_id?: string | null
          id?: string
          loan_data?: Json | null
        }
        Update: {
          audit_questions?: Json | null
          banking_data?: Json | null
          client_id?: string | null
          id?: string
          loan_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "client_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          cin: string | null
          compliance_flags: Json | null
          created_at: string | null
          entity_type: string | null
          firm_id: string | null
          gstin: string[] | null
          id: string
          name: string | null
          pan: string | null
          user_id: string | null
        }
        Insert: {
          cin?: string | null
          compliance_flags?: Json | null
          created_at?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          id?: string
          name?: string | null
          pan?: string | null
          user_id?: string | null
        }
        Update: {
          cin?: string | null
          compliance_flags?: Json | null
          created_at?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          id?: string
          name?: string | null
          pan?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      coa_mappings: {
        Row: {
          account_group: string | null
          bs_pl: string | null
          firm_id: string | null
          id: string
          raw_ledger_name: string | null
          standard_head: string | null
        }
        Insert: {
          account_group?: string | null
          bs_pl?: string | null
          firm_id?: string | null
          id?: string
          raw_ledger_name?: string | null
          standard_head?: string | null
        }
        Update: {
          account_group?: string | null
          bs_pl?: string | null
          firm_id?: string | null
          id?: string
          raw_ledger_name?: string | null
          standard_head?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coa_mappings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      deductees: {
        Row: {
          created_at: string | null
          firm_id: string | null
          id: string
          pan: string | null
          pan_valid: boolean | null
          party_name: string
        }
        Insert: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          pan?: string | null
          pan_valid?: boolean | null
          party_name: string
        }
        Update: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          pan?: string | null
          pan_valid?: boolean | null
          party_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "deductees_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          category: string | null
          client_id: string | null
          extracted_text: string | null
          filename: string | null
          firm_id: string | null
          id: string
          r2_key: string | null
          tags: string[] | null
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          extracted_text?: string | null
          filename?: string | null
          firm_id?: string | null
          id?: string
          r2_key?: string | null
          tags?: string[] | null
        }
        Update: {
          category?: string | null
          client_id?: string | null
          extracted_text?: string | null
          filename?: string | null
          firm_id?: string | null
          id?: string
          r2_key?: string | null
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string | null
          description: string | null
          firm_id: string | null
          id: string
          subject: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          firm_id?: string | null
          id?: string
          subject?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          firm_id?: string | null
          id?: string
          subject?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      firms: {
        Row: {
          created_at: string | null
          icai_reg_no: string | null
          id: string
          is_active: boolean | null
          name: string
          plan: string | null
          settings: Json | null
        }
        Insert: {
          created_at?: string | null
          icai_reg_no?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          plan?: string | null
          settings?: Json | null
        }
        Update: {
          created_at?: string | null
          icai_reg_no?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          plan?: string | null
          settings?: Json | null
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number | null
          client_id: string | null
          due_date: string | null
          firm_id: string | null
          gst_amount: number | null
          id: string
          invoice_no: string | null
          line_items: Json | null
          status: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          due_date?: string | null
          firm_id?: string | null
          gst_amount?: number | null
          id?: string
          invoice_no?: string | null
          line_items?: Json | null
          status?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          due_date?: string | null
          firm_id?: string | null
          gst_amount?: number | null
          id?: string
          invoice_no?: string | null
          line_items?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      itr_demands: {
        Row: {
          client_id: string | null
          demand_amount: number | null
          financial_year: string | null
          id: string
          notice_type: string | null
          response_due_date: string | null
          section: string | null
          status: string | null
        }
        Insert: {
          client_id?: string | null
          demand_amount?: number | null
          financial_year?: string | null
          id?: string
          notice_type?: string | null
          response_due_date?: string | null
          section?: string | null
          status?: string | null
        }
        Update: {
          client_id?: string | null
          demand_amount?: number | null
          financial_year?: string | null
          id?: string
          notice_type?: string | null
          response_due_date?: string | null
          section?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itr_demands_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      itr_profiles: {
        Row: {
          ais_recon_data: Json | null
          client_id: string | null
          filing_status: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          itr_form: string | null
        }
        Insert: {
          ais_recon_data?: Json | null
          client_id?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
        }
        Update: {
          ais_recon_data?: Json | null
          client_id?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itr_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itr_profiles_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      narration_rules: {
        Row: {
          action: string | null
          category: string | null
          firm_id: string | null
          id: string
          is_active: boolean | null
          keywords: string[] | null
          message: string | null
          severity: string | null
        }
        Insert: {
          action?: string | null
          category?: string | null
          firm_id?: string | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          message?: string | null
          severity?: string | null
        }
        Update: {
          action?: string | null
          category?: string | null
          firm_id?: string | null
          id?: string
          is_active?: boolean | null
          keywords?: string[] | null
          message?: string | null
          severity?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "narration_rules_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          channel: string | null
          content: Json | null
          firm_id: string | null
          id: string
          provider_id: string | null
          recipient_id: string | null
          sent_at: string | null
          status: string | null
          type: string | null
        }
        Insert: {
          channel?: string | null
          content?: Json | null
          firm_id?: string | null
          id?: string
          provider_id?: string | null
          recipient_id?: string | null
          sent_at?: string | null
          status?: string | null
          type?: string | null
        }
        Update: {
          channel?: string | null
          content?: Json | null
          firm_id?: string | null
          id?: string
          provider_id?: string | null
          recipient_id?: string | null
          sent_at?: string | null
          status?: string | null
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      related_parties: {
        Row: {
          client_id: string | null
          id: string
          is_director: boolean | null
          pan: string | null
          party_name: string | null
          relationship: string | null
          transaction_types: string[] | null
        }
        Insert: {
          client_id?: string | null
          id?: string
          is_director?: boolean | null
          pan?: string | null
          party_name?: string | null
          relationship?: string | null
          transaction_types?: string[] | null
        }
        Update: {
          client_id?: string | null
          id?: string
          is_director?: boolean | null
          pan?: string | null
          party_name?: string | null
          relationship?: string | null
          transaction_types?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "related_parties_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      scrutiny_findings: {
        Row: {
          clause_3cd: string | null
          client_id: string | null
          financial_year: string | null
          flag_message: string | null
          id: string
          narration: string | null
          rule_id: string | null
          severity: string | null
          status: string | null
        }
        Insert: {
          clause_3cd?: string | null
          client_id?: string | null
          financial_year?: string | null
          flag_message?: string | null
          id?: string
          narration?: string | null
          rule_id?: string | null
          severity?: string | null
          status?: string | null
        }
        Update: {
          clause_3cd?: string | null
          client_id?: string | null
          financial_year?: string | null
          flag_message?: string | null
          id?: string
          narration?: string | null
          rule_id?: string | null
          severity?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrutiny_findings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_entries: {
        Row: {
          amount: number | null
          challan_no: string | null
          client_id: string | null
          date: string | null
          deductee_id: string | null
          due_date: string | null
          filed_at: string | null
          firm_id: string | null
          id: string
          pan: string | null
          party_name: string | null
          payment_nature: string | null
          section: string | null
          status: string | null
          tds_amount: number | null
          tds_rate: number | null
        }
        Insert: {
          amount?: number | null
          challan_no?: string | null
          client_id?: string | null
          date?: string | null
          deductee_id?: string | null
          due_date?: string | null
          filed_at?: string | null
          firm_id?: string | null
          id?: string
          pan?: string | null
          party_name?: string | null
          payment_nature?: string | null
          section?: string | null
          status?: string | null
          tds_amount?: number | null
          tds_rate?: number | null
        }
        Update: {
          amount?: number | null
          challan_no?: string | null
          client_id?: string | null
          date?: string | null
          deductee_id?: string | null
          due_date?: string | null
          filed_at?: string | null
          firm_id?: string | null
          id?: string
          pan?: string | null
          party_name?: string | null
          payment_nature?: string | null
          section?: string | null
          status?: string | null
          tds_amount?: number | null
          tds_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_entries_deductee_id_fkey"
            columns: ["deductee_id"]
            isOneToOne: false
            referencedRelation: "deductees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_entries_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          billable: boolean | null
          client_id: string | null
          description: string | null
          engagement_id: string | null
          hours: number | null
          id: string
          user_id: string | null
          work_date: string | null
        }
        Insert: {
          billable?: boolean | null
          client_id?: string | null
          description?: string | null
          engagement_id?: string | null
          hours?: number | null
          id?: string
          user_id?: string | null
          work_date?: string | null
        }
        Update: {
          billable?: boolean | null
          client_id?: string | null
          description?: string | null
          engagement_id?: string | null
          hours?: number | null
          id?: string
          user_id?: string | null
          work_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      trial_balance_snapshots: {
        Row: {
          client_id: string | null
          financial_year: string | null
          id: string
          normalised_data: Json | null
          raw_data: Json | null
          source_format: string | null
        }
        Insert: {
          client_id?: string | null
          financial_year?: string | null
          id?: string
          normalised_data?: Json | null
          raw_data?: Json | null
          source_format?: string | null
        }
        Update: {
          client_id?: string | null
          financial_year?: string | null
          id?: string
          normalised_data?: Json | null
          raw_data?: Json | null
          source_format?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_balance_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string | null
          email: string | null
          firm_id: string | null
          icai_reg_no: string | null
          id: string
          is_active: boolean | null
          last_login: string | null
          mfa_enabled: boolean | null
          must_change_password: boolean | null
          name: string | null
          phone: string | null
          role: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          firm_id?: string | null
          icai_reg_no?: string | null
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          mfa_enabled?: boolean | null
          must_change_password?: boolean | null
          name?: string | null
          phone?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          firm_id?: string | null
          icai_reg_no?: string | null
          id?: string
          is_active?: boolean | null
          last_login?: string | null
          mfa_enabled?: boolean | null
          must_change_password?: boolean | null
          name?: string | null
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      version_history: {
        Row: {
          changed_fields: string[] | null
          created_at: string | null
          id: string
          new_data: Json | null
          old_data: Json | null
          operation: string | null
          record_id: string | null
          table_name: string | null
          user_name: string | null
          user_role: string | null
        }
        Insert: {
          changed_fields?: string[] | null
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation?: string | null
          record_id?: string | null
          table_name?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Update: {
          changed_fields?: string[] | null
          created_at?: string | null
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          operation?: string | null
          record_id?: string | null
          table_name?: string | null
          user_name?: string | null
          user_role?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      set_user_context: {
        Args: { p_user_id: string; p_user_name: string; p_user_role: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
