import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth()
  const canApprove = profile?.role === 'manager' || profile?.role === 'admin'

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-slate-900">Chickboy Training Center</span>
            <nav className="flex gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Dashboard
              </NavLink>
              <NavLink to="/requests" className={navLinkClass}>
                My Requests
              </NavLink>
              {canApprove && (
                <NavLink to="/approvals" className={navLinkClass}>
                  Approvals
                </NavLink>
              )}
              <NavLink to="/reports" className={navLinkClass}>
                Reports
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>
              {profile?.full_name ?? 'Loading…'}{' '}
              {profile && <span className="text-slate-400">({profile.role})</span>}
            </span>
            <button
              onClick={() => void signOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
