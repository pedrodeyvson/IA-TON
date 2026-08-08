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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      conversas: {
        Row: {
          assumida_em: string | null
          criado_em: string
          id: string
          lead_id: string
          pausada_pela_ia: boolean
        }
        Insert: {
          assumida_em?: string | null
          criado_em?: string
          id?: string
          lead_id: string
          pausada_pela_ia?: boolean
        }
        Update: {
          assumida_em?: string | null
          criado_em?: string
          id?: string
          lead_id?: string
          pausada_pela_ia?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "conversas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_capi: {
        Row: {
          criado_em: string
          enviado_em: string | null
          event_id: string
          id: string
          lead_id: string
          nome_evento: string
          status_resposta: string | null
        }
        Insert: {
          criado_em?: string
          enviado_em?: string | null
          event_id: string
          id?: string
          lead_id: string
          nome_evento: string
          status_resposta?: string | null
        }
        Update: {
          criado_em?: string
          enviado_em?: string | null
          event_id?: string
          id?: string
          lead_id?: string
          nome_evento?: string
          status_resposta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_capi_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_lead: {
        Row: {
          criado_em: string
          detalhe: Json | null
          id: string
          lead_id: string
          tipo_evento: string
        }
        Insert: {
          criado_em?: string
          detalhe?: Json | null
          id?: string
          lead_id: string
          tipo_evento: string
        }
        Update: {
          criado_em?: string
          detalhe?: Json | null
          id?: string
          lead_id?: string
          tipo_evento?: string
        }
        Relationships: [
          {
            foreignKeyName: "eventos_lead_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ad_conversion_source: string | null
          ad_referral_raw: Json | null
          ad_source_app: string | null
          ad_source_id: string | null
          ad_source_url: string | null
          ad_title: string | null
          atualizado_em: string
          comissao_confirmada: number | null
          comissao_estimada: number | null
          criado_em: string
          ctwa_clid: string | null
          estagio: string
          external_id: string | null
          id: string
          maquina_interesse: string | null
          nao_lidas: number
          nome: string | null
          origem: string | null
          precisa_atencao: boolean
          telefone: string | null
          telefone_normalizado: string | null
          ultima_mensagem_direcao: string | null
          ultima_mensagem_em: string | null
          ultima_mensagem_preview: string | null
        }
        Insert: {
          ad_conversion_source?: string | null
          ad_referral_raw?: Json | null
          ad_source_app?: string | null
          ad_source_id?: string | null
          ad_source_url?: string | null
          ad_title?: string | null
          atualizado_em?: string
          comissao_confirmada?: number | null
          comissao_estimada?: number | null
          criado_em?: string
          ctwa_clid?: string | null
          estagio?: string
          external_id?: string | null
          id?: string
          maquina_interesse?: string | null
          nao_lidas?: number
          nome?: string | null
          origem?: string | null
          precisa_atencao?: boolean
          telefone?: string | null
          telefone_normalizado?: string | null
          ultima_mensagem_direcao?: string | null
          ultima_mensagem_em?: string | null
          ultima_mensagem_preview?: string | null
        }
        Update: {
          ad_conversion_source?: string | null
          ad_referral_raw?: Json | null
          ad_source_app?: string | null
          ad_source_id?: string | null
          ad_source_url?: string | null
          ad_title?: string | null
          atualizado_em?: string
          comissao_confirmada?: number | null
          comissao_estimada?: number | null
          criado_em?: string
          ctwa_clid?: string | null
          estagio?: string
          external_id?: string | null
          id?: string
          maquina_interesse?: string | null
          nao_lidas?: number
          nome?: string | null
          origem?: string | null
          precisa_atencao?: boolean
          telefone?: string | null
          telefone_normalizado?: string | null
          ultima_mensagem_direcao?: string | null
          ultima_mensagem_em?: string | null
          ultima_mensagem_preview?: string | null
        }
        Relationships: []
      }
      mensagens: {
        Row: {
          conteudo: string | null
          conversa_id: string
          criado_em: string
          direcao: string
          id: string
          lead_id: string
          media_filename: string | null
          media_mime: string | null
          media_path: string | null
          provider_message_id: string | null
          raw: Json | null
          remetente: string
          timestamp_ms: number
          tipo: string
          transcricao: string | null
          transcricao_status: string | null
        }
        Insert: {
          conteudo?: string | null
          conversa_id: string
          criado_em?: string
          direcao: string
          id?: string
          lead_id: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          provider_message_id?: string | null
          raw?: Json | null
          remetente: string
          timestamp_ms?: number
          tipo: string
          transcricao?: string | null
          transcricao_status?: string | null
        }
        Update: {
          conteudo?: string | null
          conversa_id?: string
          criado_em?: string
          direcao?: string
          id?: string
          lead_id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_path?: string | null
          provider_message_id?: string | null
          raw?: Json | null
          remetente?: string
          timestamp_ms?: number
          tipo?: string
          transcricao?: string | null
          transcricao_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mensagens_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          criado_em: string
          event_type: string | null
          headers: Json | null
          id: string
          last_error: string | null
          next_retry_at: string
          processed_at: string | null
          raw_body: Json
          source: string
          status: string
        }
        Insert: {
          attempts?: number
          criado_em?: string
          event_type?: string | null
          headers?: Json | null
          id?: string
          last_error?: string | null
          next_retry_at?: string
          processed_at?: string | null
          raw_body: Json
          source: string
          status?: string
        }
        Update: {
          attempts?: number
          criado_em?: string
          event_type?: string | null
          headers?: Json | null
          id?: string
          last_error?: string | null
          next_retry_at?: string
          processed_at?: string | null
          raw_body?: Json
          source?: string
          status?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      eh_dono: { Args: never; Returns: boolean }
      normalizar_telefone_br: { Args: { p: string }; Returns: string }
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
