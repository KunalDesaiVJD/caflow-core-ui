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
          default_for_roles: Json | null
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
          default_for_roles?: Json | null
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
          default_for_roles?: Json | null
          id?: string
          is_default?: boolean | null
          layout_type?: string
          name?: string
        }
        Relationships: []
      }
      audit_3cd_responses: {
        Row: {
          auto_value: string | null
          clause_number: number
          clause_sub: string | null
          engagement_id: string
          id: string
          is_applicable: boolean
          is_locked: boolean
          last_updated_by: string | null
          updated_at: string | null
          user_value: string | null
        }
        Insert: {
          auto_value?: string | null
          clause_number: number
          clause_sub?: string | null
          engagement_id: string
          id?: string
          is_applicable?: boolean
          is_locked?: boolean
          last_updated_by?: string | null
          updated_at?: string | null
          user_value?: string | null
        }
        Update: {
          auto_value?: string | null
          clause_number?: number
          clause_sub?: string | null
          engagement_id?: string
          id?: string
          is_applicable?: boolean
          is_locked?: boolean
          last_updated_by?: string | null
          updated_at?: string | null
          user_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_3cd_responses_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
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
      audit_caro_responses: {
        Row: {
          auto_draft: string | null
          clause_number: number
          clause_title: string
          engagement_id: string
          id: string
          inapplicability_reason: string | null
          is_applicable: boolean
          is_locked: boolean
          last_updated_at: string | null
          last_updated_by: string | null
          status: string
          user_response: string | null
        }
        Insert: {
          auto_draft?: string | null
          clause_number: number
          clause_title: string
          engagement_id: string
          id?: string
          inapplicability_reason?: string | null
          is_applicable?: boolean
          is_locked?: boolean
          last_updated_at?: string | null
          last_updated_by?: string | null
          status?: string
          user_response?: string | null
        }
        Update: {
          auto_draft?: string | null
          clause_number?: number
          clause_title?: string
          engagement_id?: string
          id?: string
          inapplicability_reason?: string | null
          is_applicable?: boolean
          is_locked?: boolean
          last_updated_at?: string | null
          last_updated_by?: string | null
          status?: string
          user_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_caro_responses_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
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
          audit_period_type: string | null
          audit_programme: Json | null
          audit_type: string | null
          bundle_url: string | null
          caro_applicable: boolean | null
          caro_responses: Json | null
          cash_flow_method: string | null
          client_id: string | null
          coa_mapping: Json | null
          entity_type: string | null
          entity_type_logic: string | null
          final_locked: boolean | null
          financial_year: string | null
          firm_id: string | null
          form_3cd: Json | null
          fs_preparation_mode: string | null
          id: string
          manager_id: string | null
          materiality: Json | null
          notes_finalized: boolean | null
          notes_finalized_at: string | null
          notes_to_accounts: Json | null
          parent_engagement_id: string | null
          partner_id: string | null
          period_label: string | null
          pipeline_stage: number | null
          planned_end: string | null
          planned_start: string | null
          preliminary_complete: boolean | null
          questionnaire_answers: Json | null
          re_evaluate_scrutiny: boolean | null
          requires_3ca: boolean | null
          requires_3cb: boolean | null
          requires_3cd: boolean | null
          requires_caro: boolean | null
          requires_cash_flow: boolean | null
          risk_assessment: Json | null
          risk_rating: string | null
          schedule_iii_division: string | null
          sign_off_by: string | null
          sign_off_date: string | null
          signed_at: string | null
          signed_by: string | null
          stage_statuses: Json | null
          status: string | null
          team_members: string[] | null
          udin: string | null
        }
        Insert: {
          active_tabs?: Json | null
          audit_firm_id?: string | null
          audit_period_type?: string | null
          audit_programme?: Json | null
          audit_type?: string | null
          bundle_url?: string | null
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          cash_flow_method?: string | null
          client_id?: string | null
          coa_mapping?: Json | null
          entity_type?: string | null
          entity_type_logic?: string | null
          final_locked?: boolean | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          fs_preparation_mode?: string | null
          id?: string
          manager_id?: string | null
          materiality?: Json | null
          notes_finalized?: boolean | null
          notes_finalized_at?: string | null
          notes_to_accounts?: Json | null
          parent_engagement_id?: string | null
          partner_id?: string | null
          period_label?: string | null
          pipeline_stage?: number | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          questionnaire_answers?: Json | null
          re_evaluate_scrutiny?: boolean | null
          requires_3ca?: boolean | null
          requires_3cb?: boolean | null
          requires_3cd?: boolean | null
          requires_caro?: boolean | null
          requires_cash_flow?: boolean | null
          risk_assessment?: Json | null
          risk_rating?: string | null
          schedule_iii_division?: string | null
          sign_off_by?: string | null
          sign_off_date?: string | null
          signed_at?: string | null
          signed_by?: string | null
          stage_statuses?: Json | null
          status?: string | null
          team_members?: string[] | null
          udin?: string | null
        }
        Update: {
          active_tabs?: Json | null
          audit_firm_id?: string | null
          audit_period_type?: string | null
          audit_programme?: Json | null
          audit_type?: string | null
          bundle_url?: string | null
          caro_applicable?: boolean | null
          caro_responses?: Json | null
          cash_flow_method?: string | null
          client_id?: string | null
          coa_mapping?: Json | null
          entity_type?: string | null
          entity_type_logic?: string | null
          final_locked?: boolean | null
          financial_year?: string | null
          firm_id?: string | null
          form_3cd?: Json | null
          fs_preparation_mode?: string | null
          id?: string
          manager_id?: string | null
          materiality?: Json | null
          notes_finalized?: boolean | null
          notes_finalized_at?: string | null
          notes_to_accounts?: Json | null
          parent_engagement_id?: string | null
          partner_id?: string | null
          period_label?: string | null
          pipeline_stage?: number | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          questionnaire_answers?: Json | null
          re_evaluate_scrutiny?: boolean | null
          requires_3ca?: boolean | null
          requires_3cb?: boolean | null
          requires_3cd?: boolean | null
          requires_caro?: boolean | null
          requires_cash_flow?: boolean | null
          risk_assessment?: Json | null
          risk_rating?: string | null
          schedule_iii_division?: string | null
          sign_off_by?: string | null
          sign_off_date?: string | null
          signed_at?: string | null
          signed_by?: string | null
          stage_statuses?: Json | null
          status?: string | null
          team_members?: string[] | null
          udin?: string | null
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
            foreignKeyName: "audit_engagements_parent_engagement_id_fkey"
            columns: ["parent_engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
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
            foreignKeyName: "audit_engagements_sign_off_by_fkey"
            columns: ["sign_off_by"]
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
      audit_notes: {
        Row: {
          ai_suggested: boolean | null
          created_at: string | null
          engagement_id: string
          id: string
          is_locked: boolean | null
          is_mandatory: boolean | null
          is_selected: boolean | null
          linked_accounts: Json | null
          note_content_auto: string | null
          note_content_user: string | null
          note_number: number
          note_source: string | null
          note_sub_sections: Json | null
          note_title: string
          table_data: Json | null
          user_overrides: Json | null
          xlsx_row_data: Json | null
        }
        Insert: {
          ai_suggested?: boolean | null
          created_at?: string | null
          engagement_id: string
          id?: string
          is_locked?: boolean | null
          is_mandatory?: boolean | null
          is_selected?: boolean | null
          linked_accounts?: Json | null
          note_content_auto?: string | null
          note_content_user?: string | null
          note_number: number
          note_source?: string | null
          note_sub_sections?: Json | null
          note_title: string
          table_data?: Json | null
          user_overrides?: Json | null
          xlsx_row_data?: Json | null
        }
        Update: {
          ai_suggested?: boolean | null
          created_at?: string | null
          engagement_id?: string
          id?: string
          is_locked?: boolean | null
          is_mandatory?: boolean | null
          is_selected?: boolean | null
          linked_accounts?: Json | null
          note_content_auto?: string | null
          note_content_user?: string | null
          note_number?: number
          note_source?: string | null
          note_sub_sections?: Json | null
          note_title?: string
          table_data?: Json | null
          user_overrides?: Json | null
          xlsx_row_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_notes_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
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
      carry_forward_queries: {
        Row: {
          carried_at: string | null
          carried_by: string | null
          id: string
          source_query_id: string
          target_engagement_id: string
        }
        Insert: {
          carried_at?: string | null
          carried_by?: string | null
          id?: string
          source_query_id: string
          target_engagement_id: string
        }
        Update: {
          carried_at?: string | null
          carried_by?: string | null
          id?: string
          source_query_id?: string
          target_engagement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "carry_forward_queries_carried_by_fkey"
            columns: ["carried_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carry_forward_queries_source_query_id_fkey"
            columns: ["source_query_id"]
            isOneToOne: false
            referencedRelation: "audit_client_queries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carry_forward_queries_target_engagement_id_fkey"
            columns: ["target_engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          created_by: string | null
          firm_id: string
          id: string
          last_message_at: string | null
          last_message_preview: string | null
          name: string | null
          type: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          firm_id: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          created_by?: string | null
          firm_id?: string
          id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          name?: string | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string | null
          deleted_at: string | null
          file_name: string | null
          file_size_bytes: number | null
          file_url: string | null
          id: string
          is_deleted: boolean | null
          is_pinned: boolean | null
          message_type: string
          read_by: Json | null
          reply_to_message_id: string | null
          sender_id: string | null
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string | null
          deleted_at?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          message_type?: string
          read_by?: Json | null
          reply_to_message_id?: string | null
          sender_id?: string | null
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string | null
          deleted_at?: string | null
          file_name?: string | null
          file_size_bytes?: number | null
          file_url?: string | null
          id?: string
          is_deleted?: boolean | null
          is_pinned?: boolean | null
          message_type?: string
          read_by?: Json | null
          reply_to_message_id?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          conversation_id: string
          id: string
          joined_at: string | null
          left_at: string | null
          notification_muted: boolean | null
          role: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notification_muted?: boolean | null
          role?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          joined_at?: string | null
          left_at?: string | null
          notification_muted?: boolean | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      client_services: {
        Row: {
          activated_at: string | null
          assigned_staff: Json | null
          client_id: string
          deactivated_at: string | null
          due_date_override: number | null
          fee_override: number | null
          frequency_override: string | null
          id: string
          is_active: boolean
          notes: string | null
          service_category_id: string
        }
        Insert: {
          activated_at?: string | null
          assigned_staff?: Json | null
          client_id: string
          deactivated_at?: string | null
          due_date_override?: number | null
          fee_override?: number | null
          frequency_override?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          service_category_id: string
        }
        Update: {
          activated_at?: string | null
          assigned_staff?: Json | null
          client_id?: string
          deactivated_at?: string | null
          due_date_override?: number | null
          fee_override?: number | null
          frequency_override?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          service_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_services_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_services_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          audit_config: Json | null
          caro_applicable: boolean | null
          cin: string | null
          compliance_flags: Json | null
          created_at: string | null
          entity_type: string | null
          firm_id: string | null
          gstin: string[] | null
          id: string
          internal_audit_applicable: boolean | null
          name: string | null
          pan: string | null
          statutory_audit_applicable: boolean | null
          stock_audit_applicable: boolean | null
          tax_audit_type: string | null
          user_id: string | null
        }
        Insert: {
          audit_config?: Json | null
          caro_applicable?: boolean | null
          cin?: string | null
          compliance_flags?: Json | null
          created_at?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          id?: string
          internal_audit_applicable?: boolean | null
          name?: string | null
          pan?: string | null
          statutory_audit_applicable?: boolean | null
          stock_audit_applicable?: boolean | null
          tax_audit_type?: string | null
          user_id?: string | null
        }
        Update: {
          audit_config?: Json | null
          caro_applicable?: boolean | null
          cin?: string | null
          compliance_flags?: Json | null
          created_at?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          id?: string
          internal_audit_applicable?: boolean | null
          name?: string | null
          pan?: string | null
          statutory_audit_applicable?: boolean | null
          stock_audit_applicable?: boolean | null
          tax_audit_type?: string | null
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
      demand_notice_status_history: {
        Row: {
          change_note: string | null
          changed_at: string | null
          changed_by: string | null
          from_status: string | null
          id: string
          notice_id: string
          to_status: string
        }
        Insert: {
          change_note?: string | null
          changed_at?: string | null
          changed_by?: string | null
          from_status?: string | null
          id?: string
          notice_id: string
          to_status: string
        }
        Update: {
          change_note?: string | null
          changed_at?: string | null
          changed_by?: string | null
          from_status?: string | null
          id?: string
          notice_id?: string
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_notice_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_notice_status_history_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "demand_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_notices: {
        Row: {
          ai_draft_reply: string | null
          amount_demanded: number | null
          amount_disputed: number | null
          assessment_year: string | null
          assigned_to: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          date_received: string | null
          department: string | null
          extended_due_date: string | null
          final_reply: string | null
          firm_id: string
          id: string
          notice_date: string | null
          notice_document_r2_key: string | null
          notice_ref_no: string | null
          notice_type: string | null
          order_document_r2_key: string | null
          priority: string | null
          remarks: string | null
          reply_due_date: string | null
          section: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          ai_draft_reply?: string | null
          amount_demanded?: number | null
          amount_disputed?: number | null
          assessment_year?: string | null
          assigned_to?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          date_received?: string | null
          department?: string | null
          extended_due_date?: string | null
          final_reply?: string | null
          firm_id: string
          id?: string
          notice_date?: string | null
          notice_document_r2_key?: string | null
          notice_ref_no?: string | null
          notice_type?: string | null
          order_document_r2_key?: string | null
          priority?: string | null
          remarks?: string | null
          reply_due_date?: string | null
          section?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          ai_draft_reply?: string | null
          amount_demanded?: number | null
          amount_disputed?: number | null
          assessment_year?: string | null
          assigned_to?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          date_received?: string | null
          department?: string | null
          extended_due_date?: string | null
          final_reply?: string | null
          firm_id?: string
          id?: string
          notice_date?: string | null
          notice_document_r2_key?: string | null
          notice_ref_no?: string | null
          notice_type?: string | null
          order_document_r2_key?: string | null
          priority?: string | null
          remarks?: string | null
          reply_due_date?: string | null
          section?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_notices_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_notices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_notices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_notices_firm_id_fkey"
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
      fa_asset_disposals: {
        Row: {
          accumulated_dep_reversed: number
          asset_id: string
          created_at: string | null
          created_by: string | null
          disposal_date: string
          disposal_proceeds: number
          entry_narration: string | null
          gross_block_reversed: number
          id: string
          net_book_value_at_disposal: number
          profit_loss_on_disposal: number
        }
        Insert: {
          accumulated_dep_reversed?: number
          asset_id: string
          created_at?: string | null
          created_by?: string | null
          disposal_date: string
          disposal_proceeds?: number
          entry_narration?: string | null
          gross_block_reversed?: number
          id?: string
          net_book_value_at_disposal?: number
          profit_loss_on_disposal?: number
        }
        Update: {
          accumulated_dep_reversed?: number
          asset_id?: string
          created_at?: string | null
          created_by?: string | null
          disposal_date?: string
          disposal_proceeds?: number
          entry_narration?: string | null
          gross_block_reversed?: number
          id?: string
          net_book_value_at_disposal?: number
          profit_loss_on_disposal?: number
        }
        Relationships: [
          {
            foreignKeyName: "fa_asset_disposals_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fa_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_asset_disposals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      fa_assets: {
        Row: {
          accumulated_dep_closing: number | null
          accumulated_dep_opening: number
          addition_date: string | null
          additions_during_year: number
          asset_code: string | null
          asset_name: string
          category_id: string
          client_id: string
          created_at: string | null
          created_by: string | null
          date_of_purchase: string
          dep_days_addition: number | null
          dep_days_opening: number | null
          dep_on_additions: number | null
          dep_on_opening_block: number | null
          depreciation_for_year: number | null
          depreciation_method_used: string | null
          disposal_date: string | null
          disposal_proceeds: number
          disposals_during_year: number
          engagement_id: string | null
          fy: string | null
          gross_block_closing: number | null
          gross_block_opening: number
          id: string
          is_carried_forward: boolean
          is_fully_depreciated: boolean | null
          is_locked: boolean
          location: string | null
          narration: string | null
          residual_value: number | null
          wdv_closing: number | null
        }
        Insert: {
          accumulated_dep_closing?: number | null
          accumulated_dep_opening?: number
          addition_date?: string | null
          additions_during_year?: number
          asset_code?: string | null
          asset_name: string
          category_id: string
          client_id: string
          created_at?: string | null
          created_by?: string | null
          date_of_purchase: string
          dep_days_addition?: number | null
          dep_days_opening?: number | null
          dep_on_additions?: number | null
          dep_on_opening_block?: number | null
          depreciation_for_year?: number | null
          depreciation_method_used?: string | null
          disposal_date?: string | null
          disposal_proceeds?: number
          disposals_during_year?: number
          engagement_id?: string | null
          fy?: string | null
          gross_block_closing?: number | null
          gross_block_opening?: number
          id?: string
          is_carried_forward?: boolean
          is_fully_depreciated?: boolean | null
          is_locked?: boolean
          location?: string | null
          narration?: string | null
          residual_value?: number | null
          wdv_closing?: number | null
        }
        Update: {
          accumulated_dep_closing?: number | null
          accumulated_dep_opening?: number
          addition_date?: string | null
          additions_during_year?: number
          asset_code?: string | null
          asset_name?: string
          category_id?: string
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          date_of_purchase?: string
          dep_days_addition?: number | null
          dep_days_opening?: number | null
          dep_on_additions?: number | null
          dep_on_opening_block?: number | null
          depreciation_for_year?: number | null
          depreciation_method_used?: string | null
          disposal_date?: string | null
          disposal_proceeds?: number
          disposals_during_year?: number
          engagement_id?: string | null
          fy?: string | null
          gross_block_closing?: number | null
          gross_block_opening?: number
          id?: string
          is_carried_forward?: boolean
          is_fully_depreciated?: boolean | null
          is_locked?: boolean
          location?: string | null
          narration?: string | null
          residual_value?: number | null
          wdv_closing?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "fa_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_assets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_assets_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      fa_categories: {
        Row: {
          asset_class: string | null
          created_at: string | null
          depreciation_method: string
          firm_id: string | null
          id: string
          name: string
          residual_value_pct: number
          schedule_ii_part: string | null
          slm_rate: number | null
          useful_life_years: number
          wdv_rate: number | null
        }
        Insert: {
          asset_class?: string | null
          created_at?: string | null
          depreciation_method?: string
          firm_id?: string | null
          id?: string
          name: string
          residual_value_pct?: number
          schedule_ii_part?: string | null
          slm_rate?: number | null
          useful_life_years: number
          wdv_rate?: number | null
        }
        Update: {
          asset_class?: string | null
          created_at?: string | null
          depreciation_method?: string
          firm_id?: string | null
          id?: string
          name?: string
          residual_value_pct?: number
          schedule_ii_part?: string | null
          slm_rate?: number | null
          useful_life_years?: number
          wdv_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_categories_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      fa_depreciation_schedule: {
        Row: {
          asset_id: string
          created_at: string | null
          depreciation_amount: number
          depreciation_rate: number
          fy: string
          id: string
          wdv_closing: number
          wdv_opening: number
        }
        Insert: {
          asset_id: string
          created_at?: string | null
          depreciation_amount: number
          depreciation_rate: number
          fy: string
          id?: string
          wdv_closing: number
          wdv_opening: number
        }
        Update: {
          asset_id?: string
          created_at?: string | null
          depreciation_amount?: number
          depreciation_rate?: number
          fy?: string
          id?: string
          wdv_closing?: number
          wdv_opening?: number
        }
        Relationships: [
          {
            foreignKeyName: "fa_depreciation_schedule_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fa_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      fa_financial_statements: {
        Row: {
          amount_cy: number | null
          amount_py: number | null
          created_at: string | null
          engagement_id: string
          id: string
          is_manual: boolean | null
          line_item_code: string | null
          line_item_name: string
          note_ref: number | null
          override_reason: string | null
          schedule_ref: string | null
          section: string
          sort_order: number | null
          source: string | null
        }
        Insert: {
          amount_cy?: number | null
          amount_py?: number | null
          created_at?: string | null
          engagement_id: string
          id?: string
          is_manual?: boolean | null
          line_item_code?: string | null
          line_item_name: string
          note_ref?: number | null
          override_reason?: string | null
          schedule_ref?: string | null
          section: string
          sort_order?: number | null
          source?: string | null
        }
        Update: {
          amount_cy?: number | null
          amount_py?: number | null
          created_at?: string | null
          engagement_id?: string
          id?: string
          is_manual?: boolean | null
          line_item_code?: string | null
          line_item_name?: string
          note_ref?: number | null
          override_reason?: string | null
          schedule_ref?: string | null
          section?: string
          sort_order?: number | null
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_financial_statements_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      fa_import_batches: {
        Row: {
          client_id: string
          error_count: number | null
          file_url: string | null
          fy: string
          id: string
          imported_at: string | null
          imported_by: string | null
          processed_count: number | null
          row_count: number | null
          status: string | null
        }
        Insert: {
          client_id: string
          error_count?: number | null
          file_url?: string | null
          fy: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          processed_count?: number | null
          row_count?: number | null
          status?: string | null
        }
        Update: {
          client_id?: string
          error_count?: number | null
          file_url?: string | null
          fy?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          processed_count?: number | null
          row_count?: number | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_import_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_import_batches_imported_by_fkey"
            columns: ["imported_by"]
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
          address: Json | null
          bank_details: Json | null
          created_at: string | null
          default_theme_id: string | null
          display_name: string | null
          email: string | null
          features_enabled: Json | null
          gstin: string | null
          icai_firm_reg_no: string | null
          icai_reg_no: string | null
          id: string
          invoice_template_id: string | null
          is_active: boolean | null
          is_audit_firm: boolean | null
          letterhead_url: string | null
          logo_url: string | null
          max_clients: number | null
          max_users: number | null
          membership_numbers: Json | null
          name: string
          pan: string | null
          peer_review_certificate_no: string | null
          peer_review_valid_till: string | null
          phone: string | null
          pincode: string | null
          plan: string | null
          plan_expires_at: string | null
          plan_type: string | null
          primary_color: string | null
          secondary_color: string | null
          settings: Json | null
          signature_url: string | null
          state: string | null
          tan: string | null
          website: string | null
        }
        Insert: {
          address?: Json | null
          bank_details?: Json | null
          created_at?: string | null
          default_theme_id?: string | null
          display_name?: string | null
          email?: string | null
          features_enabled?: Json | null
          gstin?: string | null
          icai_firm_reg_no?: string | null
          icai_reg_no?: string | null
          id?: string
          invoice_template_id?: string | null
          is_active?: boolean | null
          is_audit_firm?: boolean | null
          letterhead_url?: string | null
          logo_url?: string | null
          max_clients?: number | null
          max_users?: number | null
          membership_numbers?: Json | null
          name: string
          pan?: string | null
          peer_review_certificate_no?: string | null
          peer_review_valid_till?: string | null
          phone?: string | null
          pincode?: string | null
          plan?: string | null
          plan_expires_at?: string | null
          plan_type?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          settings?: Json | null
          signature_url?: string | null
          state?: string | null
          tan?: string | null
          website?: string | null
        }
        Update: {
          address?: Json | null
          bank_details?: Json | null
          created_at?: string | null
          default_theme_id?: string | null
          display_name?: string | null
          email?: string | null
          features_enabled?: Json | null
          gstin?: string | null
          icai_firm_reg_no?: string | null
          icai_reg_no?: string | null
          id?: string
          invoice_template_id?: string | null
          is_active?: boolean | null
          is_audit_firm?: boolean | null
          letterhead_url?: string | null
          logo_url?: string | null
          max_clients?: number | null
          max_users?: number | null
          membership_numbers?: Json | null
          name?: string
          pan?: string | null
          peer_review_certificate_no?: string | null
          peer_review_valid_till?: string | null
          phone?: string | null
          pincode?: string | null
          plan?: string | null
          plan_expires_at?: string | null
          plan_type?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          settings?: Json | null
          signature_url?: string | null
          state?: string | null
          tan?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "firms_default_theme_id_fkey"
            columns: ["default_theme_id"]
            isOneToOne: false
            referencedRelation: "app_themes"
            referencedColumns: ["id"]
          },
        ]
      }
      form_3cd: {
        Row: {
          assessment_year: string | null
          cl_10: Json | null
          cl_11: Json | null
          cl_12: Json | null
          cl_13: Json | null
          cl_14: Json | null
          cl_15_16: Json | null
          cl_17: Json | null
          cl_18: Json | null
          cl_19: Json | null
          cl_20: Json | null
          cl_21: Json | null
          cl_22: Json | null
          cl_23: Json | null
          cl_24_25: Json | null
          cl_26: Json | null
          cl_27: Json | null
          cl_29: Json | null
          cl_30: Json | null
          cl_31: Json | null
          cl_32: Json | null
          cl_33: Json | null
          cl_34: Json | null
          cl_35: Json | null
          cl_36: Json | null
          cl_37_39: Json | null
          cl_40: Json | null
          cl_41: Json | null
          cl_42_43: Json | null
          cl_44: Json | null
          cl_8: Json | null
          cl_9: Json | null
          client_id: string | null
          created_at: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          last_saved_at: string | null
          last_saved_by: string | null
          status: string | null
        }
        Insert: {
          assessment_year?: string | null
          cl_10?: Json | null
          cl_11?: Json | null
          cl_12?: Json | null
          cl_13?: Json | null
          cl_14?: Json | null
          cl_15_16?: Json | null
          cl_17?: Json | null
          cl_18?: Json | null
          cl_19?: Json | null
          cl_20?: Json | null
          cl_21?: Json | null
          cl_22?: Json | null
          cl_23?: Json | null
          cl_24_25?: Json | null
          cl_26?: Json | null
          cl_27?: Json | null
          cl_29?: Json | null
          cl_30?: Json | null
          cl_31?: Json | null
          cl_32?: Json | null
          cl_33?: Json | null
          cl_34?: Json | null
          cl_35?: Json | null
          cl_36?: Json | null
          cl_37_39?: Json | null
          cl_40?: Json | null
          cl_41?: Json | null
          cl_42_43?: Json | null
          cl_44?: Json | null
          cl_8?: Json | null
          cl_9?: Json | null
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          last_saved_at?: string | null
          last_saved_by?: string | null
          status?: string | null
        }
        Update: {
          assessment_year?: string | null
          cl_10?: Json | null
          cl_11?: Json | null
          cl_12?: Json | null
          cl_13?: Json | null
          cl_14?: Json | null
          cl_15_16?: Json | null
          cl_17?: Json | null
          cl_18?: Json | null
          cl_19?: Json | null
          cl_20?: Json | null
          cl_21?: Json | null
          cl_22?: Json | null
          cl_23?: Json | null
          cl_24_25?: Json | null
          cl_26?: Json | null
          cl_27?: Json | null
          cl_29?: Json | null
          cl_30?: Json | null
          cl_31?: Json | null
          cl_32?: Json | null
          cl_33?: Json | null
          cl_34?: Json | null
          cl_35?: Json | null
          cl_36?: Json | null
          cl_37_39?: Json | null
          cl_40?: Json | null
          cl_41?: Json | null
          cl_42_43?: Json | null
          cl_44?: Json | null
          cl_8?: Json | null
          cl_9?: Json | null
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          last_saved_at?: string | null
          last_saved_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_3cd_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_item_masters: {
        Row: {
          created_at: string | null
          created_by: string | null
          default_rate: number | null
          description: string
          firm_id: string | null
          hsn_sac_code: string | null
          id: string
          is_active: boolean | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          default_rate?: number | null
          description: string
          firm_id?: string | null
          hsn_sac_code?: string | null
          id?: string
          is_active?: boolean | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          default_rate?: number | null
          description?: string
          firm_id?: string | null
          hsn_sac_code?: string | null
          id?: string
          is_active?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_item_masters_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_line_items: {
        Row: {
          amount: number | null
          created_at: string | null
          description: string
          hsn_sac_code: string | null
          id: string
          invoice_id: string
          quantity: number | null
          rate: number | null
          sort_order: number | null
          tax_rate_cgst: number | null
          tax_rate_igst: number | null
          tax_rate_sgst: number | null
          unit: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          description?: string
          hsn_sac_code?: string | null
          id?: string
          invoice_id: string
          quantity?: number | null
          rate?: number | null
          sort_order?: number | null
          tax_rate_cgst?: number | null
          tax_rate_igst?: number | null
          tax_rate_sgst?: number | null
          unit?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          description?: string
          hsn_sac_code?: string | null
          id?: string
          invoice_id?: string
          quantity?: number | null
          rate?: number | null
          sort_order?: number | null
          tax_rate_cgst?: number | null
          tax_rate_igst?: number | null
          tax_rate_sgst?: number | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number | null
          bank_details_snapshot: Json | null
          client_id: string | null
          created_by: string | null
          due_date: string | null
          firm_id: string | null
          footer_text: string | null
          from_address: string | null
          from_email: string | null
          from_firm_name: string | null
          from_gstin: string | null
          from_pan: string | null
          from_phone: string | null
          gst_amount: number | null
          id: string
          invoice_date: string | null
          invoice_format: string | null
          invoice_no: string | null
          is_intra_state: boolean | null
          line_items: Json | null
          notes: string | null
          paid_at: string | null
          payment_terms: string | null
          place_of_supply: string | null
          reference_no: string | null
          sent_at: string | null
          show_logo: boolean | null
          signatory_name: string | null
          status: string | null
          subject: string | null
          subtotal: number | null
          to_address: string | null
          to_gstin: string | null
          to_name: string | null
          to_pan: string | null
          total_amount: number | null
          total_cgst: number | null
          total_igst: number | null
          total_sgst: number | null
          voided_reason: string | null
        }
        Insert: {
          amount?: number | null
          bank_details_snapshot?: Json | null
          client_id?: string | null
          created_by?: string | null
          due_date?: string | null
          firm_id?: string | null
          footer_text?: string | null
          from_address?: string | null
          from_email?: string | null
          from_firm_name?: string | null
          from_gstin?: string | null
          from_pan?: string | null
          from_phone?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_format?: string | null
          invoice_no?: string | null
          is_intra_state?: boolean | null
          line_items?: Json | null
          notes?: string | null
          paid_at?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          reference_no?: string | null
          sent_at?: string | null
          show_logo?: boolean | null
          signatory_name?: string | null
          status?: string | null
          subject?: string | null
          subtotal?: number | null
          to_address?: string | null
          to_gstin?: string | null
          to_name?: string | null
          to_pan?: string | null
          total_amount?: number | null
          total_cgst?: number | null
          total_igst?: number | null
          total_sgst?: number | null
          voided_reason?: string | null
        }
        Update: {
          amount?: number | null
          bank_details_snapshot?: Json | null
          client_id?: string | null
          created_by?: string | null
          due_date?: string | null
          firm_id?: string | null
          footer_text?: string | null
          from_address?: string | null
          from_email?: string | null
          from_firm_name?: string | null
          from_gstin?: string | null
          from_pan?: string | null
          from_phone?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_format?: string | null
          invoice_no?: string | null
          is_intra_state?: boolean | null
          line_items?: Json | null
          notes?: string | null
          paid_at?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          reference_no?: string | null
          sent_at?: string | null
          show_logo?: boolean | null
          signatory_name?: string | null
          status?: string | null
          subject?: string | null
          subtotal?: number | null
          to_address?: string | null
          to_gstin?: string | null
          to_name?: string | null
          to_pan?: string | null
          total_amount?: number | null
          total_cgst?: number | null
          total_igst?: number | null
          total_sgst?: number | null
          voided_reason?: string | null
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
      ledger_import_batches: {
        Row: {
          engagement_id: string
          error_log: Json | null
          file_size_bytes: number | null
          file_url: string | null
          firm_id: string | null
          id: string
          import_type: string | null
          imported_at: string | null
          imported_by: string | null
          leaf_rows: number | null
          original_filename: string | null
          processed_rows: number | null
          processing_status: string | null
          row_count: number | null
          status: string | null
          total_rows: number | null
        }
        Insert: {
          engagement_id: string
          error_log?: Json | null
          file_size_bytes?: number | null
          file_url?: string | null
          firm_id?: string | null
          id?: string
          import_type?: string | null
          imported_at?: string | null
          imported_by?: string | null
          leaf_rows?: number | null
          original_filename?: string | null
          processed_rows?: number | null
          processing_status?: string | null
          row_count?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Update: {
          engagement_id?: string
          error_log?: Json | null
          file_size_bytes?: number | null
          file_url?: string | null
          firm_id?: string | null
          id?: string
          import_type?: string | null
          imported_at?: string | null
          imported_by?: string | null
          leaf_rows?: number | null
          original_filename?: string | null
          processed_rows?: number | null
          processing_status?: string | null
          row_count?: number | null
          status?: string | null
          total_rows?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_import_batches_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_import_batches_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_transactions: {
        Row: {
          account_group: string | null
          account_name: string
          created_at: string | null
          credit: number | null
          date: string | null
          debit: number | null
          engagement_id: string
          flag_reason: string | null
          id: string
          import_batch_id: string | null
          narration: string | null
          running_balance: number | null
          scrutiny_flag: boolean | null
          voucher_no: string | null
          voucher_type: string | null
        }
        Insert: {
          account_group?: string | null
          account_name: string
          created_at?: string | null
          credit?: number | null
          date?: string | null
          debit?: number | null
          engagement_id: string
          flag_reason?: string | null
          id?: string
          import_batch_id?: string | null
          narration?: string | null
          running_balance?: number | null
          scrutiny_flag?: boolean | null
          voucher_no?: string | null
          voucher_type?: string | null
        }
        Update: {
          account_group?: string | null
          account_name?: string
          created_at?: string | null
          credit?: number | null
          date?: string | null
          debit?: number | null
          engagement_id?: string
          flag_reason?: string | null
          id?: string
          import_batch_id?: string | null
          narration?: string | null
          running_balance?: number | null
          scrutiny_flag?: boolean | null
          voucher_no?: string | null
          voucher_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_transactions_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "ledger_import_batches"
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
      note_templates: {
        Row: {
          applicable_when: Json | null
          created_at: string | null
          id: string
          is_mandatory: boolean | null
          note_number: number
          note_title: string
          note_type: string | null
          template_content: Json | null
          xlsx_rows: Json | null
        }
        Insert: {
          applicable_when?: Json | null
          created_at?: string | null
          id?: string
          is_mandatory?: boolean | null
          note_number: number
          note_title: string
          note_type?: string | null
          template_content?: Json | null
          xlsx_rows?: Json | null
        }
        Update: {
          applicable_when?: Json | null
          created_at?: string | null
          id?: string
          is_mandatory?: boolean | null
          note_number?: number
          note_title?: string
          note_type?: string | null
          template_content?: Json | null
          xlsx_rows?: Json | null
        }
        Relationships: []
      }
      notes_rollover_buffer: {
        Row: {
          applied: boolean | null
          client_id: string | null
          created_at: string | null
          firm_id: string | null
          from_financial_year: string | null
          id: string
          rolled_notes: Json | null
          to_financial_year: string | null
        }
        Insert: {
          applied?: boolean | null
          client_id?: string | null
          created_at?: string | null
          firm_id?: string | null
          from_financial_year?: string | null
          id?: string
          rolled_notes?: Json | null
          to_financial_year?: string | null
        }
        Update: {
          applied?: boolean | null
          client_id?: string | null
          created_at?: string | null
          firm_id?: string | null
          from_financial_year?: string | null
          id?: string
          rolled_notes?: Json | null
          to_financial_year?: string | null
        }
        Relationships: []
      }
      notes_to_accounts: {
        Row: {
          client_id: string | null
          created_at: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          last_saved_at: string | null
          note_1: Json | null
          note_2: Json | null
          note_29: Json | null
          note_30: Json | null
          note_31: Json | null
          note_32: Json | null
          note_33: Json | null
          note_34: Json | null
          note_35: Json | null
          note_36: Json | null
          note_37: Json | null
          note_38: Json | null
          note_39: Json | null
          note_40: Json | null
          note_41: Json | null
          note_42: Json | null
          note_43: Json | null
          note_44: Json | null
          note_45: Json | null
          status: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          last_saved_at?: string | null
          note_1?: Json | null
          note_2?: Json | null
          note_29?: Json | null
          note_30?: Json | null
          note_31?: Json | null
          note_32?: Json | null
          note_33?: Json | null
          note_34?: Json | null
          note_35?: Json | null
          note_36?: Json | null
          note_37?: Json | null
          note_38?: Json | null
          note_39?: Json | null
          note_40?: Json | null
          note_41?: Json | null
          note_42?: Json | null
          note_43?: Json | null
          note_44?: Json | null
          note_45?: Json | null
          status?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          last_saved_at?: string | null
          note_1?: Json | null
          note_2?: Json | null
          note_29?: Json | null
          note_30?: Json | null
          note_31?: Json | null
          note_32?: Json | null
          note_33?: Json | null
          note_34?: Json | null
          note_35?: Json | null
          note_36?: Json | null
          note_37?: Json | null
          note_38?: Json | null
          note_39?: Json | null
          note_40?: Json | null
          note_41?: Json | null
          note_42?: Json | null
          note_43?: Json | null
          note_44?: Json | null
          note_45?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_to_accounts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
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
      role_permission_audit_log: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          field_changed: string
          firm_id: string | null
          id: string
          module: string
          new_value: string | null
          old_value: string | null
          role: string
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          field_changed: string
          firm_id?: string | null
          id?: string
          module: string
          new_value?: string | null
          old_value?: string | null
          role: string
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          field_changed?: string
          firm_id?: string | null
          id?: string
          module?: string
          new_value?: string | null
          old_value?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permission_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permission_audit_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_export: boolean | null
          can_view: boolean | null
          custom_restrictions: Json | null
          firm_id: string
          id: string
          module: string
          role: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          custom_restrictions?: Json | null
          firm_id: string
          id?: string
          module: string
          role: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_export?: boolean | null
          can_view?: boolean | null
          custom_restrictions?: Json | null
          firm_id?: string
          id?: string
          module?: string
          role?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      role_theme_overrides: {
        Row: {
          allow_user_override: boolean | null
          color_scheme: string | null
          created_by: string | null
          firm_id: string
          id: string
          layout_type: string | null
          role: string
          theme_id: string | null
          updated_at: string | null
        }
        Insert: {
          allow_user_override?: boolean | null
          color_scheme?: string | null
          created_by?: string | null
          firm_id: string
          id?: string
          layout_type?: string | null
          role: string
          theme_id?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_user_override?: boolean | null
          color_scheme?: string | null
          created_by?: string | null
          firm_id?: string
          id?: string
          layout_type?: string | null
          role?: string
          theme_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_theme_overrides_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_theme_overrides_theme_id_fkey"
            columns: ["theme_id"]
            isOneToOne: false
            referencedRelation: "app_themes"
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
      scrutiny_rules: {
        Row: {
          applicable_to: Json | null
          audit_query_template: string | null
          category: string
          created_by: string | null
          detection_level: string
          detection_logic: Json | null
          id: string
          is_active: boolean | null
          keywords_ledger_synonyms: string | null
          legal_reference: string | null
          prior_year_needed: boolean | null
          root_cause: string | null
          rule_id: string
          rule_name: string
          rules_version: string | null
          severity: string
          threshold_type: string
          threshold_value: number | null
          updated_at: string | null
        }
        Insert: {
          applicable_to?: Json | null
          audit_query_template?: string | null
          category: string
          created_by?: string | null
          detection_level?: string
          detection_logic?: Json | null
          id?: string
          is_active?: boolean | null
          keywords_ledger_synonyms?: string | null
          legal_reference?: string | null
          prior_year_needed?: boolean | null
          root_cause?: string | null
          rule_id: string
          rule_name: string
          rules_version?: string | null
          severity?: string
          threshold_type?: string
          threshold_value?: number | null
          updated_at?: string | null
        }
        Update: {
          applicable_to?: Json | null
          audit_query_template?: string | null
          category?: string
          created_by?: string | null
          detection_level?: string
          detection_logic?: Json | null
          id?: string
          is_active?: boolean | null
          keywords_ledger_synonyms?: string | null
          legal_reference?: string | null
          prior_year_needed?: boolean | null
          root_cause?: string | null
          rule_id?: string
          rule_name?: string
          rules_version?: string | null
          severity?: string
          threshold_type?: string
          threshold_value?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrutiny_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      service_categories: {
        Row: {
          applicable_entity_types: Json | null
          category_code: string
          created_at: string | null
          created_by: string | null
          default_due_day: number | null
          default_fee_template: Json | null
          description: string | null
          firm_id: string
          frequency: string
          id: string
          is_active: boolean
          linked_module: string | null
          name: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          applicable_entity_types?: Json | null
          category_code: string
          created_at?: string | null
          created_by?: string | null
          default_due_day?: number | null
          default_fee_template?: Json | null
          description?: string | null
          firm_id: string
          frequency?: string
          id?: string
          is_active?: boolean
          linked_module?: string | null
          name: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          applicable_entity_types?: Json | null
          category_code?: string
          created_at?: string | null
          created_by?: string | null
          default_due_day?: number | null
          default_fee_template?: Json | null
          description?: string | null
          firm_id?: string
          frequency?: string
          id?: string
          is_active?: boolean
          linked_module?: string | null
          name?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_categories_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      service_templates: {
        Row: {
          created_at: string | null
          default_description: string | null
          default_rate: number | null
          hsn_sac_code: string | null
          id: string
          is_default: boolean | null
          service_category_id: string
          tax_rate: number | null
          template_name: string
        }
        Insert: {
          created_at?: string | null
          default_description?: string | null
          default_rate?: number | null
          hsn_sac_code?: string | null
          id?: string
          is_default?: boolean | null
          service_category_id: string
          tax_rate?: number | null
          template_name: string
        }
        Update: {
          created_at?: string | null
          default_description?: string | null
          default_rate?: number | null
          hsn_sac_code?: string | null
          id?: string
          is_default?: boolean | null
          service_category_id?: string
          tax_rate?: number | null
          template_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_templates_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      tb_hierarchy_nodes: {
        Row: {
          bs_pl_side: string | null
          closing_balance: number | null
          created_at: string | null
          engagement_id: string | null
          id: string
          import_batch_id: string | null
          indent_value: number | null
          is_bold: boolean | null
          is_leaf: boolean | null
          level: number
          node_id: string
          normal_balance: string | null
          opening_balance: number | null
          parent_node_id: string | null
          primary_group: string | null
          row_number: number | null
          tally_group_name: string
          txn_credit: number | null
          txn_debit: number | null
        }
        Insert: {
          bs_pl_side?: string | null
          closing_balance?: number | null
          created_at?: string | null
          engagement_id?: string | null
          id?: string
          import_batch_id?: string | null
          indent_value?: number | null
          is_bold?: boolean | null
          is_leaf?: boolean | null
          level: number
          node_id: string
          normal_balance?: string | null
          opening_balance?: number | null
          parent_node_id?: string | null
          primary_group?: string | null
          row_number?: number | null
          tally_group_name: string
          txn_credit?: number | null
          txn_debit?: number | null
        }
        Update: {
          bs_pl_side?: string | null
          closing_balance?: number | null
          created_at?: string | null
          engagement_id?: string | null
          id?: string
          import_batch_id?: string | null
          indent_value?: number | null
          is_bold?: boolean | null
          is_leaf?: boolean | null
          level?: number
          node_id?: string
          normal_balance?: string | null
          opening_balance?: number | null
          parent_node_id?: string | null
          primary_group?: string | null
          row_number?: number | null
          tally_group_name?: string
          txn_credit?: number | null
          txn_debit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tb_hierarchy_nodes_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tb_hierarchy_nodes_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "ledger_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      tb_upload_sessions: {
        Row: {
          chunk_data: string | null
          chunk_index: number | null
          created_at: string | null
          engagement_id: string | null
          id: string
          total_chunks: number | null
        }
        Insert: {
          chunk_data?: string | null
          chunk_index?: number | null
          created_at?: string | null
          engagement_id?: string | null
          id: string
          total_chunks?: number | null
        }
        Update: {
          chunk_data?: string | null
          chunk_index?: number | null
          created_at?: string | null
          engagement_id?: string | null
          id?: string
          total_chunks?: number | null
        }
        Relationships: []
      }
      tds_entries: {
        Row: {
          amount: number | null
          challan_amount: number | null
          challan_bsr_code: string | null
          challan_date: string | null
          challan_no: string | null
          challan_serial_no: string | null
          client_id: string | null
          country_of_residence: string | null
          date: string | null
          deductee_id: string | null
          deductee_pan: string | null
          designation: string | null
          due_date: string | null
          filed_at: string | null
          firm_id: string | null
          form_type: string | null
          id: string
          lower_cert_no: string | null
          lower_cert_rate: number | null
          nature_of_payment: string | null
          nil_deduction_reason: string | null
          pan: string | null
          party_name: string | null
          payment_mode: string | null
          payment_nature: string | null
          salary_amount: number | null
          section: string | null
          section_code: string | null
          standard_deduction: number | null
          status: string | null
          tax_treaty_section: string | null
          taxable_salary: number | null
          tds_amount: number | null
          tds_filing_id: string | null
          tds_rate: number | null
          trc_available: boolean | null
          validation_messages: Json | null
          validation_status: string | null
        }
        Insert: {
          amount?: number | null
          challan_amount?: number | null
          challan_bsr_code?: string | null
          challan_date?: string | null
          challan_no?: string | null
          challan_serial_no?: string | null
          client_id?: string | null
          country_of_residence?: string | null
          date?: string | null
          deductee_id?: string | null
          deductee_pan?: string | null
          designation?: string | null
          due_date?: string | null
          filed_at?: string | null
          firm_id?: string | null
          form_type?: string | null
          id?: string
          lower_cert_no?: string | null
          lower_cert_rate?: number | null
          nature_of_payment?: string | null
          nil_deduction_reason?: string | null
          pan?: string | null
          party_name?: string | null
          payment_mode?: string | null
          payment_nature?: string | null
          salary_amount?: number | null
          section?: string | null
          section_code?: string | null
          standard_deduction?: number | null
          status?: string | null
          tax_treaty_section?: string | null
          taxable_salary?: number | null
          tds_amount?: number | null
          tds_filing_id?: string | null
          tds_rate?: number | null
          trc_available?: boolean | null
          validation_messages?: Json | null
          validation_status?: string | null
        }
        Update: {
          amount?: number | null
          challan_amount?: number | null
          challan_bsr_code?: string | null
          challan_date?: string | null
          challan_no?: string | null
          challan_serial_no?: string | null
          client_id?: string | null
          country_of_residence?: string | null
          date?: string | null
          deductee_id?: string | null
          deductee_pan?: string | null
          designation?: string | null
          due_date?: string | null
          filed_at?: string | null
          firm_id?: string | null
          form_type?: string | null
          id?: string
          lower_cert_no?: string | null
          lower_cert_rate?: number | null
          nature_of_payment?: string | null
          nil_deduction_reason?: string | null
          pan?: string | null
          party_name?: string | null
          payment_mode?: string | null
          payment_nature?: string | null
          salary_amount?: number | null
          section?: string | null
          section_code?: string | null
          standard_deduction?: number | null
          status?: string | null
          tax_treaty_section?: string | null
          taxable_salary?: number | null
          tds_amount?: number | null
          tds_filing_id?: string | null
          tds_rate?: number | null
          trc_available?: boolean | null
          validation_messages?: Json | null
          validation_status?: string | null
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
          assigned_staff: string | null
          checker_id: string | null
          client_id: string
          created_at: string | null
          created_by: string | null
          date_data_received: string | null
          date_of_filing: string | null
          financial_year: string
          firm_id: string
          id: string
          last_updated_at: string | null
          last_updated_by: string | null
          pdf_url: string | null
          preparer_id: string | null
          prn_no: string | null
          quarter: string
          remarks: string | null
          tan: string | null
          tds_forms: string[] | null
          work_status: string
        }
        Insert: {
          acknowledgment_number?: string | null
          approver_id?: string | null
          assigned_staff?: string | null
          checker_id?: string | null
          client_id: string
          created_at?: string | null
          created_by?: string | null
          date_data_received?: string | null
          date_of_filing?: string | null
          financial_year: string
          firm_id: string
          id?: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          pdf_url?: string | null
          preparer_id?: string | null
          prn_no?: string | null
          quarter: string
          remarks?: string | null
          tan?: string | null
          tds_forms?: string[] | null
          work_status?: string
        }
        Update: {
          acknowledgment_number?: string | null
          approver_id?: string | null
          assigned_staff?: string | null
          checker_id?: string | null
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          date_data_received?: string | null
          date_of_filing?: string | null
          financial_year?: string
          firm_id?: string
          id?: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          pdf_url?: string | null
          preparer_id?: string | null
          prn_no?: string | null
          quarter?: string
          remarks?: string | null
          tan?: string | null
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
          approved_at: string | null
          approved_by: string | null
          billable: boolean | null
          client_id: string | null
          created_at: string | null
          description: string | null
          engagement_id: string | null
          firm_id: string | null
          hours: number | null
          id: string
          invoice_id: string | null
          is_billable: boolean | null
          is_invoiced: boolean | null
          minutes: number | null
          service_category_id: string | null
          user_id: string | null
          work_date: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          hours?: number | null
          id?: string
          invoice_id?: string | null
          is_billable?: boolean | null
          is_invoiced?: boolean | null
          minutes?: number | null
          service_category_id?: string | null
          user_id?: string | null
          work_date?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          billable?: boolean | null
          client_id?: string | null
          created_at?: string | null
          description?: string | null
          engagement_id?: string | null
          firm_id?: string | null
          hours?: number | null
          id?: string
          invoice_id?: string | null
          is_billable?: boolean | null
          is_invoiced?: boolean | null
          minutes?: number | null
          service_category_id?: string | null
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
            foreignKeyName: "timesheets_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
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
          account_type: string | null
          bs_pl_side: string | null
          chunk_count: number | null
          chunks_processed: number | null
          client_id: string | null
          closing_balance: number | null
          closing_balance_signed: number | null
          column_mapping: Json | null
          credit_total: number | null
          debit_total: number | null
          difference: number | null
          engagement_id: string | null
          financial_year: string | null
          hierarchy_level: number | null
          id: string
          import_batch_id: string | null
          import_format: string | null
          is_validated: boolean | null
          ledger_name: string | null
          matched_category_code: string | null
          matched_keywords: string[] | null
          node_id: string | null
          normal_balance: string | null
          normalised_data: Json | null
          opening_balance: number | null
          parent_node_id: string | null
          primary_group: string | null
          processing_status: string | null
          raw_data: Json | null
          source_format: string | null
          tally_indent: number | null
          txn_credit: number | null
          txn_debit: number | null
          validation_status: string | null
        }
        Insert: {
          account_type?: string | null
          bs_pl_side?: string | null
          chunk_count?: number | null
          chunks_processed?: number | null
          client_id?: string | null
          closing_balance?: number | null
          closing_balance_signed?: number | null
          column_mapping?: Json | null
          credit_total?: number | null
          debit_total?: number | null
          difference?: number | null
          engagement_id?: string | null
          financial_year?: string | null
          hierarchy_level?: number | null
          id?: string
          import_batch_id?: string | null
          import_format?: string | null
          is_validated?: boolean | null
          ledger_name?: string | null
          matched_category_code?: string | null
          matched_keywords?: string[] | null
          node_id?: string | null
          normal_balance?: string | null
          normalised_data?: Json | null
          opening_balance?: number | null
          parent_node_id?: string | null
          primary_group?: string | null
          processing_status?: string | null
          raw_data?: Json | null
          source_format?: string | null
          tally_indent?: number | null
          txn_credit?: number | null
          txn_debit?: number | null
          validation_status?: string | null
        }
        Update: {
          account_type?: string | null
          bs_pl_side?: string | null
          chunk_count?: number | null
          chunks_processed?: number | null
          client_id?: string | null
          closing_balance?: number | null
          closing_balance_signed?: number | null
          column_mapping?: Json | null
          credit_total?: number | null
          debit_total?: number | null
          difference?: number | null
          engagement_id?: string | null
          financial_year?: string | null
          hierarchy_level?: number | null
          id?: string
          import_batch_id?: string | null
          import_format?: string | null
          is_validated?: boolean | null
          ledger_name?: string | null
          matched_category_code?: string | null
          matched_keywords?: string[] | null
          node_id?: string | null
          normal_balance?: string | null
          normalised_data?: Json | null
          opening_balance?: number | null
          parent_node_id?: string | null
          primary_group?: string | null
          processing_status?: string | null
          raw_data?: Json | null
          source_format?: string | null
          tally_indent?: number | null
          txn_credit?: number | null
          txn_debit?: number | null
          validation_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trial_balance_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trial_balance_snapshots_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
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
      fa_summary_by_fy: {
        Row: {
          acc_dep_closing: number | null
          acc_dep_opening: number | null
          additions: number | null
          asset_class: string | null
          asset_count: number | null
          category_name: string | null
          client_id: string | null
          depreciation: number | null
          depreciation_method: string | null
          disposals: number | null
          fy: string | null
          gross_block_closing: number | null
          gross_block_opening: number | null
          net_block: number | null
          schedule_ii_part: string | null
          slm_rate: number | null
          useful_life_years: number | null
          wdv_rate: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_assets_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      current_user_firm_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      is_chat_conversation_admin: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_conversation_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_same_firm_user: { Args: { _user_id: string }; Returns: boolean }
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
