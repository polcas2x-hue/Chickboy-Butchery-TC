import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { fetchMyRequests } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

export function Requests() {
  const { session } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['my-requests', session?.user.id],
    queryFn: () => fetchMyRequests(session!.user.id),
    enabled: !!session,
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">My Requests</h1>
        <Link
          to="/requests/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          New request
        </Link>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link to={`/requests/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{r.type}</td>
                <td className="px-4 py-3 text-slate-500">{r.amount != null ? r.amount : '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={5}>
                  No requests yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
