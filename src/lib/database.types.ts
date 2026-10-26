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
      notes: {
        Row: {
          capture_method: string
          content: string
          created_at: string
          id: string
          source_capture_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capture_method?: string
          content: string
          created_at?: string
          id?: string
          source_capture_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          capture_method?: string
          content?: string
          created_at?: string
          id?: string
          source_capture_id?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      authorize_capture_cleanup: { Args: { token: string }; Returns: boolean }
      authorize_recall_scheduler: { Args: { secret: string }; Returns: boolean }
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
      recall_service: {
        Args: { action: string; owner_id?: string; payload?: Json }
        Returns: Json
      }
      register_recall_device: {
        Args: { device_platform: string; installation: string; token: string }
        Returns: undefined
      }
      respond_flashback: {
        Args: { feedback: string; target_id: string }
        Returns: undefined
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
