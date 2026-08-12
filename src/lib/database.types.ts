// Hand-written to match supabase/migrations/*.sql.
// Once the Supabase project is live, regenerate with:
//   supabase gen types typescript --linked > src/lib/database.types.ts

export type UserRole = 'requester' | 'manager' | 'admin'

export type RequestStatus =
  | 'draft'
  | 'pending_manager'
  | 'pending_admin'
  | 'approved'
  | 'rejected'
  | 'cancelled'

export type ApproverRole = 'manager' | 'admin'

export type StepStatus = 'pending' | 'approved' | 'rejected' | 'skipped'

// NB: these are `type` aliases, not `interface`s, on purpose -- interfaces
// break Supabase's conditional-type resolution for from(...).insert()/.rpc()
// (the whole schema silently collapses to `never`). See scratch repro during
// development; keep these as `type`.
export type Profile = {
  id: string
  full_name: string | null
  role: UserRole
  manager_id: string | null
  created_at: string
}

export type RequestRow = {
  id: string
  requester_id: string
  type: string
  title: string
  description: string | null
  amount: number | null
  status: RequestStatus
  created_at: string
  updated_at: string
}

export type ApprovalStep = {
  id: string
  request_id: string
  step_order: number
  approver_role: ApproverRole
  approver_id: string | null
  status: StepStatus
  comment: string | null
  decided_at: string | null
}

export type AuditLogEntry = {
  id: string
  request_id: string
  actor_id: string | null
  action: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          full_name?: string | null
          role?: UserRole
          manager_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          full_name?: string | null
          role?: UserRole
          manager_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      requests: {
        Row: RequestRow
        Insert: {
          id?: string
          requester_id: string
          type: string
          title: string
          description?: string | null
          amount?: number | null
          status?: RequestStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          requester_id?: string
          type?: string
          title?: string
          description?: string | null
          amount?: number | null
          status?: RequestStatus
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      approval_steps: {
        Row: ApprovalStep
        Insert: {
          id?: string
          request_id: string
          step_order: number
          approver_role: ApproverRole
          approver_id?: string | null
          status?: StepStatus
          comment?: string | null
          decided_at?: string | null
        }
        Update: {
          id?: string
          request_id?: string
          step_order?: number
          approver_role?: ApproverRole
          approver_id?: string | null
          status?: StepStatus
          comment?: string | null
          decided_at?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: AuditLogEntry
        Insert: {
          id?: string
          request_id: string
          actor_id?: string | null
          action: string
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          actor_id?: string | null
          action?: string
          metadata?: Record<string, unknown> | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      submit_request: {
        Args: { p_request_id: string }
        Returns: void
      }
      decide_step: {
        Args: { p_step_id: string; p_decision: 'approved' | 'rejected'; p_comment?: string | null }
        Returns: void
      }
    }
  }
}
