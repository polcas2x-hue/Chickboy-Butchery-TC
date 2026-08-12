import { supabase } from './supabaseClient'
import type { ApprovalStep, AuditLogEntry, RequestRow, RequestStatus } from './database.types'

export async function fetchMyRequests(userId: string): Promise<RequestRow[]> {
  const { data, error } = await supabase
    .from('requests')
    .select('*')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function fetchRequest(id: string): Promise<RequestRow> {
  const { data, error } = await supabase.from('requests').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function fetchApprovalSteps(requestId: string): Promise<ApprovalStep[]> {
  const { data, error } = await supabase
    .from('approval_steps')
    .select('*')
    .eq('request_id', requestId)
    .order('step_order', { ascending: true })
  if (error) throw error
  return data
}

export async function fetchAuditLog(requestId: string): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export interface NewRequestInput {
  type: string
  title: string
  description: string
  amount: number | null
}

export async function createAndSubmitRequest(userId: string, input: NewRequestInput) {
  const { data, error } = await supabase
    .from('requests')
    .insert({
      requester_id: userId,
      type: input.type,
      title: input.title,
      description: input.description || null,
      amount: input.amount,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error) throw error

  const { error: submitError } = await supabase.rpc('submit_request', {
    p_request_id: data.id,
  })
  if (submitError) throw submitError

  return data.id as string
}

export async function decideStep(stepId: string, decision: 'approved' | 'rejected', comment: string) {
  const { error } = await supabase.rpc('decide_step', {
    p_step_id: stepId,
    p_decision: decision,
    p_comment: comment || null,
  })
  if (error) throw error
}

// Steps currently awaiting the signed-in user's decision (assigned to them,
// or unassigned admin steps if the user is an admin).
export async function fetchApprovalQueue(): Promise<(ApprovalStep & { requests: RequestRow })[]> {
  const { data, error } = await supabase
    .from('approval_steps')
    .select('*, requests(*)')
    .eq('status', 'pending')
    .order('id')
  if (error) throw error
  return data as unknown as (ApprovalStep & { requests: RequestRow })[]
}

export interface ReportFilters {
  status?: RequestStatus
  type?: string
}

export async function fetchReportRequests(filters: ReportFilters): Promise<RequestRow[]> {
  let query = supabase.from('requests').select('*').order('created_at', { ascending: false })
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.type) query = query.eq('type', filters.type)
  const { data, error } = await query
  if (error) throw error
  return data
}
