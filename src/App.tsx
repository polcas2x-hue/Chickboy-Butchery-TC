import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { RequireAuth } from './components/RoleGuard'
import { Login } from './routes/Login'
import { Dashboard } from './routes/Dashboard'
import { Requests } from './routes/Requests'
import { RequestNew } from './routes/RequestNew'
import { RequestDetail } from './routes/RequestDetail'
import { Approvals } from './routes/Approvals'
import { Reports } from './routes/Reports'

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/requests"
        element={
          <Protected>
            <Requests />
          </Protected>
        }
      />
      <Route
        path="/requests/new"
        element={
          <Protected>
            <RequestNew />
          </Protected>
        }
      />
      <Route
        path="/requests/:id"
        element={
          <Protected>
            <RequestDetail />
          </Protected>
        }
      />
      <Route
        path="/approvals"
        element={
          <Protected>
            <Approvals />
          </Protected>
        }
      />
      <Route
        path="/reports"
        element={
          <Protected>
            <Reports />
          </Protected>
        }
      />
    </Routes>
  )
}
