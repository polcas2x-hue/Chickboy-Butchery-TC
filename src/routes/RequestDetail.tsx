import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { decideStep, fetchApprovalSteps, fetchAuditLog, fetchRequest } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

export function RequestDetail() {
  const { id } = useParams<{ id: string }>()
  const { session, profile } = useAuth()
  const queryClient = useQueryClient()
  const [comment, setComment] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: request } = useQuery({
    queryKey: ['request', id],
    queryFn: () => fetchRequest(id!),
    enabled: !!id,
  })
  const { data: steps } = useQuery({
    queryKey: ['approval-steps', id],
    queryFn: () => fetchApprovalSteps(id!),
    enabled: !!id,
  })
  const { data: auditLog } = useQuery({
    queryKey: ['audit-log', id],
    queryFn: () => fetchAuditLog(id!),
    enabled: !!id,
  })

  if (!request) return null

  const pendingStep = steps?.find((s) => s.status === 'pending')
  const canDecide =
    pendingStep &&
    session &&
    profile &&
    (pendingStep.approver_id
      ? pendingStep.approver_id === session.user.id
      : pendingStep.approver_role === profile.role || profile.role === 'admin')

  const handleDecide = async (decision: 'approved' | 'rejected') => {
    if (!pendingStep) return
    setDeciding(true)
    setError(null)
    try {
      await decideStep(pendingStep.id, decision, comment)
      setComment('')
      await queryClient.invalidateQueries({ queryKey: ['request', id] })
      await queryClient.invalidateQueries({ queryKey: ['approval-steps', id] })
      await queryClient.invalidateQueries({ queryKey: ['audit-log', id] })
      await queryClient.invalidateQueries({ queryKey: ['approval-queue'] })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setDeciding(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">{request.title}</h1>
          <StatusBadge status={request.status} />
        </div>
        <p className="text-sm text-slate-500">
          {request.type} {request.amount != null && `· ${request.amount}`}
        </p>
      </div>

      {request.description && <p className="text-sm text-slate-700">{request.description}</p>}

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Approval chain</h2>
        <ol className="space-y-2">
          {steps?.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <span className="capitalize text-slate-700">{s.approver_role}</span>
              <span className="text-slate-500">{s.status}</span>
            </li>
          ))}
        </ol>
      </section>

      {canDecide && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-medium text-slate-500">Your decision</h2>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional comment"
            rows={2}
            className="mb-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button
              disabled={deciding}
              onClick={() => void handleDecide('approved')}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              disabled={deciding}
              onClick={() => void handleDecide('rejected')}
              className="rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-medium text-slate-500">Activity</h2>
        <ul className="space-y-1 text-sm text-slate-600">
          {auditLog?.map((entry) => (
            <li key={entry.id}>
              {new Date(entry.created_at).toLocaleString()} — {entry.action}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
