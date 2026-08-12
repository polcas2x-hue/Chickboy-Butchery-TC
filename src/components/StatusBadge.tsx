import type { RequestStatus } from '../lib/database.types'

const STYLES: Record<RequestStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_manager: 'bg-amber-100 text-amber-800',
  pending_admin: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

const LABELS: Record<RequestStatus, string> = {
  draft: 'Draft',
  pending_manager: 'Pending manager',
  pending_admin: 'Pending admin',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
