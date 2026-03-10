import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { AdminLayout } from "./components/AdminLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PortalLayout } from "./components/PortalLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FeedbackWidget } from "./components/FeedbackWidget";
import Index from "./pages/Index";
import Clients from "./pages/Clients";
import ImportTrialBalance from "./pages/ImportTrialBalance";
import AuditScrutiny from "./pages/AuditScrutiny";
import ClientDetail from "./pages/ClientDetail";
import NewClientWizard from "./pages/NewClientWizard";
import TdsFilings from "./pages/TdsFilings";
import ItReturns from "./pages/ItReturns";
import ItrAisRecon from "./pages/ItrAisRecon";
import ItrDemands from "./pages/ItrDemands";
import Billing from "./pages/Billing";
import NewInvoice from "./pages/NewInvoice";
import ErpLedger from "./pages/ErpLedger";
import Timesheets from "./pages/Timesheets";
import BankRecon from "./pages/BankRecon";
import AuditIntelligence from "./pages/AuditIntelligence";
import EngagementDetail from "./pages/EngagementDetail";
import Documents from "./pages/Documents";
import SettingsPage from "./pages/SettingsPage";
import CoaMappings from "./pages/CoaMappings";
import AuditFirms from "./pages/AuditFirms";
import ClientGroups from "./pages/ClientGroups";
import Form3CD from "./pages/Form3CD";
import ComparativeStatements from "./pages/ComparativeStatements";
import UserManagement from "./pages/UserManagement";
import ChangePassword from "./pages/ChangePassword";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminFirms from "./pages/admin/AdminFirms";
import AdminLogs from "./pages/admin/AdminLogs";
import AdminAiSkills from "./pages/admin/AdminAiSkills";
import AdminThemeStudio from "./pages/admin/AdminThemeStudio";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PortalHome from "./pages/PortalHome";
import NotFound from "./pages/NotFound";
import AuditRedirect from "./pages/AuditRedirect";
import AuditPreliminary from "./pages/AuditPreliminary";
import AuditQueryTracker from "./pages/AuditQueryTracker";
import AuditQueryDispatch from "./pages/AuditQueryDispatch";
import AuditReportEngine from "./pages/AuditReportEngine";
import PortalQueries from "./pages/PortalQueries";
import { useAuth } from "./hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min for reference data
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

/** Guard that only allows client role to access portal */
function PortalGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "client") return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Guard that redirects client role away from CA interface */
function CAGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user?.role === "client") return <Navigate to="/portal" replace />;
  return <>{children}</>;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            {/* Change password */}
            <Route path="/settings/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

            {/* Client Portal - only for client role */}
            <Route element={<PortalGuard><PortalLayout /></PortalGuard>}>
              <Route path="/portal" element={<PortalHome />} />
              <Route path="/portal/queries" element={<PortalQueries />} />
            </Route>

            {/* Superadmin platform */}
            <Route element={<ProtectedRoute><CAGuard><AdminLayout /></CAGuard></ProtectedRoute>}>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/firms" element={<AdminFirms />} />
              <Route path="/admin/users" element={<UserManagement />} />
              <Route path="/admin/logs" element={<AdminLogs />} />
              <Route path="/admin/ai-skills" element={<AdminAiSkills />} />
              <Route path="/admin/theme-studio" element={<AdminThemeStudio />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
            </Route>

            {/* Protected app routes - not for client role */}
            <Route element={<ProtectedRoute><CAGuard><AppLayout /></CAGuard></ProtectedRoute>}>
              <Route path="/" element={<Index />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/groups" element={<ClientGroups />} />
              <Route path="/clients/new" element={<NewClientWizard />} />
              <Route path="/clients/edit/:clientId" element={<NewClientWizard />} />
              <Route path="/clients/:clientId" element={<ClientDetail />} />

              {/* Old audit routes → redirect banner */}
              <Route path="/clients/:clientId/audit/*" element={<AuditRedirect />} />

              {/* Consolidated Audit Intelligence routes */}
              <Route path="/audit" element={<AuditIntelligence />} />
              <Route path="/audit/import" element={<ImportTrialBalance />} />
              <Route path="/audit/scrutiny" element={<AuditScrutiny />} />
              <Route path="/audit/:clientId/scrutiny" element={<AuditScrutiny />} />
              <Route path="/audit/:clientId/import-trial-balance" element={<ImportTrialBalance />} />
              <Route path="/audit/3cd" element={<Form3CD />} />
              <Route path="/audit/:clientId/3cd" element={<Form3CD />} />
              <Route path="/audit/comparative" element={<ComparativeStatements />} />
              <Route path="/audit/:clientId/comparative" element={<ComparativeStatements />} />
              <Route path="/audit/preliminary" element={<AuditPreliminary />} />
              <Route path="/audit/:clientId/preliminary" element={<AuditPreliminary />} />
              <Route path="/audit/queries" element={<AuditQueryTracker />} />
              <Route path="/audit/:clientId/queries" element={<AuditQueryTracker />} />
              <Route path="/audit/dispatch" element={<AuditQueryDispatch />} />
              <Route path="/audit/:clientId/queries/dispatch" element={<AuditQueryDispatch />} />
              <Route path="/audit/report" element={<AuditReportEngine />} />
              <Route path="/audit/:clientId/report" element={<AuditReportEngine />} />
              <Route path="/audit/:engagementId/detail" element={<EngagementDetail />} />

              {/* Keep legacy engagement detail route working */}
              <Route path="/audit/:engagementId" element={<EngagementDetail />} />

              {/* Remove old audit-intelligence route → redirect */}
              <Route path="/audit-intelligence" element={<Navigate to="/audit" replace />} />

              <Route path="/tds-filings" element={<TdsFilings />} />
              <Route path="/itr" element={<ItReturns />} />
              <Route path="/itr/demands" element={<ItrDemands />} />
              <Route path="/itr/:clientId" element={<ItrAisRecon />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/new" element={<NewInvoice />} />
              <Route path="/billing/timesheets" element={<Timesheets />} />
              <Route path="/erp-ledger" element={<ErpLedger />} />
              <Route path="/erp/:clientId/bank-recon" element={<BankRecon />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/coa-mappings" element={<CoaMappings />} />
              <Route path="/settings/users" element={<UserManagement />} />
              <Route path="/settings/audit-firms" element={<AuditFirms />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          <FeedbackWidget />
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
