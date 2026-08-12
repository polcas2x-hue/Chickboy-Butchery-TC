import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { fetchApprovalQueue } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'

export function Approvals() {
  const { data, isLoading } = useQuery({
    queryKey: ['approval-queue'],
    queryFn: fetchApprovalQueue,
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Approvals</h1>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Step</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((step) => (
              <tr key={step.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <Link
                    to={`/requests/${step.requests.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {step.requests.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-500">{step.requests.type}</td>
                <td className="px-4 py-3 text-slate-500">
                  {step.requests.amount != null ? step.requests.amount : '—'}
                </td>
                <td className="px-4 py-3 capitalize text-slate-500">{step.approver_role}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={step.requests.status} />
                </td>
              </tr>
            ))}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={5}>
                  Nothing waiting on you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
