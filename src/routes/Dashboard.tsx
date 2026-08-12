import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { fetchApprovalQueue, fetchMyRequests } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import type { RequestStatus } from '../lib/database.types'

const COUNT_STATUSES: RequestStatus[] = ['pending_manager', 'pending_admin', 'approved', 'rejected']

export function Dashboard() {
  const { session, profile } = useAuth()
  const canApprove = profile?.role === 'manager' || profile?.role === 'admin'

  const { data: myRequests } = useQuery({
    queryKey: ['my-requests', session?.user.id],
    queryFn: () => fetchMyRequests(session!.user.id),
    enabled: !!session,
  })

  const { data: queue } = useQuery({
    queryKey: ['approval-queue'],
    queryFn: fetchApprovalQueue,
    enabled: canApprove,
  })

  const counts = COUNT_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = myRequests?.filter((r) => r.status === status).length ?? 0
    return acc
  }, {})

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">Welcome back, {profile?.full_name ?? '…'}.</p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-500">Your requests</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {COUNT_STATUSES.map((status) => (
            <div key={status} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-2xl font-semibold text-slate-900">{counts[status]}</div>
              <div className="mt-1">
                <StatusBadge status={status} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {canApprove && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-500">Awaiting your decision</h2>
            <Link to="/approvals" className="text-sm text-slate-600 underline">
              View queue
            </Link>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-2xl font-semibold text-slate-900">{queue?.length ?? 0}</div>
            <p className="text-sm text-slate-500">pending approval steps</p>
          </div>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-500">Recent requests</h2>
          <Link to="/requests" className="text-sm text-slate-600 underline">
            View all
          </Link>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <tbody>
              {(myRequests ?? []).slice(0, 5).map((r) => (
                <tr key={r.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <Link to={`/requests/${r.id}`} className="font-medium text-slate-900 hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.type}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
              {myRequests?.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-slate-400" colSpan={3}>
                    No requests yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
