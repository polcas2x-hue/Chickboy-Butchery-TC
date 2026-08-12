import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { RequestForm } from '../components/RequestForm'
import { createAndSubmitRequest, type NewRequestInput } from '../lib/api'

export function RequestNew() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (input: NewRequestInput) => {
    if (!session) return
    setSubmitting(true)
    setError(null)
    try {
      const id = await createAndSubmitRequest(session.user.id, input)
      navigate(`/requests/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">New Request</h1>
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <RequestForm onSubmit={handleSubmit} submitting={submitting} />
    </div>
  )
}
