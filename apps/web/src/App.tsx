import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PatientsList = lazy(() => import('./pages/PatientsList'))
const PatientForm = lazy(() => import('./pages/PatientForm'))
const PatientProfile = lazy(() => import('./pages/PatientProfile'))
const AppointmentsList = lazy(() => import('./pages/AppointmentsList'))
const AppointmentForm = lazy(() => import('./pages/AppointmentForm'))
const AppointmentDetail = lazy(() => import('./pages/AppointmentDetail'))
const VisitsList = lazy(() => import('./pages/VisitsList'))
const VisitForm = lazy(() => import('./pages/VisitForm'))
const VisitDetail = lazy(() => import('./pages/VisitDetail'))
const ServicesList = lazy(() => import('./pages/ServicesList'))
const ServiceForm = lazy(() => import('./pages/ServiceForm'))
const InvoicesList = lazy(() => import('./pages/InvoicesList'))
const InvoiceForm = lazy(() => import('./pages/InvoiceForm'))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const DailyClosingPage = lazy(() => import('./pages/DailyClosingPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
import ProtectedRoute from './components/ProtectedRoute'
import { ToastProvider } from './contexts/ToastContext'
import Skeleton from './components/Skeleton'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <ToastProvider>
            <Suspense fallback={<div className="page-container"><div className="ui-card space-y-3 p-6" role="status" aria-live="polite"><Skeleton className="h-7 w-48" /><Skeleton className="h-11 w-full" count={4} /></div></div>}>
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients"
              element={
                <ProtectedRoute>
                  <PatientsList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients/new"
              element={
                <ProtectedRoute>
                  <PatientForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients/:id/edit"
              element={
                <ProtectedRoute>
                  <PatientForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/patients/:id"
              element={
                <ProtectedRoute>
                  <PatientProfile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments"
              element={
                <ProtectedRoute>
                  <AppointmentsList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments/new"
              element={
                <ProtectedRoute>
                  <AppointmentForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments/:id"
              element={
                <ProtectedRoute>
                  <AppointmentDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/appointments/:id/edit"
              element={
                <ProtectedRoute>
                  <AppointmentForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/visits"
              element={
                <ProtectedRoute>
                  <VisitsList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/visits/new"
              element={
                <ProtectedRoute>
                  <VisitForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/visits/:id"
              element={
                <ProtectedRoute>
                  <VisitDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/services"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <ServicesList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/services/new"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <ServiceForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/services/:id/edit"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <ServiceForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoices"
              element={
                <ProtectedRoute>
                  <InvoicesList />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoices/new"
              element={
                <ProtectedRoute>
                  <InvoiceForm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/invoices/:id"
              element={
                <ProtectedRoute>
                  <InvoiceDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="/daily-closing"
              element={<Navigate to="/reports/daily-closing" replace />}
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports/daily-closing"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <DailyClosingPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </Suspense>
          </ToastProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
