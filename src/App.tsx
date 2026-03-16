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
import { ChatFloatingWidget } from "./components/ChatFloatingWidget";
import { PermissionsProvider } from "./hooks/usePermissions";
import { AuditContextProvider } from "./hooks/useAuditContext";
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
import NotesToAccounts from "./pages/NotesToAccounts";
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
import NoticeTracker from "./pages/NoticeTracker";
import NoticeDetail from "./pages/NoticeDetail";
import RolesPermissions from "./pages/RolesPermissions";
import FirmSettings from "./pages/FirmSettings";
import ServiceMasters from "./pages/ServiceMasters";
import Chat from "./pages/Chat";
import Depreciation from "./pages/Depreciation";
import AuditPipeline from "./pages/AuditPipeline";
import { useAuth } from "./hooks/useAuth";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});

function PortalGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "client") return <Navigate to="/" replace />;
  return <>{children}</>;
}

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
          <PermissionsProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/settings/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

            <Route element={<PortalGuard><PortalLayout /></PortalGuard>}>
              <Route path="/portal" element={<PortalHome />} />
              <Route path="/portal/queries" element={<PortalQueries />} />
            </Route>

            <Route element={<ProtectedRoute><CAGuard><AdminLayout /></CAGuard></ProtectedRoute>}>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/firms" element={<AdminFirms />} />
              <Route path="/admin/users" element={<UserManagement />} />
              <Route path="/admin/services" element={<ServiceMasters />} />
              <Route path="/admin/roles" element={<RolesPermissions />} />
              <Route path="/admin/logs" element={<AdminLogs />} />
              <Route path="/admin/ai-skills" element={<AdminAiSkills />} />
              <Route path="/admin/theme-studio" element={<AdminThemeStudio />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
            </Route>

            {/* Protected app routes with AuditContext */}
            <Route element={<ProtectedRoute><CAGuard><AuditContextProvider><AppLayout /></AuditContextProvider></CAGuard></ProtectedRoute>}>
              <Route path="/" element={<Index />} />
              <Route path="/clients" element={<Clients />} />
              <Route path="/clients/groups" element={<ClientGroups />} />
              <Route path="/clients/new" element={<NewClientWizard />} />
              <Route path="/clients/edit/:clientId" element={<NewClientWizard />} />
              <Route path="/clients/:clientId" element={<ClientDetail />} />

              <Route path="/clients/:clientId/audit/*" element={<AuditRedirect />} />

              <Route path="/audit/pipeline" element={<AuditPipeline />} />
              <Route path="/audit/pipeline/:engagementId" element={<AuditPipeline />} />

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
              <Route path="/audit/:engagementId" element={<EngagementDetail />} />
              <Route path="/audit-intelligence" element={<Navigate to="/audit" replace />} />

              <Route path="/tds-filings" element={<TdsFilings />} />
              <Route path="/billing/edit/:invoiceId" element={<NewInvoice />} />
              <Route path="/itr" element={<ItReturns />} />
              <Route path="/itr/demands" element={<ItrDemands />} />
              <Route path="/itr/:clientId" element={<ItrAisRecon />} />
              <Route path="/billing" element={<Billing />} />
              <Route path="/billing/new" element={<NewInvoice />} />
              <Route path="/billing/timesheets" element={<Timesheets />} />
              <Route path="/erp-ledger" element={<ErpLedger />} />
              <Route path="/erp/:clientId/bank-recon" element={<BankRecon />} />
              <Route path="/settings/firm" element={<FirmSettings />} />
              <Route path="/settings/roles" element={<RolesPermissions />} />
              <Route path="/settings/services" element={<ServiceMasters />} />
              <Route path="/notices" element={<Navigate to="/itr" replace />} />
              <Route path="/notices/:id" element={<NoticeDetail />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/depreciation" element={<Depreciation />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/coa-mappings" element={<CoaMappings />} />
              <Route path="/settings/users" element={<UserManagement />} />
              <Route path="/settings/audit-firms" element={<Navigate to="/settings/firm" replace />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          <FeedbackWidget />
          <ChatFloatingWidget />
          </PermissionsProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
