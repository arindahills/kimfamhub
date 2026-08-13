import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense } from 'react'
import './i18n'

import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import AppShell from './components/AppShell'
import LoginPage from './pages/LoginPage'

const KLAFAM_MEMBERS = ['Hillary', 'Esther', 'Max', 'Alex', 'Priscilla']
import HomePage from './pages/HomePage'
import FinancesPage from './pages/FinancesPage'
import ActionsPage from './pages/ActionsPage'
import MeetingsPage from './pages/MeetingsPage'
import UpdatesPage from './pages/UpdatesPage'
import MembersPage from './pages/MembersPage'
import ProjectsPage from './pages/ProjectsPage'
import EquityPage from './pages/EquityPage'
import LoansPage from './pages/LoansPage'
import DocsPage from './pages/DocsPage'
import ProposalsPage from './pages/ProposalsPage'
import AskPage from './pages/AskPage'
import AdminPage from './pages/AdminPage'
import ExpenditurePage from './pages/ExpenditurePage'
import EngagementPage from './pages/EngagementPage'
import KlaFamPage from './pages/KlaFamPage'

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

  const isKlaFamMember = user.name ? KLAFAM_MEMBERS.includes(user.name) : false

  return (
    <AppShell>
      <Routes>
        <Route path="/"         element={<HomePage />} />
        <Route path="/updates"  element={<UpdatesPage />} />
        <Route path="/actions"  element={<ActionsPage />} />
        <Route path="/finances" element={<FinancesPage />} />
        <Route path="/members"  element={<MembersPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/proposals" element={<ProposalsPage />} />
        <Route path="/equity"   element={<EquityPage />} />
        <Route path="/loans"    element={<LoansPage />} />
        <Route path="/meetings" element={<MeetingsPage />} />
        <Route path="/docs"     element={<DocsPage />} />
        <Route path="/ask"      element={<AskPage />} />
        <Route path="/admin"       element={<AdminPage />} />
        <Route path="/expenditure"  element={<ExpenditurePage />} />
        <Route path="/engagement"   element={<EngagementPage />} />
        <Route path="/klafam"       element={isKlaFamMember ? <KlaFamPage /> : <Navigate to="/" replace />} />
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <Suspense fallback={null}>
              <AuthGate />
            </Suspense>
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
