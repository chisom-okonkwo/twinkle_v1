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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      context_preferences: {
        Row: {
          enabled: boolean
          user_id: string
        }
        Insert: {
          enabled?: boolean
          user_id: string
        }
        Update: {
          enabled?: boolean
          user_id?: string
        }
        Relationships: []
      }
      flashback_exclusions: {
        Row: {
          note_id: string
          user_id: string
        }
        Insert: {
          note_id: string
          user_id?: string
        }
        Update: {
          note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashback_exclusions_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      flashbacks: {
        Row: {
          context_revision: number
          created_at: string
          id: string
          message: string
          note_id: string
          quote: string
          reason: string
          source_hash: string
          status: string
          user_id: string
          user_version: number
          wording: string
        }
        Insert: {
          context_revision: number
          created_at?: string
          id?: string
          message: string
          note_id: string
          quote: string
          reason: string
          source_hash: string
          status?: string
          user_id: string
          user_version: number
          wording?: string
        }
        Update: {
          context_revision?: number
          created_at?: string
          id?: string
          message?: string
          note_id?: string
          quote?: string
          reason?: string
          source_hash?: string
          status?: string
          user_id?: string
          user_version?: number
          wording?: string
        }
        Relationships: [
          {
            foreignKeyName: "flashbacks_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_attachments: {
        Row: {
          capture_id: string
          created_at: string
          note_id: string
          user_id: string
        }
        Insert: {
          capture_id: string
          created_at?: string
          note_id: string
          user_id: string
        }
        Update: {
          capture_id?: string
          created_at?: string
          note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_attachments_capture_owner_fkey"
            columns: ["capture_id", "user_id"]
            isOneToOne: false
            referencedRelation: "note_captures"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "note_attachments_note_owner_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_captures: {
        Row: {
          attempts: number
          byte_size: number
          created_at: string
          expires_at: string
          id: string
          kind: string
          mime_type: string
          processing_started_at: string | null
          result: Json | null
          status: string
          storage_path: string
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          byte_size: number
          created_at?: string
          expires_at?: string
          id: string
          kind: string
          mime_type: string
          processing_started_at?: string | null
          result?: Json | null
          status?: string
          storage_path: string
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          byte_size?: number
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          mime_type?: string
          processing_started_at?: string | null
          result?: Json | null
          status?: string
          storage_path?: string
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      note_contexts: {
        Row: {
          answer: string
          attempts: number
          error_code: string | null
          generated_context: Json | null
          last_completed_at: string | null
          model: string | null
          note_id: string
          processing_started_at: string | null
          processing_token: string | null
          prompt_anchor: string | null
          prompt_dismissed: boolean
          prompt_kind: string | null
          prompt_question: string | null
          prompt_revision: number | null
          revision: number
          source_hash: string
          status: string
          user_context: string
          user_id: string
          user_version: number
        }
        Insert: {
          answer?: string
          attempts?: number
          error_code?: string | null
          generated_context?: Json | null
          last_completed_at?: string | null
          model?: string | null
          note_id: string
          processing_started_at?: string | null
          processing_token?: string | null
          prompt_anchor?: string | null
          prompt_dismissed?: boolean
          prompt_kind?: string | null
          prompt_question?: string | null
          prompt_revision?: number | null
          revision?: number
          source_hash: string
          status?: string
          user_context?: string
          user_id: string
          user_version?: number
        }
        Update: {
          answer?: string
          attempts?: number
          error_code?: string | null
          generated_context?: Json | null
          last_completed_at?: string | null
          model?: string | null
          note_id?: string
          processing_started_at?: string | null
          processing_token?: string | null
          prompt_anchor?: string | null
          prompt_dismissed?: boolean
          prompt_kind?: string | null
          prompt_question?: string | null
          prompt_revision?: number | null
          revision?: number
          source_hash?: string
          status?: string
          user_context?: string
          user_id?: string
          user_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_contexts_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_discovery_history: {
        Row: {
          dismissed: boolean
          mode: string
          note_id: string
          note_updated_at: string
          request_id: string
          session_id: string
          shown_at: string
          user_id: string
        }
        Insert: {
          dismissed?: boolean
          mode: string
          note_id: string
          note_updated_at: string
          request_id: string
          session_id: string
          shown_at?: string
          user_id: string
        }
        Update: {
          dismissed?: boolean
          mode?: string
          note_id?: string
          note_updated_at?: string
          request_id?: string
          session_id?: string
          shown_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_discovery_history_note_id_user_id_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_reflections: {
        Row: {
          created_at: string
          original_note_id: string
          prompt_id: string
          question: string
          response_note_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          original_note_id: string
          prompt_id: string
          question: string
          response_note_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          original_note_id?: string
          prompt_id?: string
          question?: string
          response_note_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_reflections_original_note_id_user_id_fkey"
            columns: ["original_note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "note_reflections_response_note_id_user_id_fkey"
            columns: ["response_note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_relations: {
        Row: {
          explanation: string
          note_id: string
          origin_quote: string
          related_id: string
          related_quote: string
          score: number
          user_id: string
        }
        Insert: {
          explanation: string
          note_id: string
          origin_quote: string
          related_id: string
          related_quote: string
          score: number
          user_id: string
        }
        Update: {
          explanation?: string
          note_id?: string
          origin_quote?: string
          related_id?: string
          related_quote?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_relations_note_id_user_id_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "note_relations_related_id_user_id_fkey"
            columns: ["related_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_search_documents: {
        Row: {
          content_vector: unknown
          context_text: string
          document: unknown
          literal_document: unknown
          note_id: string
          title: string
          user_id: string
        }
        Insert: {
          content_vector: unknown
          context_text: string
          document: unknown
          literal_document: unknown
          note_id: string
          title: string
          user_id: string
        }
        Update: {
          content_vector?: unknown
          context_text?: string
          document?: unknown
          literal_document?: unknown
          note_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_search_documents_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: true
            referencedRelation: "notes"
            referencedColumns: ["id"]
          },
        ]
      }
      note_sources: {
        Row: {
          description: string
          name: string
          note_id: string
          source_type: string | null
          url: string
          user_id: string
          version: number
        }
        Insert: {
          description?: string
          name?: string
          note_id: string
          source_type?: string | null
          url?: string
          user_id: string
          version?: number
        }
        Update: {
          description?: string
          name?: string
          note_id?: string
          source_type?: string | null
          url?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "note_sources_note_id_user_id_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_theme_members: {
        Row: {
          content_hash: string
          evidence_field: string
          input_hash: string
          job_id: string | null
          note_id: string
          quote: string
          scope_key: string
          theme_id: string
          user_id: string
        }
        Insert: {
          content_hash: string
          evidence_field?: string
          input_hash?: string
          job_id?: string | null
          note_id: string
          quote: string
          scope_key?: string
          theme_id: string
          user_id: string
        }
        Update: {
          content_hash?: string
          evidence_field?: string
          input_hash?: string
          job_id?: string | null
          note_id?: string
          quote?: string
          scope_key?: string
          theme_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "note_theme_members_note_id_user_id_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "note_theme_members_theme_id_user_id_fkey"
            columns: ["theme_id", "user_id"]
            isOneToOne: false
            referencedRelation: "note_themes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      note_themes: {
        Row: {
          created_at: string
          description: string
          dismissed: boolean
          engine_version: number
          generated_label: string
          id: string
          theme_key: string
          user_id: string
          user_label: string | null
        }
        Insert: {
          created_at?: string
          description: string
          dismissed?: boolean
          engine_version?: number
          generated_label: string
          id?: string
          theme_key: string
          user_id: string
          user_label?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          dismissed?: boolean
          engine_version?: number
          generated_label?: string
          id?: string
          theme_key?: string
          user_id?: string
          user_label?: string | null
        }
        Relationships: []
      }
      notes: {
        Row: {
          capture_method: string
          content: string
          created_at: string
          has_attachments: boolean
          id: string
          import_metadata: Json | null
          source_capture_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          capture_method?: string
          content: string
          created_at?: string
          has_attachments?: boolean
          id?: string
          import_metadata?: Json | null
          source_capture_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          capture_method?: string
          content?: string
          created_at?: string
          has_attachments?: boolean
          id?: string
          import_metadata?: Json | null
          source_capture_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notes_source_capture_id_fkey"
            columns: ["source_capture_id"]
            isOneToOne: true
            referencedRelation: "note_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      push_devices: {
        Row: {
          active: boolean
          expo_token: string
          installation_id: string
          platform: string
          registered_at: string
          session_id: string
          token_version: string
          user_id: string
        }
        Insert: {
          active?: boolean
          expo_token: string
          installation_id: string
          platform: string
          registered_at?: string
          session_id: string
          token_version?: string
          user_id: string
        }
        Update: {
          active?: boolean
          expo_token?: string
          installation_id?: string
          platform?: string
          registered_at?: string
          session_id?: string
          token_version?: string
          user_id?: string
        }
        Relationships: []
      }
      recall_preferences: {
        Row: {
          detailed_previews: boolean
          frequency: string
          timezone: string
          updated_at: string
          user_id: string
          window_end: number
          window_start: number
        }
        Insert: {
          detailed_previews?: boolean
          frequency?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          window_end?: number
          window_start?: number
        }
        Update: {
          detailed_previews?: boolean
          frequency?: string
          timezone?: string
          updated_at?: string
          user_id?: string
          window_end?: number
          window_start?: number
        }
        Relationships: []
      }
      related_note_dismissals: {
        Row: {
          dismissed_at: string
          note_a: string
          note_b: string
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          note_a: string
          note_b: string
          user_id: string
        }
        Update: {
          dismissed_at?: string
          note_a?: string
          note_b?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_note_dismissals_note_a_user_id_fkey"
            columns: ["note_a", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "related_note_dismissals_note_b_user_id_fkey"
            columns: ["note_b", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      related_note_runs: {
        Row: {
          completed_at: string | null
          library_revision: number
          model: string | null
          note_id: string
          started_at: string
          status: string
          token: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          library_revision: number
          model?: string | null
          note_id: string
          started_at?: string
          status: string
          token?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          library_revision?: number
          model?: string | null
          note_id?: string
          started_at?: string
          status?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "related_note_runs_note_id_user_id_fkey"
            columns: ["note_id", "user_id"]
            isOneToOne: false
            referencedRelation: "notes"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_semantic_history: {
        Args: { caller_id: string }
        Returns: undefined
      }
      answer_reflective_prompt: {
        Args: { body: string; prompt_id: string }
        Returns: string
      }
      authorize_capture_cleanup: { Args: { token: string }; Returns: boolean }
      authorize_recall_scheduler: { Args: { secret: string }; Returns: boolean }
      authorize_semantic_worker: { Args: { secret: string }; Returns: boolean }
      begin_semantic_scope: {
        Args: { caller_id: string; run_token: string; scope: string }
        Returns: undefined
      }
      cache_semantic_validation: {
        Args: {
          caller_id: string
          claim_token: string
          result: Json
          target_job: string
        }
        Returns: boolean
      }
      claim_capture_deletion: {
        Args: { caller_id?: string; capture_id: string }
        Returns: {
          attempts: number
          byte_size: number
          created_at: string
          expires_at: string
          id: string
          kind: string
          mime_type: string
          processing_started_at: string | null
          result: Json | null
          status: string
          storage_path: string
          user_id: string | null
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "note_captures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_note_capture: {
        Args: { caller_id: string; capture_id: string }
        Returns: {
          attempts: number
          byte_size: number
          created_at: string
          expires_at: string
          id: string
          kind: string
          mime_type: string
          processing_started_at: string | null
          result: Json | null
          status: string
          storage_path: string
          user_id: string | null
          verified_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "note_captures"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_note_context: {
        Args: {
          caller_id: string
          manual?: boolean
          retry?: boolean
          target_id: string
        }
        Returns: Json
      }
      claim_reflection_analysis: {
        Args: { caller_id: string; kind: string; target_id: string }
        Returns: Json
      }
      claim_related_notes: {
        Args: { caller_id: string; retry?: boolean; target_id: string }
        Returns: Json
      }
      claim_semantic_embeddings: {
        Args: { caller_id: string; run_token: string }
        Returns: Json
      }
      claim_semantic_group: {
        Args: { caller_id: string; run_token: string; scope: string }
        Returns: Json
      }
      claim_semantic_run: {
        Args: { caller_id: string; retry?: boolean }
        Returns: Json
      }
      discovery_candidates: {
        Args: {
          caller_id: string
          discovery_session: string
          page_offset?: number
        }
        Returns: Json
      }
      discovery_card: {
        Args: { caller_id: string; discovery_request: string }
        Returns: Json
      }
      dismiss_note_connection: {
        Args: { origin_id: string; target_id: string }
        Returns: undefined
      }
      dismiss_reflective_prompt: {
        Args: { prompt_id: string }
        Returns: undefined
      }
      end_semantic_run: {
        Args: {
          caller_id: string
          diagnostics?: Json
          failure?: string
          run_token: string
        }
        Returns: undefined
      }
      enqueue_semantic_group: {
        Args: {
          caller_id: string
          cores: Json
          model_name: string
          scope: string
        }
        Returns: string
      }
      fail_note_context: {
        Args: {
          caller_id: string
          claim_token: string
          code: string
          expected_revision: number
          target_id: string
        }
        Returns: undefined
      }
      fail_reflection_analysis: {
        Args: {
          caller_id: string
          claim_token: string
          kind: string
          target_id: string
        }
        Returns: undefined
      }
      fail_semantic_embeddings: {
        Args: { caller_id: string; claims: Json; failure: string }
        Returns: undefined
      }
      fail_semantic_group: {
        Args: {
          caller_id: string
          claim_token: string
          failure: string
          target_job: string
        }
        Returns: undefined
      }
      finish_note_context: {
        Args: {
          caller_id: string
          claim_token: string
          expected_revision: number
          model_name: string
          payload: Json
          question: Json
          target_id: string
        }
        Returns: boolean
      }
      finish_reflection_analysis: {
        Args: {
          caller_id: string
          claim_token: string
          expected_hash: string
          kind: string
          result: Json
          target_id: string
        }
        Returns: boolean
      }
      finish_related_notes: {
        Args: {
          caller_id: string
          claim_token: string
          expected_revision: number
          links: Json
          model_name: string
          target_id: string
        }
        Returns: boolean
      }
      finish_semantic_embeddings: {
        Args: { caller_id: string; results: Json }
        Returns: number
      }
      finish_semantic_work: {
        Args: { caller_id: string; run_token: string; scope: string }
        Returns: undefined
      }
      import_text_note: {
        Args: { body: string; file_name: string; metadata?: Json }
        Returns: Json
      }
      list_note_attachments: {
        Args: { target_id: string }
        Returns: {
          capture_id: string
          created_at: string
          kind: string
        }[]
      }
      mark_semantic_no_candidates: {
        Args: {
          caller_id: string
          expected_hash: string
          scope: string
          target_id: string
        }
        Returns: undefined
      }
      note_theme_snapshot: { Args: { period?: string }; Returns: Json }
      persist_semantic_validation: {
        Args: { caller_id: string; claim_token: string; target_job: string }
        Returns: Json
      }
      prepare_semantic_scope: {
        Args: {
          caller_id: string
          period?: string
          range_end?: string
          range_start?: string
          zone?: string
        }
        Returns: Json
      }
      read_note_theme_members: {
        Args: { page_offset?: number; period?: string; target_id: string }
        Returns: Json
      }
      read_reflection_experience: {
        Args: { kind: string; target_id: string }
        Returns: Json
      }
      read_related_notes: {
        Args: { target_id: string }
        Returns: {
          created_at: string
          explanation: string
          id: string
          title: string
        }[]
      }
      read_resurfaced_notes: {
        Args: { target_id: string }
        Returns: {
          created_at: string
          explanation: string
          id: string
          title: string
        }[]
      }
      recall_service: {
        Args: { action: string; owner_id?: string; payload?: Json }
        Returns: Json
      }
      record_capture_rediscovery: {
        Args: { caller_id: string; origin_id: string; target_ids: string[] }
        Returns: undefined
      }
      record_semantic_usage: {
        Args: {
          call_id: string
          caller_id: string
          elapsed_ms?: number
          input_tokens: number
          kind: string
          model: string
          output_tokens?: number
          request_count?: number
        }
        Returns: undefined
      }
      rediscovery_eligible: {
        Args: { owner_id: string; target_id: string }
        Returns: boolean
      }
      refresh_semantic_relation_batch: {
        Args: { caller_id: string }
        Returns: number
      }
      refresh_semantic_relations: {
        Args: { caller_id: string; target_id: string }
        Returns: number
      }
      register_recall_device: {
        Args: { device_platform: string; installation: string; token: string }
        Returns: undefined
      }
      related_note_candidates: {
        Args: { caller_id: string; target_id: string; terms: string[] }
        Returns: Json
      }
      related_note_input: {
        Args: { caller_id: string; target_id: string }
        Returns: Json
      }
      request_semantic_work: {
        Args: { caller_id: string; retry?: boolean; scope: string }
        Returns: undefined
      }
      reserve_discovery: {
        Args: {
          caller_id: string
          candidates: Json
          discovery_mode: string
          discovery_request: string
          discovery_session: string
        }
        Returns: Json
      }
      respond_flashback: {
        Args: { feedback: string; target_id: string }
        Returns: undefined
      }
      retry_semantic_groups: { Args: { caller_id: string }; Returns: undefined }
      save_note_with_attachments: {
        Args: {
          body: string
          capture_ids?: string[]
          expected_updated_at?: string
          initial_capture_id?: string
          note_title?: string
          target_id: string
        }
        Returns: {
          capture_method: string
          content: string
          created_at: string
          has_attachments: boolean
          id: string
          import_metadata: Json | null
          source_capture_id: string | null
          title: string
          updated_at: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_notes: {
        Args: { page_limit?: number; page_offset?: number; search_text: string }
        Returns: {
          capture_method: string
          created_at: string
          id: string
          matched_context: boolean
          preview: string
          rank: number
          title: string
          updated_at: string
        }[]
      }
      semantic_backlog: { Args: never; Returns: Json }
      semantic_candidate_graph: {
        Args: { caller_id: string; scope: string; target_id: string }
        Returns: Json
      }
      semantic_index_snapshot: { Args: never; Returns: Json }
      semantic_neighbours: {
        Args: {
          caller_id: string
          max_count?: number
          range_end?: string
          range_start?: string
          target_id: string
        }
        Returns: Json
      }
      semantic_note_payload: {
        Args: { caller_id: string; target_id: string }
        Returns: Json
      }
      semantic_scope_anchors: {
        Args: { caller_id: string; scope: string }
        Returns: Json
      }
      unregister_recall_device: {
        Args: { installation: string }
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
    Enums: {},
  },
} as const
