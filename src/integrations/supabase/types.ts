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
      app_themes: {
        Row: {
          active: boolean | null
          color_scheme: string
          created_at: string | null
          css_vars: Json
          id: string
          is_default: boolean | null
          layout_type: string
          name: string
        }
        Insert: {
          active?: boolean | null
          color_scheme?: string
          created_at?: string | null
          css_vars?: Json
          id?: string
          is_default?: boolean | null
          layout_type?: string
          name: string
        }
        Update: {
          active?: boolean | null
          color_scheme?: string
          created_at?: string | null
          css_vars?: Json
          id?: string
          is_default?: boolean | null
          layout_type?: string
          name?: string
        }
        Relationships: []
      }
      audit_ai_skills: {
        Row: {
          action_count: number | null
          action_type: string
          active: boolean | null
          applied_count: number | null
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          entity_type: string | null
          example_after: string | null
          example_before: string | null
          firms_affected: number | null
          id: string
          last_used_at: string | null
          pattern_name: string | null
          skill_data: Json
        }
        Insert: {
          action_count?: number | null
          action_type: string
          active?: boolean | null
          applied_count?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          entity_type?: string | null
          example_after?: string | null
          example_before?: string | null
          firms_affected?: number | null
          id?: string
          last_used_at?: string | null
          pattern_name?: string | null
          skill_data?: Json
        }
        Update: {
          action_count?: number | null
          action_type?: string
          active?: boolean | null
          applied_count?: number | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          entity_type?: string | null
          example_after?: string | null
          example_before?: string | null
          firms_affected?: number | null
          id?: string
          last_used_at?: string | null
          pattern_name?: string | null
          skill_data?: Json
        }
        Relationships: []
      }
      audit_client_queries: {
        Row: {
          carry_forward_from_year: string | null
          carry_forward_to_year: string | null
          client_id: string | null
          client_reply: string | null
          created_at: string | null
          due_date: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          internal_notes: string | null
          priority: string
          query_text: string
          ref_number: string | null
          replied_via: string | null
          reply_method: string | null
          source: string
          source_ref_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          carry_forward_from_year?: string | null
          carry_forward_to_year?: string | null
          client_id?: string | null
          client_reply?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string
          query_text: string
          ref_number?: string | null
          replied_via?: string | null
          reply_method?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          carry_forward_from_year?: string | null
          carry_forward_to_year?: string | null
          client_id?: string | null
          client_reply?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string
          query_text?: string
          ref_number?: string | null
          replied_via?: string | null
          reply_method?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_client_queries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_client_queries_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_client_queries_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_engagements: {
        Row: {
          active_tabs: Json | null
          audit_firm_id: string | null
          audit_programme: Json | null
          audit_type: string | null
          caro_applicable: boolean | null
          caro_responses: Json | null
          client_id: string | null
          entity_type_logic: string | null
          financial_year: string | null
          firm_id: string | null
          form_3cd: Json | null
          id: string
          manager_id: string | null
          materiality: Json | null
          notes_to_accounts: Json | null
          partner_id: string | null
          planned_end: string | null
          planned_start: string | null
          preliminary_complete: boolean | null
          risk_assessment: Json | null
          risk_rating: string | null
          signed_at: string | null
          signed_by: string | null
          status: string | null
          team_members: string[] | null
        }
        Insert: {
          active_tabs?: Json | null
          audit_firm_id?: string | null
          audit_programme?: Json | null
          audit_type?: string | null
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          client_id?: string | null
          entity_type_logic?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          id?: string
          manager_id?: string | null
          materiality?: Json | null
          notes_to_accounts?: Json | null
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          risk_assessment?: Json | null
          risk_rating?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status?: string | null
          team_members?: string[] | null
        }
        Update: {
          active_tabs?: Json | null
          audit_firm_id?: string | null
          audit_programme?: Json | null
          audit_type?: string | null
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          client_id?: string | null
          entity_type_logic?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          id?: string
          manager_id?: string | null
          materiality?: Json | null
          notes_to_accounts?: Json | null
          partner_id?: string | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          risk_assessment?: Json | null
          risk_rating?: string | null
          signed_at?: string | null
          signed_by?: string | null
          status?: string | null
          team_members?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_engagements_audit_firm_id_fkey"
            columns: ["audit_firm_id"]
            isOneToOne: false
            referencedRelation: "audit_firms"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "audit_engagements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_engagements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_engagements_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_firms: {
        Row: {
          active: boolean | null
          address: string | null
          city: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          firm_id: string
          icai_reg_no: string | null
          id: string
          logo_r2_key: string | null
          name: string
          partner_icai_no: string | null
          partner_name: string | null
          phone: string | null
        }
        Insert: {
          active?: boolean | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          firm_id: string
          icai_reg_no?: string | null
          id?: string
          logo_r2_key?: string | null
          name: string
          partner_icai_no?: string | null
          partner_name?: string | null
          phone?: string | null
        }
        Update: {
          active?: boolean | null
          address?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          firm_id?: string
          icai_reg_no?: string | null
          id?: string
          logo_r2_key?: string | null
          name?: string
          partner_icai_no?: string | null
          partner_name?: string | null
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_firms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_firms_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_human_actions: {
        Row: {
          action_context: Json | null
          action_type: string
          ai_suggestion: string | null
          created_at: string | null
          engagement_id: string | null
          firm_id: string | null
          human_override: boolean | null
          id: string
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          action_context?: Json | null
          action_type: string
          ai_suggestion?: string | null
          created_at?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          human_override?: boolean | null
          id?: string
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          action_context?: Json | null
          action_type?: string
          ai_suggestion?: string | null
          created_at?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          human_override?: boolean | null
          id?: string
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_human_actions_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_human_actions_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_preliminary_answers: {
        Row: {
          activated_tabs: Json | null
          answers: Json
          client_id: string | null
          created_at: string | null
          engagement_id: string
          firm_id: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          activated_tabs?: Json | null
          answers?: Json
          client_id?: string | null
          created_at?: string | null
          engagement_id: string
          firm_id?: string | null
          id?: string
          updated_at?: string | null
        }
        Update: {
          activated_tabs?: Json | null
          answers?: Json
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string
          firm_id?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_preliminary_answers_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_preliminary_answers_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_preliminary_answers_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_query_dispatch_log: {
        Row: {
          body: string | null
          channel: string
          client_id: string | null
          dispatch_ref: string | null
          dispatched_at: string | null
          dispatched_by: string | null
          engagement_id: string | null
          firm_id: string | null
          id: string
          query_ids: string[]
          subject: string | null
          template_used: string | null
        }
        Insert: {
          body?: string | null
          channel: string
          client_id?: string | null
          dispatch_ref?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          id?: string
          query_ids?: string[]
          subject?: string | null
          template_used?: string | null
        }
        Update: {
          body?: string | null
          channel?: string
          client_id?: string | null
          dispatch_ref?: string | null
          dispatched_at?: string | null
          dispatched_by?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          id?: string
          query_ids?: string[]
          subject?: string | null
          template_used?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_query_dispatch_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_query_dispatch_log_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_query_dispatch_log_firm_id_fkey"
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
      client_auditor_assignments: {
        Row: {
          appointed_date: string | null
          audit_firm_id: string
          client_id: string
          created_at: string | null
          created_by: string | null
          financial_year: string
          id: string
          remarks: string | null
        }
        Insert: {
          appointed_date?: string | null
          audit_firm_id: string
          client_id: string
          created_at?: string | null
          created_by?: string | null
          financial_year: string
          id?: string
          remarks?: string | null
        }
        Update: {
          appointed_date?: string | null
          audit_firm_id?: string
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          financial_year?: string
          id?: string
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_auditor_assignments_audit_firm_id_fkey"
            columns: ["audit_firm_id"]
            isOneToOne: false
            referencedRelation: "audit_firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_auditor_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_auditor_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      client_group_memberships: {
        Row: {
          added_at: string | null
          added_by: string | null
          client_id: string
          group_id: string
          id: string
        }
        Insert: {
          added_at?: string | null
          added_by?: string | null
          client_id: string
          group_id: string
          id?: string
        }
        Update: {
          added_at?: string | null
          added_by?: string | null
          client_id?: string
          group_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_group_memberships_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_group_memberships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "client_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      client_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          firm_id: string
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id: string
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_groups_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
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
          engagement_id: string | null
          extracted_text: string | null
          filename: string | null
          firm_id: string | null
          id: string
          is_final: boolean | null
          is_signed: boolean | null
          r2_key: string | null
          signed_at: string | null
          signed_by: string | null
          sub_category: string | null
          tags: string[] | null
        }
        Insert: {
          category?: string | null
          client_id?: string | null
          engagement_id?: string | null
          extracted_text?: string | null
          filename?: string | null
          firm_id?: string | null
          id?: string
          is_final?: boolean | null
          is_signed?: boolean | null
          r2_key?: string | null
          signed_at?: string | null
          signed_by?: string | null
          sub_category?: string | null
          tags?: string[] | null
        }
        Update: {
          category?: string | null
          client_id?: string | null
          engagement_id?: string | null
          extracted_text?: string | null
          filename?: string | null
          firm_id?: string | null
          id?: string
          is_final?: boolean | null
          is_signed?: boolean | null
          r2_key?: string | null
          signed_at?: string | null
          signed_by?: string | null
          sub_category?: string | null
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
            foreignKeyName: "documents_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "users"
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
          acknowledgment_no: string | null
          ais_recon_data: Json | null
          assessment_year: string | null
          assigned_to: string | null
          client_id: string | null
          date_data_received: string | null
          date_filed: string | null
          filing_status: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          itr_form: string | null
          itr_work_group_id: string | null
        }
        Insert: {
          acknowledgment_no?: string | null
          ais_recon_data?: Json | null
          assessment_year?: string | null
          assigned_to?: string | null
          client_id?: string | null
          date_data_received?: string | null
          date_filed?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
          itr_work_group_id?: string | null
        }
        Update: {
          acknowledgment_no?: string | null
          ais_recon_data?: Json | null
          assessment_year?: string | null
          assigned_to?: string | null
          client_id?: string | null
          date_data_received?: string | null
          date_filed?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
          itr_work_group_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itr_profiles_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "itr_profiles_itr_work_group_id_fkey"
            columns: ["itr_work_group_id"]
            isOneToOne: false
            referencedRelation: "itr_work_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      itr_work_groups: {
        Row: {
          code: string
          color: string | null
          description: string | null
          firm_id: string
          id: string
          name: string
        }
        Insert: {
          code: string
          color?: string | null
          description?: string | null
          firm_id: string
          id?: string
          name: string
        }
        Update: {
          code?: string
          color?: string | null
          description?: string | null
          firm_id?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "itr_work_groups_firm_id_fkey"
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
          linked_query_id: string | null
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
          linked_query_id?: string | null
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
          linked_query_id?: string | null
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
          tds_filing_id: string | null
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
          tds_filing_id?: string | null
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
          tds_filing_id?: string | null
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
          {
            foreignKeyName: "tds_entries_tds_filing_id_fkey"
            columns: ["tds_filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_filings: {
        Row: {
          acknowledgment_number: string | null
          approver_id: string | null
          checker_id: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          date_data_received: string | null
          date_of_filing: string | null
          financial_year: string
          firm_id: string
          id: string
          preparer_id: string | null
          quarter: string
          remarks: string | null
          tds_forms: string[] | null
          work_status: string
        }
        Insert: {
          acknowledgment_number?: string | null
          approver_id?: string | null
          checker_id?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          date_data_received?: string | null
          date_of_filing?: string | null
          financial_year: string
          firm_id: string
          id?: string
          preparer_id?: string | null
          quarter: string
          remarks?: string | null
          tds_forms?: string[] | null
          work_status?: string
        }
        Update: {
          acknowledgment_number?: string | null
          approver_id?: string | null
          checker_id?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          date_data_received?: string | null
          date_of_filing?: string | null
          financial_year?: string
          firm_id?: string
          id?: string
          preparer_id?: string | null
          quarter?: string
          remarks?: string | null
          tds_forms?: string[] | null
          work_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_filings_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filings_checker_id_fkey"
            columns: ["checker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filings_preparer_id_fkey"
            columns: ["preparer_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      current_user_firm_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      is_superadmin: { Args: never; Returns: boolean }
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
