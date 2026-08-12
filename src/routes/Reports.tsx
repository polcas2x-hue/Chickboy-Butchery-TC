import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchReportRequests } from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
import type { RequestStatus } from '../lib/database.types'

const STATUSES: RequestStatus[] = [
  'draft',
  'pending_manager',
  'pending_admin',
  'approved',
  'rejected',
  'cancelled',
]

function toCsv(rows: { id: string; type: string; title: string; amount: number | null; status: string; created_at: string }[]) {
  const header = ['id', 'type', 'title', 'amount', 'status', 'created_at']
  const lines = rows.map((r) =>
    header
      .map((key) => {
        const value = (r as Record<string, unknown>)[key]
        const str = value == null ? '' : String(value)
        return `"${str.replace(/"/g, '""')}"`
      })
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}

export function Reports() {
  const [status, setStatus] = useState<RequestStatus | ''>('')
  const [type, setType] = useState('')

  const { data } = useQuery({
    queryKey: ['reports', status, type],
    queryFn: () => fetchReportRequests({ status: status || undefined, type: type || undefined }),
  })

  const handleExport = () => {
    if (!data) return
    const csv = toCsv(data)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'requests.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Reports</h1>
        <button
          onClick={handleExport}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100"
        >
          Export CSV
        </button>
      </div>

      <div className="flex gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as RequestStatus | '')}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="Filter by type"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
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
                <td className="px-4 py-3 font-medium text-slate-900">{r.title}</td>
                <td className="px-4 py-3 text-slate-500">{r.type}</td>
                <td className="px-4 py-3 text-slate-500">{r.amount != null ? r.amount : '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {data?.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-400" colSpan={5}>
                  No matching requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
