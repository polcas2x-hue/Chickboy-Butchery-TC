import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import type { UserRole } from '../lib/database.types'

export function RoleGuard({
  allow,
  children,
}: {
  allow: UserRole[]
  children: ReactNode
}) {
  const { session, profile, loading } = useAuth()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!profile || !allow.includes(profile.role)) return <Navigate to="/" replace />

  return <>{children}</>
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) return null
  if (!session) return <Navigate to="/login" replace />

  return <>{children}</>
}
