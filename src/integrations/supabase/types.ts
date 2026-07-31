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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_query_analysis: {
        Row: {
          detectable: boolean | null
          exact_query: string | null
          intent: string | null
          query_id: string
          rule: string | null
          vouching: boolean | null
        }
        Insert: {
          detectable?: boolean | null
          exact_query?: string | null
          intent?: string | null
          query_id: string
          rule?: string | null
          vouching?: boolean | null
        }
        Update: {
          detectable?: boolean | null
          exact_query?: string | null
          intent?: string | null
          query_id?: string
          rule?: string | null
          vouching?: boolean | null
        }
        Relationships: []
      }
      ai_query_gap: {
        Row: {
          ai_covered: boolean | null
          ai_evidence: string | null
          analysis_depth: string | null
          category: string | null
          client_id: string | null
          client_name: string | null
          financial_year: string | null
          ledger_name: string | null
          permanent_fix: string | null
          query_id: string
          query_text: string | null
          reason: string | null
        }
        Insert: {
          ai_covered?: boolean | null
          ai_evidence?: string | null
          analysis_depth?: string | null
          category?: string | null
          client_id?: string | null
          client_name?: string | null
          financial_year?: string | null
          ledger_name?: string | null
          permanent_fix?: string | null
          query_id: string
          query_text?: string | null
          reason?: string | null
        }
        Update: {
          ai_covered?: boolean | null
          ai_evidence?: string | null
          analysis_depth?: string | null
          category?: string | null
          client_id?: string | null
          client_name?: string | null
          financial_year?: string | null
          ledger_name?: string | null
          permanent_fix?: string | null
          query_id?: string
          query_text?: string | null
          reason?: string | null
        }
        Relationships: []
      }
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
          attachments: Json
          carry_forward_from_year: string | null
          carry_forward_to_year: string | null
          client_id: string | null
          client_reply: string | null
          created_at: string | null
          due_date: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          group_name: string | null
          id: string
          internal_notes: string | null
          ledger_name: string | null
          priority: string
          query_text: string
          ref_number: string | null
          replied_via: string | null
          reply_method: string | null
          required_documents: string | null
          source: string
          source_ref_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          attachments?: Json
          carry_forward_from_year?: string | null
          carry_forward_to_year?: string | null
          client_id?: string | null
          client_reply?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          group_name?: string | null
          id?: string
          internal_notes?: string | null
          ledger_name?: string | null
          priority?: string
          query_text: string
          ref_number?: string | null
          replied_via?: string | null
          reply_method?: string | null
          required_documents?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          attachments?: Json
          carry_forward_from_year?: string | null
          carry_forward_to_year?: string | null
          client_id?: string | null
          client_reply?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          group_name?: string | null
          id?: string
          internal_notes?: string | null
          ledger_name?: string | null
          priority?: string
          query_text?: string
          ref_number?: string | null
          replied_via?: string | null
          reply_method?: string | null
          required_documents?: string | null
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
      audit_communication: {
        Row: {
          audit_planned_from: string | null
          audit_planned_to: string | null
          client_name: string | null
          contact_no: string | null
          contact_person: string | null
          created_at: string | null
          firm_id: string | null
          id: string
          planning_id: string | null
          remarks: string | null
        }
        Insert: {
          audit_planned_from?: string | null
          audit_planned_to?: string | null
          client_name?: string | null
          contact_no?: string | null
          contact_person?: string | null
          created_at?: string | null
          firm_id?: string | null
          id?: string
          planning_id?: string | null
          remarks?: string | null
        }
        Update: {
          audit_planned_from?: string | null
          audit_planned_to?: string | null
          client_name?: string | null
          contact_no?: string | null
          contact_person?: string | null
          created_at?: string | null
          firm_id?: string | null
          id?: string
          planning_id?: string | null
          remarks?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_communication_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_communication_planning_id_fkey"
            columns: ["planning_id"]
            isOneToOne: false
            referencedRelation: "audit_planning"
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
          cash_flow_applicable: boolean | null
          cash_flow_method: string | null
          client_id: string | null
          coa_mapping: Json | null
          entity_type: string | null
          entity_type_logic: string | null
          final_locked: boolean | null
          finalized_at: string | null
          finalized_by: string | null
          financial_year: string | null
          firm_id: string | null
          form_3ca_act_other_text: string | null
          form_3ca_applicable_act: string | null
          form_3ca_paragraphs: Json | null
          form_3ca_report_date: string | null
          form_3ca_signature_date: string | null
          form_3ca_udin: string | null
          form_3cb_paragraphs: Json | null
          form_3cb_signature_date: string | null
          form_3cb_udin: string | null
          form_3cd: Json | null
          fs_preparation_mode: string | null
          id: string
          ifc_applicable: boolean | null
          is_finalized: boolean
          is_py_shell: boolean
          manager_id: string | null
          materiality: Json | null
          notes_finalized: boolean | null
          notes_finalized_at: string | null
          notes_to_accounts: Json | null
          parent_engagement_id: string | null
          partner_id: string | null
          partner_membership_no: string | null
          partner_name: string | null
          period_label: string | null
          pipeline_stage: number | null
          planned_end: string | null
          planned_start: string | null
          preliminary_complete: boolean | null
          prior_year_tb_imported_at: string | null
          prior_year_tb_snapshot: Json | null
          py_manual_amounts: Json
          py_manual_annexures: Json
          py_setup_completed: boolean
          py_source: string | null
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
          stage5_notes: Json | null
          stage7_ratios: Json | null
          stage8_nta_data: Json | null
          status: string | null
          tb_node_overrides: Json | null
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
          cash_flow_applicable?: boolean | null
          cash_flow_method?: string | null
          client_id?: string | null
          coa_mapping?: Json | null
          entity_type?: string | null
          entity_type_logic?: string | null
          final_locked?: boolean | null
          finalized_at?: string | null
          finalized_by?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3ca_act_other_text?: string | null
          form_3ca_applicable_act?: string | null
          form_3ca_paragraphs?: Json | null
          form_3ca_report_date?: string | null
          form_3ca_signature_date?: string | null
          form_3ca_udin?: string | null
          form_3cb_paragraphs?: Json | null
          form_3cb_signature_date?: string | null
          form_3cb_udin?: string | null
          form_3cd?: Json | null
          fs_preparation_mode?: string | null
          id?: string
          ifc_applicable?: boolean | null
          is_finalized?: boolean
          is_py_shell?: boolean
          manager_id?: string | null
          materiality?: Json | null
          notes_finalized?: boolean | null
          notes_finalized_at?: string | null
          notes_to_accounts?: Json | null
          parent_engagement_id?: string | null
          partner_id?: string | null
          partner_membership_no?: string | null
          partner_name?: string | null
          period_label?: string | null
          pipeline_stage?: number | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          prior_year_tb_imported_at?: string | null
          prior_year_tb_snapshot?: Json | null
          py_manual_amounts?: Json
          py_manual_annexures?: Json
          py_setup_completed?: boolean
          py_source?: string | null
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
          stage5_notes?: Json | null
          stage7_ratios?: Json | null
          stage8_nta_data?: Json | null
          status?: string | null
          tb_node_overrides?: Json | null
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
          cash_flow_applicable?: boolean | null
          cash_flow_method?: string | null
          client_id?: string | null
          coa_mapping?: Json | null
          entity_type?: string | null
          entity_type_logic?: string | null
          final_locked?: boolean | null
          finalized_at?: string | null
          finalized_by?: string | null
          financial_year?: string | null
          firm_id?: string | null
          form_3ca_act_other_text?: string | null
          form_3ca_applicable_act?: string | null
          form_3ca_paragraphs?: Json | null
          form_3ca_report_date?: string | null
          form_3ca_signature_date?: string | null
          form_3ca_udin?: string | null
          form_3cb_paragraphs?: Json | null
          form_3cb_signature_date?: string | null
          form_3cb_udin?: string | null
          form_3cd?: Json | null
          fs_preparation_mode?: string | null
          id?: string
          ifc_applicable?: boolean | null
          is_finalized?: boolean
          is_py_shell?: boolean
          manager_id?: string | null
          materiality?: Json | null
          notes_finalized?: boolean | null
          notes_finalized_at?: string | null
          notes_to_accounts?: Json | null
          parent_engagement_id?: string | null
          partner_id?: string | null
          partner_membership_no?: string | null
          partner_name?: string | null
          period_label?: string | null
          pipeline_stage?: number | null
          planned_end?: string | null
          planned_start?: string | null
          preliminary_complete?: boolean | null
          prior_year_tb_imported_at?: string | null
          prior_year_tb_snapshot?: Json | null
          py_manual_amounts?: Json
          py_manual_annexures?: Json
          py_setup_completed?: boolean
          py_source?: string | null
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
          stage5_notes?: Json | null
          stage7_ratios?: Json | null
          stage8_nta_data?: Json | null
          status?: string | null
          tb_node_overrides?: Json | null
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
      audit_planning: {
        Row: {
          client_id: string | null
          client_name: string | null
          created_at: string | null
          created_by: string | null
          employee_ids: string[] | null
          employee_names: string[] | null
          firm_id: string | null
          id: string
          is_leave: boolean
          planned_from: string
          planned_to: string
        }
        Insert: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          employee_ids?: string[] | null
          employee_names?: string[] | null
          firm_id?: string | null
          id?: string
          is_leave?: boolean
          planned_from: string
          planned_to: string
        }
        Update: {
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          created_by?: string | null
          employee_ids?: string[] | null
          employee_names?: string[] | null
          firm_id?: string | null
          id?: string
          is_leave?: boolean
          planned_from?: string
          planned_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_planning_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_planning_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_planning_firm_id_fkey"
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
      audit_status: {
        Row: {
          accounting_data: string | null
          audit_employees: string | null
          audit_report_checked_by: string | null
          audit_report_prepared_by: string | null
          audit_status: string | null
          audit_status_other: string | null
          checked_by: string | null
          client_id: string | null
          created_at: string | null
          engagement_id: string | null
          financial_year: string | null
          firm: string | null
          firm_id: string | null
          id: string
          partner: string | null
          party_name: string | null
          physical_audit_conducted: string | null
          physical_report_received_date: string | null
          prepared_by: string | null
          remarks: string | null
          report_print_date: string | null
          scanned: string | null
          udin_date: string | null
          udin_statutory_audit: string | null
          udin_tax_audit: string | null
          uploaded_by: string | null
        }
        Insert: {
          accounting_data?: string | null
          audit_employees?: string | null
          audit_report_checked_by?: string | null
          audit_report_prepared_by?: string | null
          audit_status?: string | null
          audit_status_other?: string | null
          checked_by?: string | null
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm?: string | null
          firm_id?: string | null
          id?: string
          partner?: string | null
          party_name?: string | null
          physical_audit_conducted?: string | null
          physical_report_received_date?: string | null
          prepared_by?: string | null
          remarks?: string | null
          report_print_date?: string | null
          scanned?: string | null
          udin_date?: string | null
          udin_statutory_audit?: string | null
          udin_tax_audit?: string | null
          uploaded_by?: string | null
        }
        Update: {
          accounting_data?: string | null
          audit_employees?: string | null
          audit_report_checked_by?: string | null
          audit_report_prepared_by?: string | null
          audit_status?: string | null
          audit_status_other?: string | null
          checked_by?: string | null
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm?: string | null
          firm_id?: string | null
          id?: string
          partner?: string | null
          party_name?: string | null
          physical_audit_conducted?: string | null
          physical_report_received_date?: string | null
          prepared_by?: string | null
          remarks?: string | null
          report_print_date?: string | null
          scanned?: string | null
          udin_date?: string | null
          udin_statutory_audit?: string | null
          udin_tax_audit?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_status_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_status_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_status_firm_id_fkey"
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
      audit_worksheet_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          engagement_id: string
          field_name: string | null
          id: string
          new_value: string | null
          old_value: string | null
          page_label: string | null
          section_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          engagement_id: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          page_label?: string | null
          section_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          engagement_id?: string
          field_name?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          page_label?: string | null
          section_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_worksheet_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_worksheet_history_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_worksheet_items: {
        Row: {
          assigned_name: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string | null
          due_date: string | null
          engagement_id: string
          firm_id: string | null
          id: string
          is_done: boolean | null
          particulars: string | null
          priority: string | null
          remarks: string | null
          sheet_type: string
          sr_no: number | null
          status: string | null
          updated_at: string | null
          work_done: string | null
        }
        Insert: {
          assigned_name?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id: string
          firm_id?: string | null
          id?: string
          is_done?: boolean | null
          particulars?: string | null
          priority?: string | null
          remarks?: string | null
          sheet_type: string
          sr_no?: number | null
          status?: string | null
          updated_at?: string | null
          work_done?: string | null
        }
        Update: {
          assigned_name?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string | null
          due_date?: string | null
          engagement_id?: string
          firm_id?: string | null
          id?: string
          is_done?: boolean | null
          particulars?: string | null
          priority?: string | null
          remarks?: string | null
          sheet_type?: string
          sr_no?: number | null
          status?: string | null
          updated_at?: string | null
          work_done?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_worksheet_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_worksheet_items_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_worksheet_items_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_worksheet_master: {
        Row: {
          checklist_sheet_json: Json | null
          created_at: string | null
          engagement_id: string
          firm_id: string | null
          id: string
          int_address: string | null
          int_audit_firm: string | null
          int_client_name: string | null
          int_entity_type: string | null
          int_financial_year: string | null
          int_master_json: Json | null
          int_methodology: string | null
          int_objectives: string | null
          int_pan: string | null
          int_partner_name: string | null
          int_period_from: string | null
          int_period_label: string | null
          int_period_to: string | null
          int_scope: string | null
          int_team_members: string | null
          queries_notes: string | null
          queries_verified: boolean | null
          queries_verified_at: string | null
          queries_verified_by: string | null
          query_sheet_json: Json | null
          special_attention_json: Json | null
          statutory_master_json: Json | null
          tax_accounting_method: string | null
          tax_address: string | null
          tax_auditor_address: string | null
          tax_auditor_firm: string | null
          tax_cin: string | null
          tax_client_name: string | null
          tax_entity_type: string | null
          tax_financial_year: string | null
          tax_form_type: string | null
          tax_gstin: string | null
          tax_icai_reg: string | null
          tax_master_json: Json | null
          tax_pan: string | null
          tax_partner_icai: string | null
          tax_partner_name: string | null
          tax_period_from: string | null
          tax_period_to: string | null
          tax_prev_year_from: string | null
          tax_prev_year_to: string | null
          tax_remarks: string | null
          tax_section: string | null
          tax_turnover: number | null
          tax_udin: string | null
          updated_at: string | null
          worksheet_json: Json | null
        }
        Insert: {
          checklist_sheet_json?: Json | null
          created_at?: string | null
          engagement_id: string
          firm_id?: string | null
          id?: string
          int_address?: string | null
          int_audit_firm?: string | null
          int_client_name?: string | null
          int_entity_type?: string | null
          int_financial_year?: string | null
          int_master_json?: Json | null
          int_methodology?: string | null
          int_objectives?: string | null
          int_pan?: string | null
          int_partner_name?: string | null
          int_period_from?: string | null
          int_period_label?: string | null
          int_period_to?: string | null
          int_scope?: string | null
          int_team_members?: string | null
          queries_notes?: string | null
          queries_verified?: boolean | null
          queries_verified_at?: string | null
          queries_verified_by?: string | null
          query_sheet_json?: Json | null
          special_attention_json?: Json | null
          statutory_master_json?: Json | null
          tax_accounting_method?: string | null
          tax_address?: string | null
          tax_auditor_address?: string | null
          tax_auditor_firm?: string | null
          tax_cin?: string | null
          tax_client_name?: string | null
          tax_entity_type?: string | null
          tax_financial_year?: string | null
          tax_form_type?: string | null
          tax_gstin?: string | null
          tax_icai_reg?: string | null
          tax_master_json?: Json | null
          tax_pan?: string | null
          tax_partner_icai?: string | null
          tax_partner_name?: string | null
          tax_period_from?: string | null
          tax_period_to?: string | null
          tax_prev_year_from?: string | null
          tax_prev_year_to?: string | null
          tax_remarks?: string | null
          tax_section?: string | null
          tax_turnover?: number | null
          tax_udin?: string | null
          updated_at?: string | null
          worksheet_json?: Json | null
        }
        Update: {
          checklist_sheet_json?: Json | null
          created_at?: string | null
          engagement_id?: string
          firm_id?: string | null
          id?: string
          int_address?: string | null
          int_audit_firm?: string | null
          int_client_name?: string | null
          int_entity_type?: string | null
          int_financial_year?: string | null
          int_master_json?: Json | null
          int_methodology?: string | null
          int_objectives?: string | null
          int_pan?: string | null
          int_partner_name?: string | null
          int_period_from?: string | null
          int_period_label?: string | null
          int_period_to?: string | null
          int_scope?: string | null
          int_team_members?: string | null
          queries_notes?: string | null
          queries_verified?: boolean | null
          queries_verified_at?: string | null
          queries_verified_by?: string | null
          query_sheet_json?: Json | null
          special_attention_json?: Json | null
          statutory_master_json?: Json | null
          tax_accounting_method?: string | null
          tax_address?: string | null
          tax_auditor_address?: string | null
          tax_auditor_firm?: string | null
          tax_cin?: string | null
          tax_client_name?: string | null
          tax_entity_type?: string | null
          tax_financial_year?: string | null
          tax_form_type?: string | null
          tax_gstin?: string | null
          tax_icai_reg?: string | null
          tax_master_json?: Json | null
          tax_pan?: string | null
          tax_partner_icai?: string | null
          tax_partner_name?: string | null
          tax_period_from?: string | null
          tax_period_to?: string | null
          tax_prev_year_from?: string | null
          tax_prev_year_to?: string | null
          tax_remarks?: string | null
          tax_section?: string | null
          tax_turnover?: number | null
          tax_udin?: string | null
          updated_at?: string | null
          worksheet_json?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_worksheet_master_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_worksheet_master_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_worksheet_master_queries_verified_by_fkey"
            columns: ["queries_verified_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      billing_doc_sequences: {
        Row: {
          document_series: string
          financial_year: string
          firm_id: string
          last_seq: number
        }
        Insert: {
          document_series: string
          financial_year: string
          firm_id: string
          last_seq?: number
        }
        Update: {
          document_series?: string
          financial_year?: string
          firm_id?: string
          last_seq?: number
        }
        Relationships: []
      }
      billing_kasars: {
        Row: {
          amount: number
          client_id: string
          created_at: string | null
          created_by: string | null
          financial_year: string | null
          firm_id: string
          id: string
          invoice_id: string | null
          kasar_date: string
          narration: string | null
        }
        Insert: {
          amount: number
          client_id: string
          created_at?: string | null
          created_by?: string | null
          financial_year?: string | null
          firm_id: string
          id?: string
          invoice_id?: string | null
          kasar_date: string
          narration?: string | null
        }
        Update: {
          amount?: number
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          financial_year?: string | null
          firm_id?: string
          id?: string
          invoice_id?: string | null
          kasar_date?: string
          narration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_kasars_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_kasars_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_kasars_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_kasars_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_receipt_allocations: {
        Row: {
          amount: number
          created_at: string | null
          id: string
          invoice_id: string
          receipt_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          id?: string
          invoice_id: string
          receipt_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          id?: string
          invoice_id?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_receipt_allocations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_receipt_allocations_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "billing_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_receipts: {
        Row: {
          amount_received: number
          client_id: string
          created_at: string | null
          created_by: string | null
          firm_id: string
          gst_tds_amount: number | null
          gstin: string | null
          id: string
          invoice_id: string | null
          payment_mode: string
          payment_reference: string | null
          receipt_date: string
          receipt_type: string
          remarks: string | null
          tds_amount: number | null
          tds_date: string | null
        }
        Insert: {
          amount_received: number
          client_id: string
          created_at?: string | null
          created_by?: string | null
          firm_id: string
          gst_tds_amount?: number | null
          gstin?: string | null
          id?: string
          invoice_id?: string | null
          payment_mode: string
          payment_reference?: string | null
          receipt_date: string
          receipt_type: string
          remarks?: string | null
          tds_amount?: number | null
          tds_date?: string | null
        }
        Update: {
          amount_received?: number
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          firm_id?: string
          gst_tds_amount?: number | null
          gstin?: string | null
          id?: string
          invoice_id?: string | null
          payment_mode?: string
          payment_reference?: string | null
          receipt_date?: string
          receipt_type?: string
          remarks?: string | null
          tds_amount?: number | null
          tds_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_receipts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_receipts_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_receipts_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_reminder_rules: {
        Row: {
          auto_send: boolean | null
          created_at: string | null
          created_by: string | null
          day_of_month: number | null
          filter_groups: Json | null
          filter_status: string | null
          firm_id: string | null
          frequency: string | null
          id: string
          is_active: boolean | null
          last_run_at: string | null
          name: string
          rule_type: string
          send_to_client: boolean | null
          send_to_responsible: boolean | null
          template_type: string | null
          trigger_days: number | null
          trigger_direction: string | null
          updated_at: string | null
        }
        Insert: {
          auto_send?: boolean | null
          created_at?: string | null
          created_by?: string | null
          day_of_month?: number | null
          filter_groups?: Json | null
          filter_status?: string | null
          firm_id?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name: string
          rule_type?: string
          send_to_client?: boolean | null
          send_to_responsible?: boolean | null
          template_type?: string | null
          trigger_days?: number | null
          trigger_direction?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_send?: boolean | null
          created_at?: string | null
          created_by?: string | null
          day_of_month?: number | null
          filter_groups?: Json | null
          filter_status?: string | null
          firm_id?: string | null
          frequency?: string | null
          id?: string
          is_active?: boolean | null
          last_run_at?: string | null
          name?: string
          rule_type?: string
          send_to_client?: boolean | null
          send_to_responsible?: boolean | null
          template_type?: string | null
          trigger_days?: number | null
          trigger_direction?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_reminder_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reminder_rules_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_reminders: {
        Row: {
          billing_amount: number
          client_id: string
          created_at: string | null
          firm_id: string
          frequency: string
          id: string
          invoice_gen_type: string
          last_invoice_id: string | null
          next_due_date: string | null
          package_id: string | null
          reminder_date: number | null
          service_category_id: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          billing_amount: number
          client_id: string
          created_at?: string | null
          firm_id: string
          frequency: string
          id?: string
          invoice_gen_type?: string
          last_invoice_id?: string | null
          next_due_date?: string | null
          package_id?: string | null
          reminder_date?: number | null
          service_category_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          billing_amount?: number
          client_id?: string
          created_at?: string | null
          firm_id?: string
          frequency?: string
          id?: string
          invoice_gen_type?: string
          last_invoice_id?: string | null
          next_due_date?: string | null
          package_id?: string | null
          reminder_date?: number | null
          service_category_id?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_reminders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reminders_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reminders_last_invoice_id_fkey"
            columns: ["last_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reminders_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "client_service_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_reminders_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      caro_master_templates: {
        Row: {
          clause_number: number
          clause_title: string | null
          default_content: string | null
          firm_id: string | null
          id: string
          is_applicable_default: boolean | null
          updated_at: string | null
        }
        Insert: {
          clause_number: number
          clause_title?: string | null
          default_content?: string | null
          firm_id?: string | null
          id?: string
          is_applicable_default?: boolean | null
          updated_at?: string | null
        }
        Update: {
          clause_number?: number
          clause_title?: string | null
          default_content?: string | null
          firm_id?: string | null
          id?: string
          is_applicable_default?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "caro_master_templates_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
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
      client_billing_opening_balances: {
        Row: {
          amount: number
          balance_date: string
          client_id: string
          created_at: string | null
          created_by: string | null
          firm_id: string
          gstin: string | null
          id: string
          narration: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number
          balance_date: string
          client_id: string
          created_at?: string | null
          created_by?: string | null
          firm_id: string
          gstin?: string | null
          id?: string
          narration?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          balance_date?: string
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          firm_id?: string
          gstin?: string | null
          id?: string
          narration?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_billing_opening_balances_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_billing_opening_balances_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_billing_opening_balances_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      client_classification_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          client_id: string
          effective_from_fy: string
          id: string
          new_classification: string
          notes: string | null
          old_classification: string | null
          previous_classification: string | null
          responsible_person: string | null
          responsible_person_id: string | null
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          client_id: string
          effective_from_fy: string
          id?: string
          new_classification: string
          notes?: string | null
          old_classification?: string | null
          previous_classification?: string | null
          responsible_person?: string | null
          responsible_person_id?: string | null
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          client_id?: string
          effective_from_fy?: string
          id?: string
          new_classification?: string
          notes?: string | null
          old_classification?: string | null
          previous_classification?: string | null
          responsible_person?: string | null
          responsible_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_classification_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_fy_audit_setup: {
        Row: {
          audit_billing_amount: number | null
          caro_applicable: boolean
          client_id: string
          created_at: string | null
          financial_year: string
          id: string
          internal_audit_applicable: boolean
          statutory_audit_applicable: boolean
          stock_audit_applicable: boolean
          tax_audit_applicable: boolean
          updated_at: string | null
        }
        Insert: {
          audit_billing_amount?: number | null
          caro_applicable?: boolean
          client_id: string
          created_at?: string | null
          financial_year: string
          id?: string
          internal_audit_applicable?: boolean
          statutory_audit_applicable?: boolean
          stock_audit_applicable?: boolean
          tax_audit_applicable?: boolean
          updated_at?: string | null
        }
        Update: {
          audit_billing_amount?: number | null
          caro_applicable?: boolean
          client_id?: string
          created_at?: string | null
          financial_year?: string
          id?: string
          internal_audit_applicable?: boolean
          statutory_audit_applicable?: boolean
          stock_audit_applicable?: boolean
          tax_audit_applicable?: boolean
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_fy_audit_setup_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_fy_classifications: {
        Row: {
          audit_firm_id: string | null
          classification: string
          client_id: string
          created_at: string | null
          financial_year: string
          firm_id: string | null
          id: string
          responsible_person_id: string | null
          updated_at: string | null
        }
        Insert: {
          audit_firm_id?: string | null
          classification: string
          client_id: string
          created_at?: string | null
          financial_year: string
          firm_id?: string | null
          id?: string
          responsible_person_id?: string | null
          updated_at?: string | null
        }
        Update: {
          audit_firm_id?: string | null
          classification?: string
          client_id?: string
          created_at?: string | null
          financial_year?: string
          firm_id?: string | null
          id?: string
          responsible_person_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_fy_classifications_audit_firm_id_fkey"
            columns: ["audit_firm_id"]
            isOneToOne: false
            referencedRelation: "audit_firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_fy_classifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_fy_classifications_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
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
          firm_id: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id?: string | null
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
      client_ledger_entries: {
        Row: {
          balance: number
          client_id: string
          created_at: string | null
          credit_amount: number
          debit_amount: number
          document_id: string | null
          entry_date: string
          entry_type: string
          financial_year: string | null
          firm_id: string
          id: string
          narration: string | null
        }
        Insert: {
          balance?: number
          client_id: string
          created_at?: string | null
          credit_amount?: number
          debit_amount?: number
          document_id?: string | null
          entry_date: string
          entry_type: string
          financial_year?: string | null
          firm_id: string
          id?: string
          narration?: string | null
        }
        Update: {
          balance?: number
          client_id?: string
          created_at?: string | null
          credit_amount?: number
          debit_amount?: number
          document_id?: string | null
          entry_date?: string
          entry_type?: string
          financial_year?: string | null
          firm_id?: string
          id?: string
          narration?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_ledger_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_ledger_entries_firm_id_fkey"
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
          client_id: string | null
          id: string
        }
        Insert: {
          audit_questions?: Json | null
          client_id?: string | null
          id?: string
        }
        Update: {
          audit_questions?: Json | null
          client_id?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_service_packages: {
        Row: {
          billing_amount: number | null
          client_id: string
          created_at: string | null
          frequency: string
          id: string
          invoice_gen_type: string
          is_active: boolean
          package_name: string
          reminder_date: number | null
          service_category_ids: Json
          updated_at: string | null
        }
        Insert: {
          billing_amount?: number | null
          client_id: string
          created_at?: string | null
          frequency: string
          id?: string
          invoice_gen_type?: string
          is_active?: boolean
          package_name: string
          reminder_date?: number | null
          service_category_ids?: Json
          updated_at?: string | null
        }
        Update: {
          billing_amount?: number | null
          client_id?: string
          created_at?: string | null
          frequency?: string
          id?: string
          invoice_gen_type?: string
          is_active?: boolean
          package_name?: string
          reminder_date?: number | null
          service_category_ids?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_service_packages_client_id_fkey"
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
          billing_amount: number | null
          billing_mode: string | null
          client_id: string
          deactivated_at: string | null
          due_date_override: number | null
          fee_override: number | null
          frequency_override: string | null
          id: string
          invoice_gen_type: string | null
          is_active: boolean
          notes: string | null
          reminder_date: number | null
          service_category_id: string
          tds_deactivated_from_fy: string | null
          tds_deactivated_from_q: string | null
          tds_effective_from_fy: string | null
          tds_effective_from_q: string | null
          tds_end_fy: string | null
          tds_end_quarter: string | null
          tds_forms_applicable: string[] | null
        }
        Insert: {
          activated_at?: string | null
          assigned_staff?: Json | null
          billing_amount?: number | null
          billing_mode?: string | null
          client_id: string
          deactivated_at?: string | null
          due_date_override?: number | null
          fee_override?: number | null
          frequency_override?: string | null
          id?: string
          invoice_gen_type?: string | null
          is_active?: boolean
          notes?: string | null
          reminder_date?: number | null
          service_category_id: string
          tds_deactivated_from_fy?: string | null
          tds_deactivated_from_q?: string | null
          tds_effective_from_fy?: string | null
          tds_effective_from_q?: string | null
          tds_end_fy?: string | null
          tds_end_quarter?: string | null
          tds_forms_applicable?: string[] | null
        }
        Update: {
          activated_at?: string | null
          assigned_staff?: Json | null
          billing_amount?: number | null
          billing_mode?: string | null
          client_id?: string
          deactivated_at?: string | null
          due_date_override?: number | null
          fee_override?: number | null
          frequency_override?: string | null
          id?: string
          invoice_gen_type?: string | null
          is_active?: boolean
          notes?: string | null
          reminder_date?: number | null
          service_category_id?: string
          tds_deactivated_from_fy?: string | null
          tds_deactivated_from_q?: string | null
          tds_effective_from_fy?: string | null
          tds_effective_from_q?: string | null
          tds_end_fy?: string | null
          tds_end_quarter?: string | null
          tds_forms_applicable?: string[] | null
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
          address: string | null
          audit_config: Json | null
          audit_turnover: number | null
          business_activity: string | null
          caro_applicable: boolean | null
          cin: string | null
          classification: string | null
          client_classification: Json | null
          compliance_flags: Json | null
          contact_person: string | null
          created_at: string | null
          customer_id: string | null
          date_of_incorporation: string | null
          deleted_at: string | null
          deleted_reason: string | null
          directors: Json | null
          dsc_expiry_date: string | null
          dsc_number: string | null
          email: string | null
          entity_type: string | null
          firm_id: string | null
          gstin: string[] | null
          gstin_addresses: Json
          gstin_states: Json
          id: string
          internal_audit_applicable: boolean | null
          is_active: boolean | null
          is_draft: boolean
          mobile: string | null
          name: string | null
          pan: string | null
          registered_office: string | null
          registered_state: string | null
          responsible_person_id: string | null
          source: string
          statutory_audit_applicable: boolean | null
          stock_audit_applicable: boolean | null
          tally_company_name: string | null
          tan_number: string | null
          tax_audit_applicable: boolean
          tax_audit_type: string | null
          user_id: string | null
          work_group_type: string | null
        }
        Insert: {
          address?: string | null
          audit_config?: Json | null
          audit_turnover?: number | null
          business_activity?: string | null
          caro_applicable?: boolean | null
          cin?: string | null
          classification?: string | null
          client_classification?: Json | null
          compliance_flags?: Json | null
          contact_person?: string | null
          created_at?: string | null
          customer_id?: string | null
          date_of_incorporation?: string | null
          deleted_at?: string | null
          deleted_reason?: string | null
          directors?: Json | null
          dsc_expiry_date?: string | null
          dsc_number?: string | null
          email?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          gstin_addresses?: Json
          gstin_states?: Json
          id?: string
          internal_audit_applicable?: boolean | null
          is_active?: boolean | null
          is_draft?: boolean
          mobile?: string | null
          name?: string | null
          pan?: string | null
          registered_office?: string | null
          registered_state?: string | null
          responsible_person_id?: string | null
          source?: string
          statutory_audit_applicable?: boolean | null
          stock_audit_applicable?: boolean | null
          tally_company_name?: string | null
          tan_number?: string | null
          tax_audit_applicable?: boolean
          tax_audit_type?: string | null
          user_id?: string | null
          work_group_type?: string | null
        }
        Update: {
          address?: string | null
          audit_config?: Json | null
          audit_turnover?: number | null
          business_activity?: string | null
          caro_applicable?: boolean | null
          cin?: string | null
          classification?: string | null
          client_classification?: Json | null
          compliance_flags?: Json | null
          contact_person?: string | null
          created_at?: string | null
          customer_id?: string | null
          date_of_incorporation?: string | null
          deleted_at?: string | null
          deleted_reason?: string | null
          directors?: Json | null
          dsc_expiry_date?: string | null
          dsc_number?: string | null
          email?: string | null
          entity_type?: string | null
          firm_id?: string | null
          gstin?: string[] | null
          gstin_addresses?: Json
          gstin_states?: Json
          id?: string
          internal_audit_applicable?: boolean | null
          is_active?: boolean | null
          is_draft?: boolean
          mobile?: string | null
          name?: string | null
          pan?: string | null
          registered_office?: string | null
          registered_state?: string | null
          responsible_person_id?: string | null
          source?: string
          statutory_audit_applicable?: boolean | null
          stock_audit_applicable?: boolean | null
          tally_company_name?: string | null
          tan_number?: string | null
          tax_audit_applicable?: boolean
          tax_audit_type?: string | null
          user_id?: string | null
          work_group_type?: string | null
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
            foreignKeyName: "clients_responsible_person_id_fkey"
            columns: ["responsible_person_id"]
            isOneToOne: false
            referencedRelation: "users"
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
      coa_alias_index: {
        Row: {
          account_head: string
          alias_normalized: string
          canonical_id: string
          confidence_score: number
          created_at: string
          entity_type: string
          id: string
          reason_type: string
        }
        Insert: {
          account_head: string
          alias_normalized: string
          canonical_id: string
          confidence_score?: number
          created_at?: string
          entity_type: string
          id?: string
          reason_type: string
        }
        Update: {
          account_head?: string
          alias_normalized?: string
          canonical_id?: string
          confidence_score?: number
          created_at?: string
          entity_type?: string
          id?: string
          reason_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "coa_alias_index_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "coa_mapping_intelligence"
            referencedColumns: ["id"]
          },
        ]
      }
      coa_mapping_intelligence: {
        Row: {
          account_group: string | null
          account_head: string
          ai_analysis: string | null
          ai_analyzed_at: string | null
          aliases: Json | null
          alternatives: Json
          bs_pl: string | null
          client_id: string | null
          confidence_score: number
          created_at: string
          entity_type: string
          firms_affected: number
          id: string
          is_party_name: boolean
          last_engagement_id: string | null
          last_firm_id: string | null
          last_used_at: string
          normalized_name: string
          override_reason: string | null
          scope: string
          times_confirmed: number
          times_overridden: number
          updated_at: string
        }
        Insert: {
          account_group?: string | null
          account_head: string
          ai_analysis?: string | null
          ai_analyzed_at?: string | null
          aliases?: Json | null
          alternatives?: Json
          bs_pl?: string | null
          client_id?: string | null
          confidence_score?: number
          created_at?: string
          entity_type: string
          firms_affected?: number
          id?: string
          is_party_name?: boolean
          last_engagement_id?: string | null
          last_firm_id?: string | null
          last_used_at?: string
          normalized_name: string
          override_reason?: string | null
          scope?: string
          times_confirmed?: number
          times_overridden?: number
          updated_at?: string
        }
        Update: {
          account_group?: string | null
          account_head?: string
          ai_analysis?: string | null
          ai_analyzed_at?: string | null
          aliases?: Json | null
          alternatives?: Json
          bs_pl?: string | null
          client_id?: string | null
          confidence_score?: number
          created_at?: string
          entity_type?: string
          firms_affected?: number
          id?: string
          is_party_name?: boolean
          last_engagement_id?: string | null
          last_firm_id?: string | null
          last_used_at?: string
          normalized_name?: string
          override_reason?: string | null
          scope?: string
          times_confirmed?: number
          times_overridden?: number
          updated_at?: string
        }
        Relationships: []
      }
      coa_mapping_rules: {
        Row: {
          active: boolean
          client_id: string | null
          created_at: string
          created_by: string | null
          entity_type: string | null
          firm_id: string
          fs_code: string
          fs_name: string | null
          id: string
          match_type: string
          match_value: string
          note: string | null
          priority: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_type?: string | null
          firm_id: string
          fs_code: string
          fs_name?: string | null
          id?: string
          match_type?: string
          match_value: string
          note?: string | null
          priority?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          entity_type?: string | null
          firm_id?: string
          fs_code?: string
          fs_name?: string | null
          id?: string
          match_type?: string
          match_value?: string
          note?: string | null
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coa_mapping_rules_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_mapping_rules_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      coa_mappings: {
        Row: {
          account_group: string | null
          alternatives: Json
          bs_pl: string | null
          confidence: number | null
          created_at: string
          engagement_id: string | null
          entity_type: string | null
          firm_id: string | null
          id: string
          ledger_id: string | null
          original_suggestion: string | null
          raw_ledger_name: string | null
          reasoning: string | null
          source: string | null
          standard_head: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          account_group?: string | null
          alternatives?: Json
          bs_pl?: string | null
          confidence?: number | null
          created_at?: string
          engagement_id?: string | null
          entity_type?: string | null
          firm_id?: string | null
          id?: string
          ledger_id?: string | null
          original_suggestion?: string | null
          raw_ledger_name?: string | null
          reasoning?: string | null
          source?: string | null
          standard_head?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          account_group?: string | null
          alternatives?: Json
          bs_pl?: string | null
          confidence?: number | null
          created_at?: string
          engagement_id?: string | null
          entity_type?: string | null
          firm_id?: string | null
          id?: string
          ledger_id?: string | null
          original_suggestion?: string | null
          raw_ledger_name?: string | null
          reasoning?: string | null
          source?: string | null
          standard_head?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coa_mappings_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coa_mappings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      coa_master: {
        Row: {
          account_code: string
          account_head: string
          account_type: string | null
          applicable_entities: string | null
          bs_pl: string | null
          created_at: string | null
          entity_type: string
          firm_id: string | null
          fs_line_item: string | null
          group_name: string | null
          id: string
          level: number
          major_group: string | null
          normal_balance: string | null
          note_no: string | null
          remarks: string | null
          sub_group: string | null
          tally_group_mapping: string | null
        }
        Insert: {
          account_code: string
          account_head: string
          account_type?: string | null
          applicable_entities?: string | null
          bs_pl?: string | null
          created_at?: string | null
          entity_type?: string
          firm_id?: string | null
          fs_line_item?: string | null
          group_name?: string | null
          id?: string
          level?: number
          major_group?: string | null
          normal_balance?: string | null
          note_no?: string | null
          remarks?: string | null
          sub_group?: string | null
          tally_group_mapping?: string | null
        }
        Update: {
          account_code?: string
          account_head?: string
          account_type?: string | null
          applicable_entities?: string | null
          bs_pl?: string | null
          created_at?: string | null
          entity_type?: string
          firm_id?: string | null
          fs_line_item?: string | null
          group_name?: string | null
          id?: string
          level?: number
          major_group?: string | null
          normal_balance?: string | null
          note_no?: string | null
          remarks?: string | null
          sub_group?: string | null
          tally_group_mapping?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coa_master_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      cse_portfolios: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          cse_user_id: string
          firm_id: string
          id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          cse_user_id: string
          firm_id: string
          id?: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          cse_user_id?: string
          firm_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cse_portfolios_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cse_portfolios_cse_user_id_fkey"
            columns: ["cse_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cse_portfolios_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      dbg: {
        Row: {
          cy_sum: number | null
          n_keys: number | null
          phase: string | null
          py_sum: number | null
        }
        Insert: {
          cy_sum?: number | null
          n_keys?: number | null
          phase?: string | null
          py_sum?: number | null
        }
        Update: {
          cy_sum?: number | null
          n_keys?: number | null
          phase?: string | null
          py_sum?: number | null
        }
        Relationships: []
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
      email_templates: {
        Row: {
          body_html: string
          created_at: string | null
          created_by: string | null
          firm_id: string | null
          id: string
          is_active: boolean | null
          name: string
          subject: string
          type: string
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          body_html: string
          created_at?: string | null
          created_by?: string | null
          firm_id?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          subject: string
          type: string
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          body_html?: string
          created_at?: string | null
          created_by?: string | null
          firm_id?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          subject?: string
          type?: string
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_templates_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_audit_log: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          changed_by_email: string | null
          changed_by_name: string | null
          engagement_id: string
          firm_id: string | null
          id: string
          snapshot: Json | null
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changed_by_name?: string | null
          engagement_id: string
          firm_id?: string | null
          id?: string
          snapshot?: Json | null
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_email?: string | null
          changed_by_name?: string | null
          engagement_id?: string
          firm_id?: string | null
          id?: string
          snapshot?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          client_id: string | null
          created_at: string | null
          engagement_type: string | null
          financial_year: string | null
          firm_id: string | null
          from_date: string | null
          id: string
          status: string | null
          to_date: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          engagement_type?: string | null
          financial_year?: string | null
          firm_id?: string | null
          from_date?: string | null
          id?: string
          status?: string | null
          to_date?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          engagement_type?: string | null
          financial_year?: string | null
          firm_id?: string | null
          from_date?: string | null
          id?: string
          status?: string | null
          to_date?: string | null
        }
        Relationships: []
      }
      fa_asset_additions: {
        Row: {
          addition_amount: number
          addition_date: string
          asset_id: string
          created_at: string | null
          created_by: string | null
          description: string | null
          entry_narration: string | null
          id: string
          invoice_no: string | null
          supplier: string | null
        }
        Insert: {
          addition_amount?: number
          addition_date: string
          asset_id: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entry_narration?: string | null
          id?: string
          invoice_no?: string | null
          supplier?: string | null
        }
        Update: {
          addition_amount?: number
          addition_date?: string
          asset_id?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          entry_narration?: string | null
          id?: string
          invoice_no?: string | null
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fa_asset_additions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fa_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fa_asset_additions_created_by_fkey"
            columns: ["created_by"]
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
          date_of_purchase: string | null
          dep_days_addition: number | null
          dep_days_opening: number | null
          dep_formula_json: Json | null
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
          is_finalized: boolean | null
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
          date_of_purchase?: string | null
          dep_days_addition?: number | null
          dep_days_opening?: number | null
          dep_formula_json?: Json | null
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
          is_finalized?: boolean | null
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
          date_of_purchase?: string | null
          dep_days_addition?: number | null
          dep_days_opening?: number | null
          dep_formula_json?: Json | null
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
          is_finalized?: boolean | null
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
          legal_name_changes: Json
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
          legal_name_changes?: Json
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
          legal_name_changes?: Json
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
      fix_report: {
        Row: {
          coa_cy: number | null
          coa_py: number | null
          detail: string | null
          eng: string | null
          note: string | null
          post_cy: number | null
          post_py: number | null
          status: string | null
        }
        Insert: {
          coa_cy?: number | null
          coa_py?: number | null
          detail?: string | null
          eng?: string | null
          note?: string | null
          post_cy?: number | null
          post_py?: number | null
          status?: string | null
        }
        Update: {
          coa_cy?: number | null
          coa_py?: number | null
          detail?: string | null
          eng?: string | null
          note?: string | null
          post_cy?: number | null
          post_py?: number | null
          status?: string | null
        }
        Relationships: []
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
      fs_reconciliation_log: {
        Row: {
          bs_face_cy: number | null
          bs_face_py: number | null
          changed_by: string | null
          code: string
          col: string | null
          created_at: string
          delta_cy: number | null
          delta_py: number | null
          engagement_id: string
          id: string
          note_total_cy: number | null
          note_total_py: number | null
          note_type: string
        }
        Insert: {
          bs_face_cy?: number | null
          bs_face_py?: number | null
          changed_by?: string | null
          code: string
          col?: string | null
          created_at?: string
          delta_cy?: number | null
          delta_py?: number | null
          engagement_id: string
          id?: string
          note_total_cy?: number | null
          note_total_py?: number | null
          note_type: string
        }
        Update: {
          bs_face_cy?: number | null
          bs_face_py?: number | null
          changed_by?: string | null
          code?: string
          col?: string | null
          created_at?: string
          delta_cy?: number | null
          delta_py?: number | null
          engagement_id?: string
          id?: string
          note_total_cy?: number | null
          note_total_py?: number | null
          note_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fs_reconciliation_log_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      iar_data: {
        Row: {
          audit_trail_text: string | null
          branch_text: string | null
          created_at: string | null
          emphasis_text: string | null
          emphasis_toggle: boolean | null
          engagement_id: string
          going_concern_std: boolean | null
          going_concern_text: string | null
          id: string
          kam_text: string | null
          kam_toggle: boolean | null
          litigation_rows: Json | null
          opinion_type: string
          qualification_para: string | null
          updated_at: string | null
        }
        Insert: {
          audit_trail_text?: string | null
          branch_text?: string | null
          created_at?: string | null
          emphasis_text?: string | null
          emphasis_toggle?: boolean | null
          engagement_id: string
          going_concern_std?: boolean | null
          going_concern_text?: string | null
          id?: string
          kam_text?: string | null
          kam_toggle?: boolean | null
          litigation_rows?: Json | null
          opinion_type?: string
          qualification_para?: string | null
          updated_at?: string | null
        }
        Update: {
          audit_trail_text?: string | null
          branch_text?: string | null
          created_at?: string | null
          emphasis_text?: string | null
          emphasis_toggle?: boolean | null
          engagement_id?: string
          going_concern_std?: boolean | null
          going_concern_text?: string | null
          id?: string
          kam_text?: string | null
          kam_toggle?: boolean | null
          litigation_rows?: Json | null
          opinion_type?: string
          qualification_para?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "iar_data_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
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
          amount_due: number | null
          amount_paid: number
          bank_details_snapshot: Json | null
          base_turnover: number | null
          client_id: string | null
          conversion_date: string | null
          converted_to_id: string | null
          created_by: string | null
          document_series: string
          document_type: string
          due_date: string | null
          exchange_rate: number | null
          export_currency: string | null
          financial_year: string | null
          firm_id: string
          footer_text: string | null
          from_address: string | null
          from_email: string | null
          from_firm_name: string | null
          from_gstin: string | null
          from_msme: string | null
          from_pan: string | null
          from_phone: string | null
          gst_amount: number | null
          id: string
          invoice_date: string | null
          invoice_format: string | null
          invoice_no: string | null
          invoice_type: string | null
          is_intra_state: boolean | null
          last_reminded_at: string | null
          line_items: Json | null
          lut_number: string | null
          notes: string | null
          paid_at: string | null
          payment_due_days: number | null
          payment_status: string | null
          payment_terms: string | null
          place_of_supply: string | null
          reference_no: string | null
          remarks_conditions: string | null
          sent_at: string | null
          seq_number: number | null
          show_logo: boolean | null
          signatory_name: string | null
          source_document_id: string | null
          status: string | null
          subject: string | null
          subtotal: number | null
          tds_amount: number | null
          tds_rate: number | null
          tds_section_code: string | null
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
          amount_due?: number | null
          amount_paid?: number
          bank_details_snapshot?: Json | null
          base_turnover?: number | null
          client_id?: string | null
          conversion_date?: string | null
          converted_to_id?: string | null
          created_by?: string | null
          document_series?: string
          document_type?: string
          due_date?: string | null
          exchange_rate?: number | null
          export_currency?: string | null
          financial_year?: string | null
          firm_id: string
          footer_text?: string | null
          from_address?: string | null
          from_email?: string | null
          from_firm_name?: string | null
          from_gstin?: string | null
          from_msme?: string | null
          from_pan?: string | null
          from_phone?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_format?: string | null
          invoice_no?: string | null
          invoice_type?: string | null
          is_intra_state?: boolean | null
          last_reminded_at?: string | null
          line_items?: Json | null
          lut_number?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_due_days?: number | null
          payment_status?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          reference_no?: string | null
          remarks_conditions?: string | null
          sent_at?: string | null
          seq_number?: number | null
          show_logo?: boolean | null
          signatory_name?: string | null
          source_document_id?: string | null
          status?: string | null
          subject?: string | null
          subtotal?: number | null
          tds_amount?: number | null
          tds_rate?: number | null
          tds_section_code?: string | null
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
          amount_due?: number | null
          amount_paid?: number
          bank_details_snapshot?: Json | null
          base_turnover?: number | null
          client_id?: string | null
          conversion_date?: string | null
          converted_to_id?: string | null
          created_by?: string | null
          document_series?: string
          document_type?: string
          due_date?: string | null
          exchange_rate?: number | null
          export_currency?: string | null
          financial_year?: string | null
          firm_id?: string
          footer_text?: string | null
          from_address?: string | null
          from_email?: string | null
          from_firm_name?: string | null
          from_gstin?: string | null
          from_msme?: string | null
          from_pan?: string | null
          from_phone?: string | null
          gst_amount?: number | null
          id?: string
          invoice_date?: string | null
          invoice_format?: string | null
          invoice_no?: string | null
          invoice_type?: string | null
          is_intra_state?: boolean | null
          last_reminded_at?: string | null
          line_items?: Json | null
          lut_number?: string | null
          notes?: string | null
          paid_at?: string | null
          payment_due_days?: number | null
          payment_status?: string | null
          payment_terms?: string | null
          place_of_supply?: string | null
          reference_no?: string | null
          remarks_conditions?: string | null
          sent_at?: string | null
          seq_number?: number | null
          show_logo?: boolean | null
          signatory_name?: string | null
          source_document_id?: string | null
          status?: string | null
          subject?: string | null
          subtotal?: number | null
          tds_amount?: number | null
          tds_rate?: number | null
          tds_section_code?: string | null
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
            foreignKeyName: "invoices_converted_to_id_fkey"
            columns: ["converted_to_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "invoices"
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
      itr_profile_history: {
        Row: {
          assessment_year: string
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          client_id: string
          field_name: string
          firm_id: string | null
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          assessment_year: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          client_id: string
          field_name: string
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          assessment_year?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          client_id?: string
          field_name?: string
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "itr_profile_history_client_id_fkey"
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
          checked_by: string | null
          client_id: string | null
          date_data_received: string | null
          date_filed: string | null
          filing_status: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          itr_form: string | null
          itr_work_group_id: string | null
          prepared_by: string | null
          remarks: string | null
          reviewed_by: string | null
          upload_by: string | null
        }
        Insert: {
          acknowledgment_no?: string | null
          ais_recon_data?: Json | null
          assessment_year?: string | null
          assigned_to?: string | null
          checked_by?: string | null
          client_id?: string | null
          date_data_received?: string | null
          date_filed?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
          itr_work_group_id?: string | null
          prepared_by?: string | null
          remarks?: string | null
          reviewed_by?: string | null
          upload_by?: string | null
        }
        Update: {
          acknowledgment_no?: string | null
          ais_recon_data?: Json | null
          assessment_year?: string | null
          assigned_to?: string | null
          checked_by?: string | null
          client_id?: string | null
          date_data_received?: string | null
          date_filed?: string | null
          filing_status?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          itr_form?: string | null
          itr_work_group_id?: string | null
          prepared_by?: string | null
          remarks?: string | null
          reviewed_by?: string | null
          upload_by?: string | null
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
            foreignKeyName: "itr_profiles_checked_by_fkey"
            columns: ["checked_by"]
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
          {
            foreignKeyName: "itr_profiles_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itr_profiles_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itr_profiles_upload_by_fkey"
            columns: ["upload_by"]
            isOneToOne: false
            referencedRelation: "users"
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
      ledger_aliases: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          current_ledger_name: string
          engagement_id: string | null
          firm_id: string | null
          id: string
          note: string | null
          prior_ledger_name: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          current_ledger_name: string
          engagement_id?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          prior_ledger_name: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          current_ledger_name?: string
          engagement_id?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          prior_ledger_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_aliases_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_aliases_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_aliases_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_aliases_firm_id_fkey"
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
      mrl_data: {
        Row: {
          clauses_json: Json
          engagement_id: string
          header_data: Json | null
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          clauses_json?: Json
          engagement_id: string
          header_data?: Json | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          clauses_json?: Json
          engagement_id?: string
          header_data?: Json | null
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mrl_data_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      msme_43b_attachments: {
        Row: {
          client_id: string
          content_hash: string | null
          created_at: string
          file_name: string
          firm_id: string | null
          id: string
          kind: string
          mime_type: string | null
          run_id: string | null
          size_bytes: number | null
          storage_path: string
          uploaded_by: string | null
          uploaded_by_name: string | null
        }
        Insert: {
          client_id: string
          content_hash?: string | null
          created_at?: string
          file_name: string
          firm_id?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          run_id?: string | null
          size_bytes?: number | null
          storage_path: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Update: {
          client_id?: string
          content_hash?: string | null
          created_at?: string
          file_name?: string
          firm_id?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          run_id?: string | null
          size_bytes?: number | null
          storage_path?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "msme_43b_attachments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_attachments_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_attachments_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "msme_43b_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      msme_43b_goldens: {
        Row: {
          blessed: Json
          client_id: string
          config: Json
          created_at: string
          cy_label: string
          cy_ledgers: Json
          firm_id: string | null
          fy_label: string | null
          fy_ledgers: Json
          id: string
          label: string
          signed_off_by: string | null
          signed_off_by_name: string | null
          vendor_gst_rates: Json
          vendor_windows: Json
        }
        Insert: {
          blessed: Json
          client_id: string
          config: Json
          created_at?: string
          cy_label: string
          cy_ledgers: Json
          firm_id?: string | null
          fy_label?: string | null
          fy_ledgers?: Json
          id?: string
          label: string
          signed_off_by?: string | null
          signed_off_by_name?: string | null
          vendor_gst_rates?: Json
          vendor_windows?: Json
        }
        Update: {
          blessed?: Json
          client_id?: string
          config?: Json
          created_at?: string
          cy_label?: string
          cy_ledgers?: Json
          firm_id?: string | null
          fy_label?: string | null
          fy_ledgers?: Json
          id?: string
          label?: string
          signed_off_by?: string | null
          signed_off_by_name?: string | null
          vendor_gst_rates?: Json
          vendor_windows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "msme_43b_goldens_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_goldens_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_goldens_signed_off_by_fkey"
            columns: ["signed_off_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      msme_43b_rule_changes: {
        Row: {
          changed_by: string | null
          changed_by_name: string | null
          client_id: string
          created_at: string
          firm_id: string | null
          from_value: Json | null
          id: string
          matched_after: number | null
          matched_before: number | null
          reason: string | null
          rule_key: string
          source_file: string | null
          to_value: Json | null
        }
        Insert: {
          changed_by?: string | null
          changed_by_name?: string | null
          client_id: string
          created_at?: string
          firm_id?: string | null
          from_value?: Json | null
          id?: string
          matched_after?: number | null
          matched_before?: number | null
          reason?: string | null
          rule_key: string
          source_file?: string | null
          to_value?: Json | null
        }
        Update: {
          changed_by?: string | null
          changed_by_name?: string | null
          client_id?: string
          created_at?: string
          firm_id?: string | null
          from_value?: Json | null
          id?: string
          matched_after?: number | null
          matched_before?: number | null
          reason?: string | null
          rule_key?: string
          source_file?: string | null
          to_value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "msme_43b_rule_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_rule_changes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_rule_changes_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      msme_43b_rule_profiles: {
        Row: {
          client_id: string
          created_at: string
          firm_id: string | null
          id: string
          overrides: Json
          revision: number
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
          vendor_gst_rates: Json
          vendor_windows: Json
        }
        Insert: {
          client_id: string
          created_at?: string
          firm_id?: string | null
          id?: string
          overrides?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          vendor_gst_rates?: Json
          vendor_windows?: Json
        }
        Update: {
          client_id?: string
          created_at?: string
          firm_id?: string | null
          id?: string
          overrides?: Json
          revision?: number
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          vendor_gst_rates?: Json
          vendor_windows?: Json
        }
        Relationships: [
          {
            foreignKeyName: "msme_43b_rule_profiles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_rule_profiles_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_rule_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      msme_43b_runs: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          created_by_name: string | null
          cy_label: string
          cy_ledgers: Json | null
          firm_id: string | null
          fy_label: string | null
          fy_ledgers: Json | null
          id: string
          label: string | null
          note: string | null
          panel_review: Json | null
          report: Json
          total_allowed_fy: number
          total_disallowed_cy: number
          total_gst_excluded: number
          total_gst_unidentified: number
          total_still_outstanding: number
          vendor_count: number
          window_days: number
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          cy_label: string
          cy_ledgers?: Json | null
          firm_id?: string | null
          fy_label?: string | null
          fy_ledgers?: Json | null
          id?: string
          label?: string | null
          note?: string | null
          panel_review?: Json | null
          report: Json
          total_allowed_fy?: number
          total_disallowed_cy?: number
          total_gst_excluded?: number
          total_gst_unidentified?: number
          total_still_outstanding?: number
          vendor_count?: number
          window_days?: number
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          created_by_name?: string | null
          cy_label?: string
          cy_ledgers?: Json | null
          firm_id?: string | null
          fy_label?: string | null
          fy_ledgers?: Json | null
          id?: string
          label?: string | null
          note?: string | null
          panel_review?: Json | null
          report?: Json
          total_allowed_fy?: number
          total_disallowed_cy?: number
          total_gst_excluded?: number
          total_gst_unidentified?: number
          total_still_outstanding?: number
          vendor_count?: number
          window_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "msme_43b_runs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "msme_43b_runs_firm_id_fkey"
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
      nce_capital_account: {
        Row: {
          created_at: string | null
          engagement_id: string
          financial_year: string
          id: string
          interest_cy: number | null
          interest_py: number | null
          introduced_cy: number | null
          introduced_py: number | null
          opening_balance_cy: number | null
          opening_balance_py: number | null
          partner_name: string | null
          partner_no: number
          profit_share_cy: number | null
          profit_share_pct: number | null
          profit_share_py: number | null
          remuneration_cy: number | null
          remuneration_py: number | null
          withdrawals_cy: number | null
          withdrawals_py: number | null
        }
        Insert: {
          created_at?: string | null
          engagement_id: string
          financial_year: string
          id?: string
          interest_cy?: number | null
          interest_py?: number | null
          introduced_cy?: number | null
          introduced_py?: number | null
          opening_balance_cy?: number | null
          opening_balance_py?: number | null
          partner_name?: string | null
          partner_no: number
          profit_share_cy?: number | null
          profit_share_pct?: number | null
          profit_share_py?: number | null
          remuneration_cy?: number | null
          remuneration_py?: number | null
          withdrawals_cy?: number | null
          withdrawals_py?: number | null
        }
        Update: {
          created_at?: string | null
          engagement_id?: string
          financial_year?: string
          id?: string
          interest_cy?: number | null
          interest_py?: number | null
          introduced_cy?: number | null
          introduced_py?: number | null
          opening_balance_cy?: number | null
          opening_balance_py?: number | null
          partner_name?: string | null
          partner_no?: number
          profit_share_cy?: number | null
          profit_share_pct?: number | null
          profit_share_py?: number | null
          remuneration_cy?: number | null
          remuneration_py?: number | null
          withdrawals_cy?: number | null
          withdrawals_py?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nce_capital_account_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      nce_capital_note: {
        Row: {
          closing: number | null
          coa_anchor_closing: number | null
          col: string
          created_at: string
          drawings: number
          engagement_id: string
          financial_year: string
          id: string
          interest_on_cap: number
          introduced: number
          is_balancing_row: boolean
          is_stale: boolean
          opening: number
          partner_name: string
          profit_share: number
          remuneration: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          closing?: number | null
          coa_anchor_closing?: number | null
          col: string
          created_at?: string
          drawings?: number
          engagement_id: string
          financial_year: string
          id?: string
          interest_on_cap?: number
          introduced?: number
          is_balancing_row?: boolean
          is_stale?: boolean
          opening?: number
          partner_name: string
          profit_share?: number
          remuneration?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          closing?: number | null
          coa_anchor_closing?: number | null
          col?: string
          created_at?: string
          drawings?: number
          engagement_id?: string
          financial_year?: string
          id?: string
          interest_on_cap?: number
          introduced?: number
          is_balancing_row?: boolean
          is_stale?: boolean
          opening?: number
          partner_name?: string
          profit_share?: number
          remuneration?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nce_capital_note_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      nce_financial_notes: {
        Row: {
          created_at: string | null
          cy_data: Json
          engagement_id: string
          financial_year: string
          id: string
          note_type: string
          py_data: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          cy_data?: Json
          engagement_id: string
          financial_year: string
          id?: string
          note_type: string
          py_data?: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          cy_data?: Json
          engagement_id?: string
          financial_year?: string
          id?: string
          note_type?: string
          py_data?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nce_financial_notes_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      nce_letters: {
        Row: {
          cash_on_hand: number | null
          closing_stock: number | null
          closing_stock_date: string | null
          created_at: string | null
          custom_content: Json | null
          engagement_id: string
          financial_year: string
          id: string
          letter_date: string | null
          letter_type: string
          updated_at: string | null
        }
        Insert: {
          cash_on_hand?: number | null
          closing_stock?: number | null
          closing_stock_date?: string | null
          created_at?: string | null
          custom_content?: Json | null
          engagement_id: string
          financial_year: string
          id?: string
          letter_date?: string | null
          letter_type: string
          updated_at?: string | null
        }
        Update: {
          cash_on_hand?: number | null
          closing_stock?: number | null
          closing_stock_date?: string | null
          created_at?: string | null
          custom_content?: Json | null
          engagement_id?: string
          financial_year?: string
          id?: string
          letter_date?: string | null
          letter_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nce_letters_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      nce_ppe_schedule: {
        Row: {
          additions_post: number | null
          additions_pre: number | null
          additions_py: number
          asset_category: string
          asset_name: string
          closing_balance: number | null
          closing_py: number
          coa_anchor_depr: number | null
          coa_anchor_net: number | null
          coa_code: string | null
          created_at: string | null
          deletions: number | null
          deletions_py: number
          depreciation: number | null
          depreciation_py: number
          engagement_id: string
          financial_year: string
          id: string
          is_balancing_class: boolean
          is_stale: boolean
          opening_balance: number | null
          opening_py: number
          rate_pct: number | null
          sort_order: number | null
          total: number | null
        }
        Insert: {
          additions_post?: number | null
          additions_pre?: number | null
          additions_py?: number
          asset_category: string
          asset_name: string
          closing_balance?: number | null
          closing_py?: number
          coa_anchor_depr?: number | null
          coa_anchor_net?: number | null
          coa_code?: string | null
          created_at?: string | null
          deletions?: number | null
          deletions_py?: number
          depreciation?: number | null
          depreciation_py?: number
          engagement_id: string
          financial_year: string
          id?: string
          is_balancing_class?: boolean
          is_stale?: boolean
          opening_balance?: number | null
          opening_py?: number
          rate_pct?: number | null
          sort_order?: number | null
          total?: number | null
        }
        Update: {
          additions_post?: number | null
          additions_pre?: number | null
          additions_py?: number
          asset_category?: string
          asset_name?: string
          closing_balance?: number | null
          closing_py?: number
          coa_anchor_depr?: number | null
          coa_anchor_net?: number | null
          coa_code?: string | null
          created_at?: string | null
          deletions?: number | null
          deletions_py?: number
          depreciation?: number | null
          depreciation_py?: number
          engagement_id?: string
          financial_year?: string
          id?: string
          is_balancing_class?: boolean
          is_stale?: boolean
          opening_balance?: number | null
          opening_py?: number
          rate_pct?: number | null
          sort_order?: number | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nce_ppe_schedule_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
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
      notes_selection: {
        Row: {
          client_id: string | null
          created_at: string | null
          engagement_id: string
          financial_year: string | null
          id: string
          selected_notes: Json | null
          updated_at: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          engagement_id: string
          financial_year?: string | null
          id?: string
          selected_notes?: Json | null
          updated_at?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string
          financial_year?: string | null
          id?: string
          selected_notes?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_selection_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_selection_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
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
          note_nc_1: Json | null
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
          note_nc_1?: Json | null
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
          note_nc_1?: Json | null
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
      notes_to_accounts_data: {
        Row: {
          engagement_id: string
          header_overrides: Json
          id: string
          note1_new_entity_enabled: boolean
          note1_new_entity_text: string | null
          note3_variant: string
          notes_json: Json
          signature_data: Json
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          engagement_id: string
          header_overrides?: Json
          id?: string
          note1_new_entity_enabled?: boolean
          note1_new_entity_text?: string | null
          note3_variant?: string
          notes_json?: Json
          signature_data?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          engagement_id?: string
          header_overrides?: Json
          id?: string
          note1_new_entity_enabled?: boolean
          note1_new_entity_text?: string | null
          note3_variant?: string
          notes_json?: Json
          signature_data?: Json
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_to_accounts_data_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
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
      onboarding_instances: {
        Row: {
          assigned_ie_id: string | null
          completed_at: string | null
          created_at: string
          firm_id: string
          id: string
          notes: string | null
          plan_tier: string
          progress_pct: number
          status: string
        }
        Insert: {
          assigned_ie_id?: string | null
          completed_at?: string | null
          created_at?: string
          firm_id: string
          id?: string
          notes?: string | null
          plan_tier: string
          progress_pct?: number
          status?: string
        }
        Update: {
          assigned_ie_id?: string | null
          completed_at?: string | null
          created_at?: string
          firm_id?: string
          id?: string
          notes?: string | null
          plan_tier?: string
          progress_pct?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_instances_assigned_ie_id_fkey"
            columns: ["assigned_ie_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_instances_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: true
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_tasks: {
        Row: {
          assignee_id: string | null
          created_at: string
          done_at: string | null
          done_by: string | null
          due_at: string | null
          id: string
          instance_id: string
          notes: string | null
          status: string
          task_desc: string | null
          task_label: string
          task_order: number
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_at?: string | null
          id?: string
          instance_id: string
          notes?: string | null
          status?: string
          task_desc?: string | null
          task_label: string
          task_order: number
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          done_at?: string | null
          done_by?: string | null
          due_at?: string | null
          id?: string
          instance_id?: string
          notes?: string | null
          status?: string
          task_desc?: string | null
          task_label?: string
          task_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_done_by_fkey"
            columns: ["done_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "onboarding_tasks_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "onboarding_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_templates: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          plan_tier: string
          task_desc: string | null
          task_label: string
          task_order: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          plan_tier: string
          task_desc?: string | null
          task_label: string
          task_order: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          plan_tier?: string
          task_desc?: string | null
          task_label?: string
          task_order?: number
        }
        Relationships: []
      }
      otp_requests: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          new_email: string | null
          otp_code: string
          purpose: string
          used_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at: string
          id?: string
          new_email?: string | null
          otp_code: string
          purpose?: string
          used_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          new_email?: string | null
          otp_code?: string
          purpose?: string
          used_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otp_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      planning_staff: {
        Row: {
          created_at: string | null
          firm_id: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          firm_id: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          firm_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_staff_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planning_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_activity_log: {
        Row: {
          activity: string
          client_id: string | null
          client_name: string | null
          created_at: string | null
          details: string | null
          firm_id: string
          id: string
          notified: boolean | null
        }
        Insert: {
          activity: string
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          details?: string | null
          firm_id: string
          id?: string
          notified?: boolean | null
        }
        Update: {
          activity?: string
          client_id?: string | null
          client_name?: string | null
          created_at?: string | null
          details?: string | null
          firm_id?: string
          id?: string
          notified?: boolean | null
        }
        Relationships: []
      }
      portal_query_messages: {
        Row: {
          attachment_name: string | null
          attachment_path: string | null
          created_at: string | null
          id: string
          message: string
          query_id: string
          sender_name: string | null
          sender_role: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_path?: string | null
          created_at?: string | null
          id?: string
          message?: string
          query_id: string
          sender_name?: string | null
          sender_role: string
        }
        Update: {
          attachment_name?: string | null
          attachment_path?: string | null
          created_at?: string | null
          id?: string
          message?: string
          query_id?: string
          sender_name?: string | null
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_query_messages_query_id_fkey"
            columns: ["query_id"]
            isOneToOne: false
            referencedRelation: "audit_client_queries"
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
      required_documents_master: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          doc_name: string
          firm_id: string
          id: string
          is_active: boolean
          sort_order: number
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          doc_name: string
          firm_id: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          doc_name?: string
          firm_id?: string
          id?: string
          is_active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
          firm_id: string | null
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
          firm_id?: string | null
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
          firm_id?: string | null
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
      scrutiny_facts: {
        Row: {
          captured_at: string | null
          captured_by: string | null
          client_id: string | null
          engagement_id: string | null
          fact_key: string
          fact_type: string
          fact_value: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          note: string | null
          updated_at: string | null
        }
        Insert: {
          captured_at?: string | null
          captured_by?: string | null
          client_id?: string | null
          engagement_id?: string | null
          fact_key: string
          fact_type?: string
          fact_value?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          updated_at?: string | null
        }
        Update: {
          captured_at?: string | null
          captured_by?: string | null
          client_id?: string | null
          engagement_id?: string | null
          fact_key?: string
          fact_type?: string
          fact_value?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scrutiny_facts_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_facts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_facts_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_facts_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      scrutiny_findings: {
        Row: {
          account_name: string | null
          actioned_at: string | null
          actioned_by: string | null
          advisory: boolean | null
          amount: number | null
          category: string | null
          clause_3cd: string | null
          client_id: string | null
          created_at: string | null
          detection_level: string | null
          engagement_id: string | null
          financial_year: string | null
          finding_hash: string | null
          firm_id: string | null
          flag_message: string | null
          id: string
          linked_query_id: string | null
          narration: string | null
          override_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule_id: string | null
          severity: string | null
          status: string | null
          tier: string
        }
        Insert: {
          account_name?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          advisory?: boolean | null
          amount?: number | null
          category?: string | null
          clause_3cd?: string | null
          client_id?: string | null
          created_at?: string | null
          detection_level?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          finding_hash?: string | null
          firm_id?: string | null
          flag_message?: string | null
          id?: string
          linked_query_id?: string | null
          narration?: string | null
          override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string | null
          severity?: string | null
          status?: string | null
          tier?: string
        }
        Update: {
          account_name?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          advisory?: boolean | null
          amount?: number | null
          category?: string | null
          clause_3cd?: string | null
          client_id?: string | null
          created_at?: string | null
          detection_level?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          finding_hash?: string | null
          firm_id?: string | null
          flag_message?: string | null
          id?: string
          linked_query_id?: string | null
          narration?: string | null
          override_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string | null
          severity?: string | null
          status?: string | null
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "scrutiny_findings_actioned_by_fkey"
            columns: ["actioned_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_findings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_findings_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_findings_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scrutiny_findings_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      scrutiny_judgments: {
        Row: {
          client_id: string
          created_at: string
          decided: Json | null
          decided_at: string | null
          decided_by: string | null
          financial_year: string
          firm_id: string | null
          id: string
          kind: string
          proposed: Json
          rationale: string | null
          status: string
          subject: string | null
          updated_at: string
          version: number
        }
        Insert: {
          client_id: string
          created_at?: string
          decided?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          financial_year: string
          firm_id?: string | null
          id?: string
          kind: string
          proposed?: Json
          rationale?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          client_id?: string
          created_at?: string
          decided?: Json | null
          decided_at?: string | null
          decided_by?: string | null
          financial_year?: string
          firm_id?: string | null
          id?: string
          kind?: string
          proposed?: Json
          rationale?: string | null
          status?: string
          subject?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scrutiny_judgments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      scrutiny_rule_audit: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          rule_id: string
          rule_uuid: string | null
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          rule_id: string
          rule_uuid?: string | null
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          rule_id?: string
          rule_uuid?: string | null
        }
        Relationships: []
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
          package: string | null
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
          package?: string | null
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
          package?: string | null
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
      service_tasks: {
        Row: {
          assigned_to: string | null
          client_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string | null
          due_date: string | null
          firm_id: string
          frequency: string
          id: string
          period_label: string | null
          service_category_id: string
          status: string
          task_description: string | null
          task_title: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          due_date?: string | null
          firm_id: string
          frequency: string
          id?: string
          period_label?: string | null
          service_category_id: string
          status?: string
          task_description?: string | null
          task_title: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string | null
          due_date?: string | null
          firm_id?: string
          frequency?: string
          id?: string
          period_label?: string | null
          service_category_id?: string
          status?: string
          task_description?: string | null
          task_title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_tasks_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
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
      stage7_cashflow_data: {
        Row: {
          closing_balance: number | null
          disclosure_notes: string | null
          engagement_id: string
          last_updated_at: string | null
          last_updated_by: string | null
          net_financing: number | null
          net_investing: number | null
          net_operating: number | null
          opening_balance: number | null
        }
        Insert: {
          closing_balance?: number | null
          disclosure_notes?: string | null
          engagement_id: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          net_financing?: number | null
          net_investing?: number | null
          net_operating?: number | null
          opening_balance?: number | null
        }
        Update: {
          closing_balance?: number | null
          disclosure_notes?: string | null
          engagement_id?: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          net_financing?: number | null
          net_investing?: number | null
          net_operating?: number | null
          opening_balance?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stage7_cashflow_data_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      stage7_ifc_data: {
        Row: {
          engagement_id: string
          last_updated_at: string | null
          last_updated_by: string | null
          place: string | null
          report_date: string | null
          sections: Json
        }
        Insert: {
          engagement_id: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          place?: string | null
          report_date?: string | null
          sections?: Json
        }
        Update: {
          engagement_id?: string
          last_updated_at?: string | null
          last_updated_by?: string | null
          place?: string | null
          report_date?: string | null
          sections?: Json
        }
        Relationships: [
          {
            foreignKeyName: "stage7_ifc_data_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: true
            referencedRelation: "audit_engagements"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_replies: {
        Row: {
          author_id: string
          created_at: string
          id: string
          is_internal: boolean
          message: string
          ticket_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          is_internal?: boolean
          message: string
          ticket_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          message?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_replies_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_replies_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          created_at: string
          cse_id: string | null
          firm_id: string
          id: string
          message: string
          priority: string
          raised_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cse_id?: string | null
          firm_id: string
          id?: string
          message: string
          priority?: string
          raised_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cse_id?: string | null
          firm_id?: string
          id?: string
          message?: string
          priority?: string
          raised_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_cse_id_fkey"
            columns: ["cse_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_batches: {
        Row: {
          client_id: string | null
          completed_at: string | null
          current_phase: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          groups_fetched: number | null
          id: string
          ledgers_fetched: number | null
          phase_errors: Json | null
          phase_status: Json | null
          phase_timings: Json | null
          started_at: string | null
          status: string | null
          sync_type: string | null
          tally_company: string | null
          tb_rows_fetched: number | null
          vouchers_fetched: number | null
          warnings: Json | null
        }
        Insert: {
          client_id?: string | null
          completed_at?: string | null
          current_phase?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          groups_fetched?: number | null
          id?: string
          ledgers_fetched?: number | null
          phase_errors?: Json | null
          phase_status?: Json | null
          phase_timings?: Json | null
          started_at?: string | null
          status?: string | null
          sync_type?: string | null
          tally_company?: string | null
          tb_rows_fetched?: number | null
          vouchers_fetched?: number | null
          warnings?: Json | null
        }
        Update: {
          client_id?: string | null
          completed_at?: string | null
          current_phase?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          groups_fetched?: number | null
          id?: string
          ledgers_fetched?: number | null
          phase_errors?: Json | null
          phase_status?: Json | null
          phase_timings?: Json | null
          started_at?: string | null
          status?: string | null
          sync_type?: string | null
          tally_company?: string | null
          tb_rows_fetched?: number | null
          vouchers_fetched?: number | null
          warnings?: Json | null
        }
        Relationships: []
      }
      sync_requests: {
        Row: {
          client_id: string | null
          engagement_id: string | null
          error: string | null
          firm_id: string | null
          id: string
          processed_at: string | null
          requested_at: string | null
          requested_by: string | null
          status: string
        }
        Insert: {
          client_id?: string | null
          engagement_id?: string | null
          error?: string | null
          firm_id?: string | null
          id?: string
          processed_at?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
        }
        Update: {
          client_id?: string | null
          engagement_id?: string | null
          error?: string | null
          firm_id?: string | null
          id?: string
          processed_at?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
        }
        Relationships: []
      }
      tally_element_map: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          candidates: Json
          created_at: string
          element_key: string
          element_label: string | null
          element_type: string
          firm_id: string
          id: string
          match_confidence: number
          match_method: string
          status: string
          tally_company_name: string | null
          tally_ledger_name: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          candidates?: Json
          created_at?: string
          element_key?: string
          element_label?: string | null
          element_type: string
          firm_id: string
          id?: string
          match_confidence?: number
          match_method?: string
          status?: string
          tally_company_name?: string | null
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          candidates?: Json
          created_at?: string
          element_key?: string
          element_label?: string | null
          element_type?: string
          firm_id?: string
          id?: string
          match_confidence?: number
          match_method?: string
          status?: string
          tally_company_name?: string | null
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_element_map_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_element_map_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_firm_companies: {
        Row: {
          aliases: string[]
          created_at: string
          firm_id: string
          gateway_url: string
          gstin: string | null
          id: string
          is_active: boolean
          notes: string | null
          tally_company_name: string
          updated_at: string
        }
        Insert: {
          aliases?: string[]
          created_at?: string
          firm_id: string
          gateway_url?: string
          gstin?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          tally_company_name: string
          updated_at?: string
        }
        Update: {
          aliases?: string[]
          created_at?: string
          firm_id?: string
          gateway_url?: string
          gstin?: string | null
          id?: string
          is_active?: boolean
          notes?: string | null
          tally_company_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_firm_companies_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_group_map: {
        Row: {
          canonical_family: string
          client_count: number | null
          derived: boolean | null
          ledger_count: number | null
          parent_group_norm: string
        }
        Insert: {
          canonical_family: string
          client_count?: number | null
          derived?: boolean | null
          ledger_count?: number | null
          parent_group_norm: string
        }
        Update: {
          canonical_family?: string
          client_count?: number | null
          derived?: boolean | null
          ledger_count?: number | null
          parent_group_norm?: string
        }
        Relationships: []
      }
      tally_groups: {
        Row: {
          client_id: string | null
          created_at: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          group_name: string
          id: string
          is_primary: boolean | null
          is_revenue: boolean | null
          parent_group: string | null
          primary_group: string | null
          sync_batch_id: string | null
          tally_company: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          group_name: string
          id?: string
          is_primary?: boolean | null
          is_revenue?: boolean | null
          parent_group?: string | null
          primary_group?: string | null
          sync_batch_id?: string | null
          tally_company?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          group_name?: string
          id?: string
          is_primary?: boolean | null
          is_revenue?: boolean | null
          parent_group?: string | null
          primary_group?: string | null
          sync_batch_id?: string | null
          tally_company?: string | null
        }
        Relationships: []
      }
      tally_ledgers: {
        Row: {
          client_id: string | null
          closing_balance: number | null
          closing_type: string | null
          created_at: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          ledger_name: string
          opening_balance: number | null
          opening_type: string | null
          parent_group: string | null
          sync_batch_id: string | null
          tally_company: string | null
        }
        Insert: {
          client_id?: string | null
          closing_balance?: number | null
          closing_type?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          ledger_name: string
          opening_balance?: number | null
          opening_type?: string | null
          parent_group?: string | null
          sync_batch_id?: string | null
          tally_company?: string | null
        }
        Update: {
          client_id?: string | null
          closing_balance?: number | null
          closing_type?: string | null
          created_at?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          ledger_name?: string
          opening_balance?: number | null
          opening_type?: string | null
          parent_group?: string | null
          sync_batch_id?: string | null
          tally_company?: string | null
        }
        Relationships: []
      }
      tally_party_map: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          candidates: Json
          client_id: string
          created_at: string
          firm_id: string
          id: string
          match_confidence: number
          match_method: string
          status: string
          tally_company_name: string | null
          tally_ledger_name: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          candidates?: Json
          client_id: string
          created_at?: string
          firm_id: string
          id?: string
          match_confidence?: number
          match_method?: string
          status?: string
          tally_company_name?: string | null
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          candidates?: Json
          client_id?: string
          created_at?: string
          firm_id?: string
          id?: string
          match_confidence?: number
          match_method?: string
          status?: string
          tally_company_name?: string | null
          tally_ledger_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_party_map_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_party_map_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_party_map_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_processing_logs: {
        Row: {
          created_at: string
          id: string
          log_level: string
          log_message: string
          upload_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          log_level?: string
          log_message: string
          upload_id: string
        }
        Update: {
          created_at?: string
          id?: string
          log_level?: string
          log_message?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_processing_logs_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "tally_xml_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_receipt_staging: {
        Row: {
          amount: number
          bank_ledger: string | null
          created_at: string
          error: string | null
          firm_id: string
          id: string
          imported_at: string | null
          kasar_amount: number
          match_confidence: number
          match_method: string
          matched_client_id: string | null
          narration: string | null
          party_ledger: string | null
          raw: Json
          receipt_id: string | null
          reviewed_by: string | null
          status: string
          tally_company_name: string | null
          tally_guid: string
          tds_amount: number
          voucher_date: string | null
          voucher_number: string | null
        }
        Insert: {
          amount?: number
          bank_ledger?: string | null
          created_at?: string
          error?: string | null
          firm_id: string
          id?: string
          imported_at?: string | null
          kasar_amount?: number
          match_confidence?: number
          match_method?: string
          matched_client_id?: string | null
          narration?: string | null
          party_ledger?: string | null
          raw?: Json
          receipt_id?: string | null
          reviewed_by?: string | null
          status?: string
          tally_company_name?: string | null
          tally_guid: string
          tds_amount?: number
          voucher_date?: string | null
          voucher_number?: string | null
        }
        Update: {
          amount?: number
          bank_ledger?: string | null
          created_at?: string
          error?: string | null
          firm_id?: string
          id?: string
          imported_at?: string | null
          kasar_amount?: number
          match_confidence?: number
          match_method?: string
          matched_client_id?: string | null
          narration?: string | null
          party_ledger?: string | null
          raw?: Json
          receipt_id?: string | null
          reviewed_by?: string | null
          status?: string
          tally_company_name?: string | null
          tally_guid?: string
          tds_amount?: number
          voucher_date?: string | null
          voucher_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_receipt_staging_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_receipt_staging_matched_client_id_fkey"
            columns: ["matched_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_receipt_staging_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "billing_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_receipt_staging_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_recon: {
        Row: {
          as_of: string | null
          caflow_outstanding: number
          client_id: string | null
          created_at: string
          diff: number
          firm_id: string
          id: string
          status: string
          tally_closing: number
          tally_company_name: string | null
          tally_ledger_name: string | null
        }
        Insert: {
          as_of?: string | null
          caflow_outstanding?: number
          client_id?: string | null
          created_at?: string
          diff?: number
          firm_id: string
          id?: string
          status?: string
          tally_closing?: number
          tally_company_name?: string | null
          tally_ledger_name?: string | null
        }
        Update: {
          as_of?: string | null
          caflow_outstanding?: number
          client_id?: string | null
          created_at?: string
          diff?: number
          firm_id?: string
          id?: string
          status?: string
          tally_closing?: number
          tally_company_name?: string | null
          tally_ledger_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_recon_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_recon_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_sync_queue: {
        Row: {
          action: string
          attempts: number
          direction: string
          document_no: string | null
          firm_id: string
          id: string
          invoice_id: string | null
          last_error: string | null
          max_attempts: number
          payload: Json | null
          processed_at: string | null
          requested_at: string
          requested_by: string | null
          status: string
          tally_vch_id: string | null
        }
        Insert: {
          action?: string
          attempts?: number
          direction?: string
          document_no?: string | null
          firm_id: string
          id?: string
          invoice_id?: string | null
          last_error?: string | null
          max_attempts?: number
          payload?: Json | null
          processed_at?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          tally_vch_id?: string | null
        }
        Update: {
          action?: string
          attempts?: number
          direction?: string
          document_no?: string | null
          firm_id?: string
          id?: string
          invoice_id?: string | null
          last_error?: string | null
          max_attempts?: number
          payload?: Json | null
          processed_at?: string | null
          requested_at?: string
          requested_by?: string | null
          status?: string
          tally_vch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_sync_queue_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_sync_queue_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_sync_queue_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_tb_rows: {
        Row: {
          account_category: string
          closing_balance_normalized: number
          closing_balance_raw: number
          created_at: string
          credit_normalized: number
          credit_raw: number
          debit_normalized: number
          debit_raw: number
          display_name: string
          id: string
          opening_balance_normalized: number
          opening_balance_raw: number
          sign_rule_applied: string | null
          upload_id: string
        }
        Insert: {
          account_category?: string
          closing_balance_normalized?: number
          closing_balance_raw?: number
          created_at?: string
          credit_normalized?: number
          credit_raw?: number
          debit_normalized?: number
          debit_raw?: number
          display_name: string
          id?: string
          opening_balance_normalized?: number
          opening_balance_raw?: number
          sign_rule_applied?: string | null
          upload_id: string
        }
        Update: {
          account_category?: string
          closing_balance_normalized?: number
          closing_balance_raw?: number
          created_at?: string
          credit_normalized?: number
          credit_raw?: number
          debit_normalized?: number
          debit_raw?: number
          display_name?: string
          id?: string
          opening_balance_normalized?: number
          opening_balance_raw?: number
          sign_rule_applied?: string | null
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tally_tb_rows_upload_id_fkey"
            columns: ["upload_id"]
            isOneToOne: false
            referencedRelation: "tally_xml_uploads"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_trial_balance: {
        Row: {
          balance_type: string | null
          client_id: string | null
          closing_balance: number | null
          credit_amount: number | null
          debit_amount: number | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          ledger_name: string
          opening_balance: number | null
          opening_type: string | null
          parent_group: string | null
          sync_batch_id: string | null
          sync_code_version: string | null
          synced_at: string | null
          tally_company: string | null
        }
        Insert: {
          balance_type?: string | null
          client_id?: string | null
          closing_balance?: number | null
          credit_amount?: number | null
          debit_amount?: number | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          ledger_name: string
          opening_balance?: number | null
          opening_type?: string | null
          parent_group?: string | null
          sync_batch_id?: string | null
          sync_code_version?: string | null
          synced_at?: string | null
          tally_company?: string | null
        }
        Update: {
          balance_type?: string | null
          client_id?: string | null
          closing_balance?: number | null
          credit_amount?: number | null
          debit_amount?: number | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          ledger_name?: string
          opening_balance?: number | null
          opening_type?: string | null
          parent_group?: string | null
          sync_batch_id?: string | null
          sync_code_version?: string | null
          synced_at?: string | null
          tally_company?: string | null
        }
        Relationships: []
      }
      tally_voucher_log: {
        Row: {
          direction: string
          firm_id: string
          id: string
          invoice_id: string | null
          posted_at: string
          status: string
          tally_company_name: string
          tally_vch_id: string | null
          voucher_number: string | null
        }
        Insert: {
          direction?: string
          firm_id: string
          id?: string
          invoice_id?: string | null
          posted_at?: string
          status?: string
          tally_company_name: string
          tally_vch_id?: string | null
          voucher_number?: string | null
        }
        Update: {
          direction?: string
          firm_id?: string
          id?: string
          invoice_id?: string | null
          posted_at?: string
          status?: string
          tally_company_name?: string
          tally_vch_id?: string | null
          voucher_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tally_voucher_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tally_voucher_log_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      tally_vouchers: {
        Row: {
          amount: number | null
          client_id: string | null
          dr_cr: string | null
          engagement_id: string | null
          financial_year: string | null
          firm_id: string | null
          id: string
          line_items: Json | null
          narration: string | null
          party_ledger: string | null
          sync_batch_id: string | null
          synced_at: string | null
          tally_company: string | null
          tally_guid: string | null
          voucher_date: string | null
          voucher_number: string | null
          voucher_type: string | null
        }
        Insert: {
          amount?: number | null
          client_id?: string | null
          dr_cr?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          line_items?: Json | null
          narration?: string | null
          party_ledger?: string | null
          sync_batch_id?: string | null
          synced_at?: string | null
          tally_company?: string | null
          tally_guid?: string | null
          voucher_date?: string | null
          voucher_number?: string | null
          voucher_type?: string | null
        }
        Update: {
          amount?: number | null
          client_id?: string | null
          dr_cr?: string | null
          engagement_id?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string
          line_items?: Json | null
          narration?: string | null
          party_ledger?: string | null
          sync_batch_id?: string | null
          synced_at?: string | null
          tally_company?: string | null
          tally_guid?: string | null
          voucher_date?: string | null
          voucher_number?: string | null
          voucher_type?: string | null
        }
        Relationships: []
      }
      tally_xml_uploads: {
        Row: {
          created_at: string
          file_name: string
          id: string
          parse_status: string
          raw_xml: string | null
          total_rows: number
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          parse_status?: string
          raw_xml?: string | null
          total_rows?: number
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          parse_status?: string
          raw_xml?: string | null
          total_rows?: number
        }
        Relationships: []
      }
      tax_audit_3cd_clauses: {
        Row: {
          annexure_ref: string | null
          applicability: string
          clause_no: string
          engagement_id: string
          id: string
          response: string | null
          sequence_order: number
          sub_clause: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          annexure_ref?: string | null
          applicability?: string
          clause_no: string
          engagement_id: string
          id?: string
          response?: string | null
          sequence_order?: number
          sub_clause?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          annexure_ref?: string | null
          applicability?: string
          clause_no?: string
          engagement_id?: string
          id?: string
          response?: string | null
          sequence_order?: number
          sub_clause?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tax_audit_annexures: {
        Row: {
          annexure_id: string
          clause_link: string | null
          display_sequence: number
          engagement_id: string
          id: string
          is_deleted: boolean
          rows_json: Json
          title: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          annexure_id: string
          clause_link?: string | null
          display_sequence?: number
          engagement_id: string
          id?: string
          is_deleted?: boolean
          rows_json?: Json
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          annexure_id?: string
          clause_link?: string | null
          display_sequence?: number
          engagement_id?: string
          id?: string
          is_deleted?: boolean
          rows_json?: Json
          title?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tax_audit_cell_map: {
        Row: {
          cell_address: string
          data_type: string
          field_key: string
          formula_cell: boolean
          id: string
          sheet: string
          source: string | null
          template_name: string
        }
        Insert: {
          cell_address: string
          data_type?: string
          field_key: string
          formula_cell?: boolean
          id?: string
          sheet: string
          source?: string | null
          template_name: string
        }
        Update: {
          cell_address?: string
          data_type?: string
          field_key?: string
          formula_cell?: boolean
          id?: string
          sheet?: string
          source?: string | null
          template_name?: string
        }
        Relationships: []
      }
      tax_audit_form: {
        Row: {
          created_at: string
          engagement_id: string
          form_type: string
          id: string
          status: string
          template_version: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          engagement_id: string
          form_type: string
          id?: string
          status?: string
          template_version?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          engagement_id?: string
          form_type?: string
          id?: string
          status?: string
          template_version?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_audit_values: {
        Row: {
          current_value: string | null
          data_type: string
          engagement_id: string
          field_key: string
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          current_value?: string | null
          data_type?: string
          engagement_id: string
          field_key: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          current_value?: string | null
          data_type?: string
          engagement_id?: string
          field_key?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tax_audit_versions: {
        Row: {
          change_reason: string | null
          changed_at: string
          element_id: string
          element_type: string
          engagement_id: string
          id: string
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          change_reason?: string | null
          changed_at?: string
          element_id: string
          element_type: string
          engagement_id: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          change_reason?: string | null
          changed_at?: string
          element_id?: string
          element_type?: string
          engagement_id?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: []
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
      tds_ack_files: {
        Row: {
          client_id: string
          created_at: string | null
          file_name: string
          file_url: string
          filing_id: string
          firm_id: string | null
          id: string
          user_id: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          file_name: string
          file_url: string
          filing_id: string
          firm_id?: string | null
          id?: string
          user_id?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          file_name?: string
          file_url?: string
          filing_id?: string
          firm_id?: string | null
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_ack_files_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_challans: {
        Row: {
          archived_at: string | null
          archived_by: string | null
          bank_name: string | null
          bsr_code: string | null
          challan_remarks: string | null
          challan_serial_no: string | null
          cheque_dd_no: string | null
          client_id: string
          created_at: string | null
          deposit_date: string | null
          education_cess_deposited: number | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id: string
          interest_deposited: number | null
          is_archived: boolean
          is_book_entry: boolean | null
          minor_head_of_challan: string | null
          others_deposited: number | null
          quarter: string
          section_code: string | null
          surcharge_deposited: number | null
          total_challan_amount: number | null
          total_tax_deposited: number | null
          transfer_voucher_no: string | null
          updated_at: string | null
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          bank_name?: string | null
          bsr_code?: string | null
          challan_remarks?: string | null
          challan_serial_no?: string | null
          cheque_dd_no?: string | null
          client_id: string
          created_at?: string | null
          deposit_date?: string | null
          education_cess_deposited?: number | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id?: string
          interest_deposited?: number | null
          is_archived?: boolean
          is_book_entry?: boolean | null
          minor_head_of_challan?: string | null
          others_deposited?: number | null
          quarter: string
          section_code?: string | null
          surcharge_deposited?: number | null
          total_challan_amount?: number | null
          total_tax_deposited?: number | null
          transfer_voucher_no?: string | null
          updated_at?: string | null
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          bank_name?: string | null
          bsr_code?: string | null
          challan_remarks?: string | null
          challan_serial_no?: string | null
          cheque_dd_no?: string | null
          client_id?: string
          created_at?: string | null
          deposit_date?: string | null
          education_cess_deposited?: number | null
          filing_id?: string
          financial_year?: string
          firm_id?: string
          form_type?: string
          id?: string
          interest_deposited?: number | null
          is_archived?: boolean
          is_book_entry?: boolean | null
          minor_head_of_challan?: string | null
          others_deposited?: number | null
          quarter?: string
          section_code?: string | null
          surcharge_deposited?: number | null
          total_challan_amount?: number | null
          total_tax_deposited?: number | null
          transfer_voucher_no?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_challans_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_challans_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_challans_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_correction_audit_log: {
        Row: {
          action_type: string
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          client_id: string | null
          correction_id: string
          created_at: string
          detail: string | null
          firm_id: string | null
          id: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          action_type: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          client_id?: string | null
          correction_id: string
          created_at?: string
          detail?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          action_type?: string
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          client_id?: string | null
          correction_id?: string
          created_at?: string
          detail?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_correction_audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_correction_audit_log_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "tds_corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_correction_challans: {
        Row: {
          action: string
          bank_name: string | null
          bsr_code: string | null
          challan_remarks: string | null
          challan_serial_no: string | null
          cheque_dd_no: string | null
          client_id: string
          correction_id: string
          created_at: string
          deposit_date: string | null
          education_cess_deposited: number | null
          filing_id: string | null
          financial_year: string | null
          firm_id: string
          form_type: string | null
          fully_utilized: boolean | null
          id: string
          interest_deposited: number | null
          is_book_entry: boolean | null
          late_fees_234e: number | null
          late_fees_used: number | null
          minor_head_of_challan: string | null
          origin_fy: string | null
          origin_quarter: string | null
          original_challan_id: string | null
          original_values: Json | null
          others_deposited: number | null
          quarter: string | null
          section_code: string | null
          surcharge_deposited: number | null
          total_challan_amount: number | null
          total_tax_deposited: number | null
          transfer_voucher_no: string | null
          updated_at: string
        }
        Insert: {
          action?: string
          bank_name?: string | null
          bsr_code?: string | null
          challan_remarks?: string | null
          challan_serial_no?: string | null
          cheque_dd_no?: string | null
          client_id: string
          correction_id: string
          created_at?: string
          deposit_date?: string | null
          education_cess_deposited?: number | null
          filing_id?: string | null
          financial_year?: string | null
          firm_id: string
          form_type?: string | null
          fully_utilized?: boolean | null
          id?: string
          interest_deposited?: number | null
          is_book_entry?: boolean | null
          late_fees_234e?: number | null
          late_fees_used?: number | null
          minor_head_of_challan?: string | null
          origin_fy?: string | null
          origin_quarter?: string | null
          original_challan_id?: string | null
          original_values?: Json | null
          others_deposited?: number | null
          quarter?: string | null
          section_code?: string | null
          surcharge_deposited?: number | null
          total_challan_amount?: number | null
          total_tax_deposited?: number | null
          transfer_voucher_no?: string | null
          updated_at?: string
        }
        Update: {
          action?: string
          bank_name?: string | null
          bsr_code?: string | null
          challan_remarks?: string | null
          challan_serial_no?: string | null
          cheque_dd_no?: string | null
          client_id?: string
          correction_id?: string
          created_at?: string
          deposit_date?: string | null
          education_cess_deposited?: number | null
          filing_id?: string | null
          financial_year?: string | null
          firm_id?: string
          form_type?: string | null
          fully_utilized?: boolean | null
          id?: string
          interest_deposited?: number | null
          is_book_entry?: boolean | null
          late_fees_234e?: number | null
          late_fees_used?: number | null
          minor_head_of_challan?: string | null
          origin_fy?: string | null
          origin_quarter?: string | null
          original_challan_id?: string | null
          original_values?: Json | null
          others_deposited?: number | null
          quarter?: string | null
          section_code?: string | null
          surcharge_deposited?: number | null
          total_challan_amount?: number | null
          total_tax_deposited?: number | null
          transfer_voucher_no?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_correction_challans_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "tds_corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_correction_deductees: {
        Row: {
          action: string
          amount_paid_credited: number | null
          cess_amount: number | null
          challan_id: string | null
          client_id: string
          correction_challan_id: string | null
          correction_id: string
          country_of_residence: string | null
          created_at: string
          date_of_deduction: string | null
          date_of_payment: string | null
          deductee_name: string | null
          deductee_pan: string | null
          deductee_ref_no: string | null
          deductee_type: string | null
          designation: string | null
          filing_id: string | null
          financial_year: string | null
          firm_id: string
          form_type: string | null
          gross_salary: number | null
          id: string
          interest_amount: number | null
          late_fees_amount: number | null
          lower_deduction_certificate_no: string | null
          lower_deduction_rate: number | null
          nature_of_payment: string | null
          net_taxable_salary: number | null
          original_deductee_id: string | null
          original_values: Json | null
          pan_not_available: boolean | null
          quarter: string | null
          rate_of_tds: number | null
          reason_for_lower_or_nil_deduction: string | null
          remarks: string | null
          section_code: string | null
          standard_deduction_allowed: number | null
          surcharge_amount: number | null
          tds_amount: number | null
          total_tax_deducted: number | null
          updated_at: string
        }
        Insert: {
          action?: string
          amount_paid_credited?: number | null
          cess_amount?: number | null
          challan_id?: string | null
          client_id: string
          correction_challan_id?: string | null
          correction_id: string
          country_of_residence?: string | null
          created_at?: string
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name?: string | null
          deductee_pan?: string | null
          deductee_ref_no?: string | null
          deductee_type?: string | null
          designation?: string | null
          filing_id?: string | null
          financial_year?: string | null
          firm_id: string
          form_type?: string | null
          gross_salary?: number | null
          id?: string
          interest_amount?: number | null
          late_fees_amount?: number | null
          lower_deduction_certificate_no?: string | null
          lower_deduction_rate?: number | null
          nature_of_payment?: string | null
          net_taxable_salary?: number | null
          original_deductee_id?: string | null
          original_values?: Json | null
          pan_not_available?: boolean | null
          quarter?: string | null
          rate_of_tds?: number | null
          reason_for_lower_or_nil_deduction?: string | null
          remarks?: string | null
          section_code?: string | null
          standard_deduction_allowed?: number | null
          surcharge_amount?: number | null
          tds_amount?: number | null
          total_tax_deducted?: number | null
          updated_at?: string
        }
        Update: {
          action?: string
          amount_paid_credited?: number | null
          cess_amount?: number | null
          challan_id?: string | null
          client_id?: string
          correction_challan_id?: string | null
          correction_id?: string
          country_of_residence?: string | null
          created_at?: string
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name?: string | null
          deductee_pan?: string | null
          deductee_ref_no?: string | null
          deductee_type?: string | null
          designation?: string | null
          filing_id?: string | null
          financial_year?: string | null
          firm_id?: string
          form_type?: string | null
          gross_salary?: number | null
          id?: string
          interest_amount?: number | null
          late_fees_amount?: number | null
          lower_deduction_certificate_no?: string | null
          lower_deduction_rate?: number | null
          nature_of_payment?: string | null
          net_taxable_salary?: number | null
          original_deductee_id?: string | null
          original_values?: Json | null
          pan_not_available?: boolean | null
          quarter?: string | null
          rate_of_tds?: number | null
          reason_for_lower_or_nil_deduction?: string | null
          remarks?: string | null
          section_code?: string | null
          standard_deduction_allowed?: number | null
          surcharge_amount?: number | null
          tds_amount?: number | null
          total_tax_deducted?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_correction_deductees_correction_challan_id_fkey"
            columns: ["correction_challan_id"]
            isOneToOne: false
            referencedRelation: "tds_correction_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_correction_deductees_correction_id_fkey"
            columns: ["correction_id"]
            isOneToOne: false
            referencedRelation: "tds_corrections"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_corrections: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_by_name: string | null
          approved_by_role: string | null
          client_id: string
          created_at: string
          filed_at: string | null
          filed_by: string | null
          filed_by_name: string | null
          filing_reference: string | null
          financial_year: string
          firm_id: string
          form_type: string
          id: string
          original_filing_id: string | null
          prepared_at: string | null
          prepared_by: string | null
          prepared_by_name: string | null
          prepared_by_role: string | null
          proof_file_name: string | null
          proof_file_url: string | null
          proof_uploaded_at: string | null
          proof_uploaded_by: string | null
          quarter: string
          raised_at: string
          raised_by: string | null
          raised_by_name: string | null
          raised_by_role: string | null
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          signed_at: string | null
          signed_by: string | null
          signed_by_name: string | null
          signed_by_role: string | null
          status: string
          submission_mode: string | null
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approved_by_role?: string | null
          client_id: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          filed_by_name?: string | null
          filing_reference?: string | null
          financial_year: string
          firm_id: string
          form_type: string
          id?: string
          original_filing_id?: string | null
          prepared_at?: string | null
          prepared_by?: string | null
          prepared_by_name?: string | null
          prepared_by_role?: string | null
          proof_file_name?: string | null
          proof_file_url?: string | null
          proof_uploaded_at?: string | null
          proof_uploaded_by?: string | null
          quarter: string
          raised_at?: string
          raised_by?: string | null
          raised_by_name?: string | null
          raised_by_role?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_by_name?: string | null
          signed_by_role?: string | null
          status?: string
          submission_mode?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_by_name?: string | null
          approved_by_role?: string | null
          client_id?: string
          created_at?: string
          filed_at?: string | null
          filed_by?: string | null
          filed_by_name?: string | null
          filing_reference?: string | null
          financial_year?: string
          firm_id?: string
          form_type?: string
          id?: string
          original_filing_id?: string | null
          prepared_at?: string | null
          prepared_by?: string | null
          prepared_by_name?: string | null
          prepared_by_role?: string | null
          proof_file_name?: string | null
          proof_file_url?: string | null
          proof_uploaded_at?: string | null
          proof_uploaded_by?: string | null
          quarter?: string
          raised_at?: string
          raised_by?: string | null
          raised_by_name?: string | null
          raised_by_role?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          signed_at?: string | null
          signed_by?: string | null
          signed_by_name?: string | null
          signed_by_role?: string | null
          status?: string
          submission_mode?: string | null
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_corrections_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_filed_by_fkey"
            columns: ["filed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_original_filing_id_fkey"
            columns: ["original_filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_prepared_by_fkey"
            columns: ["prepared_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_proof_uploaded_by_fkey"
            columns: ["proof_uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_corrections_signed_by_fkey"
            columns: ["signed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_deductees: {
        Row: {
          amount_paid_credited: number | null
          cess_amount: number | null
          cess_rate: number | null
          challan_id: string
          client_id: string
          contact_no: string | null
          country_of_residence: string | null
          created_at: string | null
          date_of_deduction: string | null
          date_of_payment: string | null
          deductee_name: string
          deductee_pan: string | null
          deductee_ref_no: string | null
          deductee_type: string | null
          designation: string | null
          email_id: string | null
          entertainment_allowance: number | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          gross_salary: number | null
          id: string
          income_from_house_property: number | null
          income_from_other_sources: number | null
          interest_amount: number | null
          late_fees_amount: number | null
          lower_deduction_certificate_no: string | null
          lower_deduction_rate: number | null
          nature_of_payment: string | null
          net_taxable_salary: number | null
          pan_not_available: boolean | null
          professional_tax: number | null
          quarter: string
          rate_of_tds: number | null
          reason_for_lower_or_nil_deduction: string | null
          remarks: string | null
          section_code: string
          standard_deduction_allowed: number | null
          surcharge_amount: number | null
          surcharge_rate: number | null
          tds_amount: number | null
          tds_by_previous_employer: number | null
          total_tax_deducted: number | null
          trc_available: boolean | null
          treaty_section: string | null
          updated_at: string | null
        }
        Insert: {
          amount_paid_credited?: number | null
          cess_amount?: number | null
          cess_rate?: number | null
          challan_id: string
          client_id: string
          contact_no?: string | null
          country_of_residence?: string | null
          created_at?: string | null
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name: string
          deductee_pan?: string | null
          deductee_ref_no?: string | null
          deductee_type?: string | null
          designation?: string | null
          email_id?: string | null
          entertainment_allowance?: number | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          gross_salary?: number | null
          id?: string
          income_from_house_property?: number | null
          income_from_other_sources?: number | null
          interest_amount?: number | null
          late_fees_amount?: number | null
          lower_deduction_certificate_no?: string | null
          lower_deduction_rate?: number | null
          nature_of_payment?: string | null
          net_taxable_salary?: number | null
          pan_not_available?: boolean | null
          professional_tax?: number | null
          quarter: string
          rate_of_tds?: number | null
          reason_for_lower_or_nil_deduction?: string | null
          remarks?: string | null
          section_code: string
          standard_deduction_allowed?: number | null
          surcharge_amount?: number | null
          surcharge_rate?: number | null
          tds_amount?: number | null
          tds_by_previous_employer?: number | null
          total_tax_deducted?: number | null
          trc_available?: boolean | null
          treaty_section?: string | null
          updated_at?: string | null
        }
        Update: {
          amount_paid_credited?: number | null
          cess_amount?: number | null
          cess_rate?: number | null
          challan_id?: string
          client_id?: string
          contact_no?: string | null
          country_of_residence?: string | null
          created_at?: string | null
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name?: string
          deductee_pan?: string | null
          deductee_ref_no?: string | null
          deductee_type?: string | null
          designation?: string | null
          email_id?: string | null
          entertainment_allowance?: number | null
          filing_id?: string
          financial_year?: string
          firm_id?: string
          form_type?: string
          gross_salary?: number | null
          id?: string
          income_from_house_property?: number | null
          income_from_other_sources?: number | null
          interest_amount?: number | null
          late_fees_amount?: number | null
          lower_deduction_certificate_no?: string | null
          lower_deduction_rate?: number | null
          nature_of_payment?: string | null
          net_taxable_salary?: number | null
          pan_not_available?: boolean | null
          professional_tax?: number | null
          quarter?: string
          rate_of_tds?: number | null
          reason_for_lower_or_nil_deduction?: string | null
          remarks?: string | null
          section_code?: string
          standard_deduction_allowed?: number | null
          surcharge_amount?: number | null
          surcharge_rate?: number | null
          tds_amount?: number | null
          tds_by_previous_employer?: number | null
          total_tax_deducted?: number | null
          trc_available?: boolean | null
          treaty_section?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_deductees_challan_id_fkey"
            columns: ["challan_id"]
            isOneToOne: false
            referencedRelation: "tds_challans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_deductees_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_deductees_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_deductees_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_demand_items: {
        Row: {
          amount_paid: number | null
          client_id: string
          computation_date: string
          computation_note: string | null
          created_at: string
          deductible_date: string | null
          deduction_date: string | null
          dispute_note: string | null
          fee_234e: number
          financial_year: string
          firm_id: string
          flag_id: string | null
          flag_type: string
          goal_number: number
          id: string
          interest_201_1a: number
          interest_months: number | null
          interest_rate_pct: number | null
          item_status: string
          late_filing_days: number | null
          nature_of_payment: string | null
          payment_date: string | null
          section_code: string | null
          tb_ledger_name: string | null
          tds_deductee_name: string | null
          tds_shortfall: number
          total_demand: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number | null
          client_id: string
          computation_date?: string
          computation_note?: string | null
          created_at?: string
          deductible_date?: string | null
          deduction_date?: string | null
          dispute_note?: string | null
          fee_234e?: number
          financial_year: string
          firm_id: string
          flag_id?: string | null
          flag_type: string
          goal_number: number
          id?: string
          interest_201_1a?: number
          interest_months?: number | null
          interest_rate_pct?: number | null
          item_status?: string
          late_filing_days?: number | null
          nature_of_payment?: string | null
          payment_date?: string | null
          section_code?: string | null
          tb_ledger_name?: string | null
          tds_deductee_name?: string | null
          tds_shortfall?: number
          total_demand?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number | null
          client_id?: string
          computation_date?: string
          computation_note?: string | null
          created_at?: string
          deductible_date?: string | null
          deduction_date?: string | null
          dispute_note?: string | null
          fee_234e?: number
          financial_year?: string
          firm_id?: string
          flag_id?: string | null
          flag_type?: string
          goal_number?: number
          id?: string
          interest_201_1a?: number
          interest_months?: number | null
          interest_rate_pct?: number | null
          item_status?: string
          late_filing_days?: number | null
          nature_of_payment?: string | null
          payment_date?: string | null
          section_code?: string | null
          tb_ledger_name?: string | null
          tds_deductee_name?: string | null
          tds_shortfall?: number
          total_demand?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_demand_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_demand_items_flag_id_fkey"
            columns: ["flag_id"]
            isOneToOne: false
            referencedRelation: "tds_recon_flags"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_edit_requests: {
        Row: {
          created_at: string | null
          filing_id: string
          firm_id: string | null
          id: string
          reason: string
          requested_by: string | null
          requested_by_name: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          status: string
        }
        Insert: {
          created_at?: string | null
          filing_id: string
          firm_id?: string | null
          id?: string
          reason: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
        }
        Update: {
          created_at?: string | null
          filing_id?: string
          firm_id?: string | null
          id?: string
          reason?: string
          requested_by?: string | null
          requested_by_name?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewed_by_name?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_edit_requests_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
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
          migrated: boolean | null
          migrated_at: string | null
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
          migrated?: boolean | null
          migrated_at?: string | null
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
          migrated?: boolean | null
          migrated_at?: string | null
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
      tds_filing_audit_log: {
        Row: {
          action_type: string
          changed_at: string | null
          changed_by: string | null
          changed_by_name: string | null
          filing_id: string | null
          firm_id: string | null
          id: string
          new_value: string | null
          old_value: string | null
          remark: string | null
        }
        Insert: {
          action_type?: string
          changed_at?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          filing_id?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          remark?: string | null
        }
        Update: {
          action_type?: string
          changed_at?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          filing_id?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          remark?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_filing_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filing_audit_log_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_filing_audit_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
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
          deductor_pan: string | null
          deductor_type: string | null
          finalized_at: string | null
          finalized_by: string | null
          financial_year: string
          firm_id: string
          id: string
          is_regular_return: boolean | null
          last_updated_at: string | null
          last_updated_by: string | null
          pdf_url: string | null
          preparer_id: string | null
          previous_filing_token: string | null
          prn_no: string | null
          quarter: string
          remarks: string | null
          responsible_person_name: string | null
          responsible_person_pan: string | null
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
          deductor_pan?: string | null
          deductor_type?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          financial_year: string
          firm_id: string
          id?: string
          is_regular_return?: boolean | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          pdf_url?: string | null
          preparer_id?: string | null
          previous_filing_token?: string | null
          prn_no?: string | null
          quarter: string
          remarks?: string | null
          responsible_person_name?: string | null
          responsible_person_pan?: string | null
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
          deductor_pan?: string | null
          deductor_type?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          financial_year?: string
          firm_id?: string
          id?: string
          is_regular_return?: boolean | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          pdf_url?: string | null
          preparer_id?: string | null
          previous_filing_token?: string | null
          prn_no?: string | null
          quarter?: string
          remarks?: string | null
          responsible_person_name?: string | null
          responsible_person_pan?: string | null
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
      tds_import_batches: {
        Row: {
          client_id: string
          created_at: string | null
          file_name: string | null
          file_type: string | null
          file_url: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id: string
          imported_at: string | null
          imported_by: string | null
          quarter: string
          row_count: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter: string
          row_count?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          file_name?: string | null
          file_type?: string | null
          file_url?: string | null
          filing_id?: string
          financial_year?: string
          firm_id?: string
          form_type?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter?: string
          row_count?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_import_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_import_batches_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_imported_rows: {
        Row: {
          amount_paid: number | null
          batch_id: string
          challan_bsr: string | null
          challan_no: string | null
          created_at: string | null
          date_of_deduction: string | null
          date_of_payment: string | null
          deductee_name: string | null
          filing_id: string
          firm_id: string
          id: string
          interest: number | null
          pan: string | null
          rate: number | null
          raw: Json | null
          row_index: number | null
          section_code: string | null
          tds_amount: number | null
        }
        Insert: {
          amount_paid?: number | null
          batch_id: string
          challan_bsr?: string | null
          challan_no?: string | null
          created_at?: string | null
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name?: string | null
          filing_id: string
          firm_id: string
          id?: string
          interest?: number | null
          pan?: string | null
          rate?: number | null
          raw?: Json | null
          row_index?: number | null
          section_code?: string | null
          tds_amount?: number | null
        }
        Update: {
          amount_paid?: number | null
          batch_id?: string
          challan_bsr?: string | null
          challan_no?: string | null
          created_at?: string | null
          date_of_deduction?: string | null
          date_of_payment?: string | null
          deductee_name?: string | null
          filing_id?: string
          firm_id?: string
          id?: string
          interest?: number | null
          pan?: string | null
          rate?: number | null
          raw?: Json | null
          row_index?: number | null
          section_code?: string | null
          tds_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_imported_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_imported_rows_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_pan_verification_batches: {
        Row: {
          client_id: string
          created_at: string | null
          file_name: string | null
          file_url: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id: string
          imported_at: string | null
          imported_by: string | null
          quarter: string
          row_count: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter: string
          row_count?: number | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          filing_id?: string
          financial_year?: string
          firm_id?: string
          form_type?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter?: string
          row_count?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_pan_verification_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_pan_verification_batches_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_pan_verification_results: {
        Row: {
          batch_id: string | null
          created_at: string | null
          detail: Json | null
          filing_id: string
          firm_id: string
          id: string
          office_deductee_id: string | null
          overridden: boolean
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          pan: string | null
          pan_row_id: string | null
          pan_status: string | null
          party_name: string | null
          quarter: string | null
          updated_at: string | null
          validation_result: string
          verified_name: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string | null
          detail?: Json | null
          filing_id: string
          firm_id: string
          id?: string
          office_deductee_id?: string | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          pan?: string | null
          pan_row_id?: string | null
          pan_status?: string | null
          party_name?: string | null
          quarter?: string | null
          updated_at?: string | null
          validation_result: string
          verified_name?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string | null
          detail?: Json | null
          filing_id?: string
          firm_id?: string
          id?: string
          office_deductee_id?: string | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          pan?: string | null
          pan_row_id?: string | null
          pan_status?: string | null
          party_name?: string | null
          quarter?: string | null
          updated_at?: string | null
          validation_result?: string
          verified_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_pan_verification_results_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_pan_verification_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_pan_verification_results_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_pan_verification_results_office_deductee_id_fkey"
            columns: ["office_deductee_id"]
            isOneToOne: false
            referencedRelation: "tds_deductees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_pan_verification_results_pan_row_id_fkey"
            columns: ["pan_row_id"]
            isOneToOne: false
            referencedRelation: "tds_pan_verification_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_pan_verification_rows: {
        Row: {
          batch_id: string
          created_at: string | null
          filing_id: string
          firm_id: string
          id: string
          mismatch_in_name: string | null
          name: string | null
          pan: string | null
          pan_status: string | null
          raw: Json | null
          row_index: number | null
          verified_name: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          filing_id: string
          firm_id: string
          id?: string
          mismatch_in_name?: string | null
          name?: string | null
          pan?: string | null
          pan_status?: string | null
          raw?: Json | null
          row_index?: number | null
          verified_name?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          filing_id?: string
          firm_id?: string
          id?: string
          mismatch_in_name?: string | null
          name?: string | null
          pan?: string | null
          pan_status?: string | null
          raw?: Json | null
          row_index?: number | null
          verified_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_pan_verification_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_pan_verification_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_pan_verification_rows_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_rate_master: {
        Row: {
          assessment_year: string
          cess_applicable: boolean | null
          created_at: string | null
          effective_from: string | null
          effective_to: string | null
          financial_year: string
          firm_id: string | null
          form_type: string
          id: string
          is_active: boolean | null
          nature_of_payment: string | null
          new_section_code: string | null
          new_section_description: string | null
          notes: string | null
          payment_code: string | null
          rate_company: number | null
          rate_individual: number | null
          rate_no_pan: number | null
          section_code: string
          section_description: string | null
          surcharge_applicable: boolean | null
          threshold_company: number | null
          threshold_individual: number | null
        }
        Insert: {
          assessment_year: string
          cess_applicable?: boolean | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          financial_year: string
          firm_id?: string | null
          form_type: string
          id?: string
          is_active?: boolean | null
          nature_of_payment?: string | null
          new_section_code?: string | null
          new_section_description?: string | null
          notes?: string | null
          payment_code?: string | null
          rate_company?: number | null
          rate_individual?: number | null
          rate_no_pan?: number | null
          section_code: string
          section_description?: string | null
          surcharge_applicable?: boolean | null
          threshold_company?: number | null
          threshold_individual?: number | null
        }
        Update: {
          assessment_year?: string
          cess_applicable?: boolean | null
          created_at?: string | null
          effective_from?: string | null
          effective_to?: string | null
          financial_year?: string
          firm_id?: string | null
          form_type?: string
          id?: string
          is_active?: boolean | null
          nature_of_payment?: string | null
          new_section_code?: string | null
          new_section_description?: string | null
          notes?: string | null
          payment_code?: string | null
          rate_company?: number | null
          rate_individual?: number | null
          rate_no_pan?: number | null
          section_code?: string
          section_description?: string | null
          surcharge_applicable?: boolean | null
          threshold_company?: number | null
          threshold_individual?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_rate_master_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_rate_master_audit_log: {
        Row: {
          action_type: string
          changed_at: string | null
          changed_by: string | null
          changed_by_name: string | null
          firm_id: string | null
          id: string
          new_value: string | null
          old_value: string | null
          rate_master_id: string | null
          remark: string | null
        }
        Insert: {
          action_type: string
          changed_at?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          rate_master_id?: string | null
          remark?: string | null
        }
        Update: {
          action_type?: string
          changed_at?: string | null
          changed_by?: string | null
          changed_by_name?: string | null
          firm_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          rate_master_id?: string | null
          remark?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_rate_master_audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_rate_master_audit_log_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_rate_master_audit_log_rate_master_id_fkey"
            columns: ["rate_master_id"]
            isOneToOne: false
            referencedRelation: "tds_rate_master"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_recon_flags: {
        Row: {
          action_note: string | null
          actioned_at: string | null
          actioned_by: string | null
          actual_rate: number | null
          actual_tds: number | null
          ai_confidence: number | null
          ai_reasoning: string | null
          book_amount: number | null
          client_id: string
          created_at: string | null
          deductee_ids: string[] | null
          expected_rate: number | null
          expected_tds: number | null
          financial_year: string
          firm_id: string
          flag_status: string
          flag_type: string
          goal_number: number | null
          id: string
          mapping_id: string | null
          nature_of_payment: string | null
          query_id: string | null
          sample_narrations: string[] | null
          section_code: string | null
          tb_ledger_name: string | null
          tds_amount: number | null
          tds_deductee_name: string | null
          threshold_amount: number | null
          updated_at: string | null
          variance_amount: number | null
          voucher_ids: string[] | null
        }
        Insert: {
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          actual_rate?: number | null
          actual_tds?: number | null
          ai_confidence?: number | null
          ai_reasoning?: string | null
          book_amount?: number | null
          client_id: string
          created_at?: string | null
          deductee_ids?: string[] | null
          expected_rate?: number | null
          expected_tds?: number | null
          financial_year: string
          firm_id: string
          flag_status?: string
          flag_type: string
          goal_number?: number | null
          id?: string
          mapping_id?: string | null
          nature_of_payment?: string | null
          query_id?: string | null
          sample_narrations?: string[] | null
          section_code?: string | null
          tb_ledger_name?: string | null
          tds_amount?: number | null
          tds_deductee_name?: string | null
          threshold_amount?: number | null
          updated_at?: string | null
          variance_amount?: number | null
          voucher_ids?: string[] | null
        }
        Update: {
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          actual_rate?: number | null
          actual_tds?: number | null
          ai_confidence?: number | null
          ai_reasoning?: string | null
          book_amount?: number | null
          client_id?: string
          created_at?: string | null
          deductee_ids?: string[] | null
          expected_rate?: number | null
          expected_tds?: number | null
          financial_year?: string
          firm_id?: string
          flag_status?: string
          flag_type?: string
          goal_number?: number | null
          id?: string
          mapping_id?: string | null
          nature_of_payment?: string | null
          query_id?: string | null
          sample_narrations?: string[] | null
          section_code?: string | null
          tb_ledger_name?: string | null
          tds_amount?: number | null
          tds_deductee_name?: string | null
          threshold_amount?: number | null
          updated_at?: string | null
          variance_amount?: number | null
          voucher_ids?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_recon_flags_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_recon_flags_mapping_id_fkey"
            columns: ["mapping_id"]
            isOneToOne: false
            referencedRelation: "tds_tb_party_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_recon_results: {
        Row: {
          batch_id: string
          created_at: string | null
          field_diffs: Json | null
          filing_id: string
          firm_id: string
          id: string
          imported_row_id: string | null
          match_status: string
          mismatch_fields: string[] | null
          office_deductee_id: string | null
          overridden: boolean
          overridden_at: string | null
          overridden_by: string | null
          override_note: string | null
          record_label: string | null
          updated_at: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          field_diffs?: Json | null
          filing_id: string
          firm_id: string
          id?: string
          imported_row_id?: string | null
          match_status?: string
          mismatch_fields?: string[] | null
          office_deductee_id?: string | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_note?: string | null
          record_label?: string | null
          updated_at?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          field_diffs?: Json | null
          filing_id?: string
          firm_id?: string
          id?: string
          imported_row_id?: string | null
          match_status?: string
          mismatch_fields?: string[] | null
          office_deductee_id?: string | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_note?: string | null
          record_label?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_recon_results_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_recon_results_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_recon_results_imported_row_id_fkey"
            columns: ["imported_row_id"]
            isOneToOne: false
            referencedRelation: "tds_imported_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_recon_results_office_deductee_id_fkey"
            columns: ["office_deductee_id"]
            isOneToOne: false
            referencedRelation: "tds_deductees"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_section_aliases: {
        Row: {
          created_at: string | null
          firm_id: string | null
          id: string
          note: string | null
          pattern: string
          priority: number
          section_code: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          pattern: string
          priority?: number
          section_code: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          firm_id?: string | null
          id?: string
          note?: string | null
          pattern?: string
          priority?: number
          section_code?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      tds_tally_batches: {
        Row: {
          client_id: string
          created_at: string | null
          file_name: string | null
          file_url: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id: string
          imported_at: string | null
          imported_by: string | null
          quarter: string
          row_count: number | null
          section: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          client_id: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          filing_id: string
          financial_year: string
          firm_id: string
          form_type: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter: string
          row_count?: number | null
          section?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string | null
          file_name?: string | null
          file_url?: string | null
          filing_id?: string
          financial_year?: string
          firm_id?: string
          form_type?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          quarter?: string
          row_count?: number | null
          section?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_tally_batches_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_tally_batches_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_tally_party_maps: {
        Row: {
          client_id: string
          created_at: string | null
          created_by: string | null
          firm_id: string
          id: string
          office_name: string | null
          office_name_norm: string
          tally_party: string
        }
        Insert: {
          client_id: string
          created_at?: string | null
          created_by?: string | null
          firm_id: string
          id?: string
          office_name?: string | null
          office_name_norm: string
          tally_party: string
        }
        Update: {
          client_id?: string
          created_at?: string | null
          created_by?: string | null
          firm_id?: string
          id?: string
          office_name?: string | null
          office_name_norm?: string
          tally_party?: string
        }
        Relationships: [
          {
            foreignKeyName: "tds_tally_party_maps_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_tally_results: {
        Row: {
          amount_basis: string | null
          batch_id: string | null
          confidence: number | null
          created_at: string | null
          filing_id: string
          firm_id: string
          id: string
          mapped: boolean
          office_amount: number | null
          office_date: string | null
          office_deductee_id: string | null
          office_name: string | null
          office_section: string | null
          office_tds: number | null
          overridden: boolean
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
          quarter: string | null
          reason: string | null
          result: string
          salary_tally_credit: number | null
          salary_tally_date: string | null
          salary_tally_party: string | null
          salary_tally_row_index: number | null
          tally_credit: number | null
          tally_date: string | null
          tally_party: string | null
          tally_row_index: number | null
          taxable_income_status: string | null
          tds_status: string | null
          updated_at: string | null
        }
        Insert: {
          amount_basis?: string | null
          batch_id?: string | null
          confidence?: number | null
          created_at?: string | null
          filing_id: string
          firm_id: string
          id?: string
          mapped?: boolean
          office_amount?: number | null
          office_date?: string | null
          office_deductee_id?: string | null
          office_name?: string | null
          office_section?: string | null
          office_tds?: number | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          quarter?: string | null
          reason?: string | null
          result: string
          salary_tally_credit?: number | null
          salary_tally_date?: string | null
          salary_tally_party?: string | null
          salary_tally_row_index?: number | null
          tally_credit?: number | null
          tally_date?: string | null
          tally_party?: string | null
          tally_row_index?: number | null
          taxable_income_status?: string | null
          tds_status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount_basis?: string | null
          batch_id?: string | null
          confidence?: number | null
          created_at?: string | null
          filing_id?: string
          firm_id?: string
          id?: string
          mapped?: boolean
          office_amount?: number | null
          office_date?: string | null
          office_deductee_id?: string | null
          office_name?: string | null
          office_section?: string | null
          office_tds?: number | null
          overridden?: boolean
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
          quarter?: string | null
          reason?: string | null
          result?: string
          salary_tally_credit?: number | null
          salary_tally_date?: string | null
          salary_tally_party?: string | null
          salary_tally_row_index?: number | null
          tally_credit?: number | null
          tally_date?: string | null
          tally_party?: string | null
          tally_row_index?: number | null
          taxable_income_status?: string | null
          tds_status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_tally_results_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_tally_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_tally_results_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_tally_results_office_deductee_id_fkey"
            columns: ["office_deductee_id"]
            isOneToOne: false
            referencedRelation: "tds_deductees"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_tally_rows: {
        Row: {
          batch_id: string
          created_at: string | null
          credit: number | null
          date_iso: string | null
          date_text: string | null
          debit: number | null
          filing_id: string
          firm_id: string
          id: string
          party: string | null
          raw: Json | null
          row_index: number | null
          section: string | null
          vch_no: string | null
          vch_type: string | null
        }
        Insert: {
          batch_id: string
          created_at?: string | null
          credit?: number | null
          date_iso?: string | null
          date_text?: string | null
          debit?: number | null
          filing_id: string
          firm_id: string
          id?: string
          party?: string | null
          raw?: Json | null
          row_index?: number | null
          section?: string | null
          vch_no?: string | null
          vch_type?: string | null
        }
        Update: {
          batch_id?: string
          created_at?: string | null
          credit?: number | null
          date_iso?: string | null
          date_text?: string | null
          debit?: number | null
          filing_id?: string
          firm_id?: string
          id?: string
          party?: string | null
          raw?: Json | null
          row_index?: number | null
          section?: string | null
          vch_no?: string | null
          vch_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_tally_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "tds_tally_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tds_tally_rows_filing_id_fkey"
            columns: ["filing_id"]
            isOneToOne: false
            referencedRelation: "tds_filings"
            referencedColumns: ["id"]
          },
        ]
      }
      tds_tb_party_mappings: {
        Row: {
          ai_reasoning: string | null
          client_id: string
          created_at: string | null
          financial_year: string
          firm_id: string
          id: string
          mapped_by: string | null
          mapping_status: string
          match_confidence: number | null
          match_method: string | null
          notes: string | null
          tb_ledger_name: string
          tb_parent_group: string | null
          tb_total_debit: number | null
          tds_deductee_name: string
          tds_filing_ids: string[] | null
          tds_section_code: string | null
          tds_total_amount: number | null
          updated_at: string | null
        }
        Insert: {
          ai_reasoning?: string | null
          client_id: string
          created_at?: string | null
          financial_year: string
          firm_id: string
          id?: string
          mapped_by?: string | null
          mapping_status?: string
          match_confidence?: number | null
          match_method?: string | null
          notes?: string | null
          tb_ledger_name: string
          tb_parent_group?: string | null
          tb_total_debit?: number | null
          tds_deductee_name: string
          tds_filing_ids?: string[] | null
          tds_section_code?: string | null
          tds_total_amount?: number | null
          updated_at?: string | null
        }
        Update: {
          ai_reasoning?: string | null
          client_id?: string
          created_at?: string | null
          financial_year?: string
          firm_id?: string
          id?: string
          mapped_by?: string | null
          mapping_status?: string
          match_confidence?: number | null
          match_method?: string | null
          notes?: string | null
          tb_ledger_name?: string
          tb_parent_group?: string | null
          tb_total_debit?: number | null
          tds_deductee_name?: string
          tds_filing_ids?: string[] | null
          tds_section_code?: string | null
          tds_total_amount?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tds_tb_party_mappings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_authorized_users: {
        Row: {
          created_at: string | null
          firm_id: string
          id: string
          is_active: boolean
          last_used_at: string | null
          linked_at: string | null
          telegram_chat_id: number
          telegram_first_name: string | null
          telegram_user_id: number
          telegram_username: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          firm_id: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          linked_at?: string | null
          telegram_chat_id: number
          telegram_first_name?: string | null
          telegram_user_id: number
          telegram_username?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          firm_id?: string
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          linked_at?: string | null
          telegram_chat_id?: number
          telegram_first_name?: string | null
          telegram_user_id?: number
          telegram_username?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_authorized_users_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_authorized_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_context: {
        Row: {
          history: Json
          last_update_id: number | null
          updated_at: string
          user_id: number
        }
        Insert: {
          history?: Json
          last_update_id?: number | null
          updated_at?: string
          user_id: number
        }
        Update: {
          history?: Json
          last_update_id?: number | null
          updated_at?: string
          user_id?: number
        }
        Relationships: []
      }
      telegram_link_tokens: {
        Row: {
          created_at: string | null
          expires_at: string | null
          firm_id: string
          id: string
          token: string
          used: boolean
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          firm_id: string
          id?: string
          token: string
          used?: boolean
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          firm_id?: string
          id?: string
          token?: string
          used?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "telegram_link_tokens_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_link_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      threecd_master_templates: {
        Row: {
          clause_number: string
          heading: string | null
          id: string
          is_applicable_default: boolean | null
          template_content: string | null
          updated_at: string | null
        }
        Insert: {
          clause_number: string
          heading?: string | null
          id?: string
          is_applicable_default?: boolean | null
          template_content?: string | null
          updated_at?: string | null
        }
        Update: {
          clause_number?: string
          heading?: string | null
          id?: string
          is_applicable_default?: boolean | null
          template_content?: string | null
          updated_at?: string | null
        }
        Relationships: []
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
      user_firm_access: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          firm_id: string
          granted_at: string
          granted_by: string | null
          id: string
          user_id: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          firm_id: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          firm_id?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_firm_access_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_firm_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_firm_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
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
          avatar_url?: string | null
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
          avatar_url?: string | null
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
      work_group_memberships: {
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
            foreignKeyName: "work_group_memberships_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "work_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      work_groups: {
        Row: {
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          firm_id: string | null
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id?: string | null
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          firm_id?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_groups_firm_id_fkey"
            columns: ["firm_id"]
            isOneToOne: false
            referencedRelation: "firms"
            referencedColumns: ["id"]
          },
        ]
      }
      zz_bkp_cle_20260620: {
        Row: {
          balance: number | null
          client_id: string | null
          created_at: string | null
          credit_amount: number | null
          debit_amount: number | null
          document_id: string | null
          entry_date: string | null
          entry_type: string | null
          financial_year: string | null
          firm_id: string | null
          id: string | null
          narration: string | null
        }
        Insert: {
          balance?: number | null
          client_id?: string | null
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          document_id?: string | null
          entry_date?: string | null
          entry_type?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string | null
          narration?: string | null
        }
        Update: {
          balance?: number | null
          client_id?: string | null
          created_at?: string | null
          credit_amount?: number | null
          debit_amount?: number | null
          document_id?: string | null
          entry_date?: string | null
          entry_type?: string | null
          financial_year?: string | null
          firm_id?: string | null
          id?: string | null
          narration?: string | null
        }
        Relationships: []
      }
      zz_bkp_ob_20260620: {
        Row: {
          amount: number | null
          balance_date: string | null
          client_id: string | null
          created_at: string | null
          created_by: string | null
          firm_id: string | null
          gstin: string | null
          id: string | null
          narration: string | null
          updated_at: string | null
        }
        Insert: {
          amount?: number | null
          balance_date?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          firm_id?: string | null
          gstin?: string | null
          id?: string | null
          narration?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          balance_date?: string | null
          client_id?: string | null
          created_at?: string | null
          created_by?: string | null
          firm_id?: string | null
          gstin?: string | null
          id?: string | null
          narration?: string | null
          updated_at?: string | null
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
      scrutiny_open_finding_counts: {
        Row: {
          client_id: string | null
          financial_year: string | null
          open_count: number | null
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
      v_billing_reconciliation: {
        Row: {
          canonical_closing: number | null
          client_id: string | null
          credit_notes: number | null
          drift: number | null
          firm_id: string | null
          invoiced: number | null
          is_balanced: boolean | null
          kasar: number | null
          ledger_closing: number | null
          opening: number | null
          received: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _tally_flip: { Args: { p: string }; Returns: string }
      allocate_doc_number: {
        Args: {
          p_financial_year: string
          p_firm_id: string
          p_invoice_date: string
          p_series: string
        }
        Returns: number
      }
      approve_week_timesheets: {
        Args: {
          p_approved_by: string
          p_from_date: string
          p_to_date: string
          p_user_id: string
        }
        Returns: number
      }
      caflow_exec: { Args: { sql: string }; Returns: undefined }
      current_user_firm_id: { Args: never; Returns: string }
      current_user_role: { Args: never; Returns: string }
      get_ledger_reconciliation: {
        Args: { p_engagement_id: string; p_ledger_name: string }
        Returns: {
          credit_total: number
          debit_total: number
          derived_closing: number
          derived_closing_type: string
          opening_balance: number
          opening_type: string
          reconciled: boolean
          tally_closing: number
          tally_closing_type: string
          variance: number
          voucher_count: number
        }[]
      }
      get_ledger_vouchers: {
        Args: { p_engagement_id: string; p_ledger_name: string }
        Returns: {
          amount: number
          dr_cr: string
          id: string
          line_items: Json
          narration: string
          party_ledger: string
          this_amount: number
          this_dr_cr: string
          voucher_date: string
          voucher_number: string
          voucher_type: string
        }[]
      }
      get_next_invoice_seq: {
        Args: {
          p_financial_year: string
          p_firm_id: string
          p_invoice_date: string
          p_series: string
        }
        Returns: number
      }
      get_portal_clients_by_email: {
        Args: never
        Returns: {
          email: string
          entity_type: string
          firm_id: string
          gstin: string[]
          id: string
          mobile: string
          name: string
          pan: string
        }[]
      }
      is_chat_conversation_admin: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_chat_conversation_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      is_party_ledger: {
        Args: { p_account_group: string; p_normalized_name: string }
        Returns: boolean
      }
      is_same_firm_user: { Args: { _user_id: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      list_ledger_variances: {
        Args: { p_engagement_id: string }
        Returns: {
          derived_closing: number
          derived_closing_type: string
          ledger_name: string
          tally_closing: number
          tally_closing_type: string
          variance: number
          voucher_count: number
        }[]
      }
      portal_client_ids: { Args: never; Returns: string[] }
      post_receipt: {
        Args: {
          p_amount: number
          p_client_id: string
          p_created_by: string
          p_financial_year: string
          p_firm_id: string
          p_gst_tds: number
          p_gstin: string
          p_invoice_id: string
          p_payment_mode: string
          p_payment_reference: string
          p_receipt_date: string
          p_receipt_type: string
          p_remarks: string
          p_tds: number
          p_tds_date: string
        }
        Returns: string
      }
      recalc_invoice_paid_for: {
        Args: { p_invoice_id: string }
        Returns: undefined
      }
      refresh_tb_period_totals: {
        Args: { p_engagement_id: string }
        Returns: number
      }
      replace_tally_results: {
        Args: { p_filing_id: string; p_rows: Json }
        Returns: undefined
      }
      run_billing_reminders: {
        Args: { p_service_key: string }
        Returns: number
      }
      set_user_context: {
        Args: { p_user_id: string; p_user_name: string; p_user_role: string }
        Returns: undefined
      }
      sync_engagement_intelligence:
        | {
            Args: {
              p_engagement_id: string
              p_entity_type: string
              p_firm_id: string
            }
            Returns: number
          }
        | {
            Args: {
              p_client_id?: string
              p_engagement_id: string
              p_entity_type: string
              p_firm_id: string
            }
            Returns: number
          }
      sync_tds_filings_for_service: {
        Args: { p_cs_id: string }
        Returns: undefined
      }
      tally_billing_firm_access: { Args: { fid: string }; Returns: boolean }
      update_overdue_invoices: { Args: { p_firm_id: string }; Returns: number }
      upsert_coa_intelligence:
        | {
            Args: {
              p_accepted: boolean
              p_account_group: string
              p_account_head: string
              p_bs_pl: string
              p_engagement_id: string
              p_entity_type: string
              p_firm_id: string
              p_normalized_name: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_accepted: boolean
              p_account_group: string
              p_account_head: string
              p_bs_pl: string
              p_client_id?: string
              p_engagement_id: string
              p_entity_type: string
              p_firm_id: string
              p_normalized_name: string
            }
            Returns: undefined
          }
      user_firm_can: {
        Args: { p_action: string; p_firm_id: string }
        Returns: boolean
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
