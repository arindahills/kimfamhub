import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import './i18n'

import { AuthProvider, useAuth } from './context/AuthContext'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'
import PlaceholderPage from './pages/PlaceholderPage'
import HomePage from './pages/HomePage'
import FinancesPage from './pages/FinancesPage'
import ActionsPage from './pages/ActionsPage'
import MeetingsPage from './pages/MeetingsPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function AuthGate() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  if (!user) return <LoginPage />

  return (
    <AppShell>
      <Routes>
        <Route path="/"         element={<HomePage />} />
        <Route path="/updates"  element={<PlaceholderPage navKey="updates"  icon="📰" />} />
        <Route path="/actions"  element={<ActionsPage />} />
        <Route path="/finances" element={<FinancesPage />} />
        <Route path="/members"  element={<PlaceholderPage navKey="members"  icon="👨‍👩‍👧‍👦" />} />
        <Route path="/projects" element={<PlaceholderPage navKey="projects" icon="🌾" />} />
        <Route path="/equity"   element={<PlaceholderPage navKey="equity"   icon="⚖️" />} />
        <Route path="/loans"    element={<PlaceholderPage navKey="loans"    icon="🏦" />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/docs"     element={<PlaceholderPage navKey="docs"     icon="📁" />} />
        <Route path="/ask"      element={<PlaceholderPage navKey="ask"      icon="🤖" />} />
        <Route path="/admin"    element={<PlaceholderPage navKey="admin"    icon="⚙️" />} />
        <Route path="*"         element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={null}>
            <AuthGate />
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
