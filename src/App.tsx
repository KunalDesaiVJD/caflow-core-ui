import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { AdminLayout } from "./components/AdminLayout";
import { InternalLayout } from "./pages/internal/InternalLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PortalLayout } from "./components/PortalLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { ChatFloatingWidget } from "./components/ChatFloatingWidget";
import { PermissionsProvider } from "./hooks/usePermissions";
import { AuditContextProvider } from "./hooks/useAuditContext";
import { Skeleton } from "./components/ui/skeleton";
import { AuthProvider, useAuth } from "./hooks/useAuth";

// ─── Lazy-loaded pages ────────────────────────────────────────────────────────
// Each page is split into its own JS chunk so the browser only downloads the
// code that is actually needed for the current route.
const Index                    = lazy(() => import("./pages/Index"));
const Clients                  = lazy(() => import("./pages/Clients"));
// ImportTrialBalance removed — Tally Sync is the only TB source (Phase 2)
const AuditScrutiny            = lazy(() => import("./pages/AuditScrutiny"));
const ClientDetail             = lazy(() => import("./pages/ClientDetail"));
const NewClientWizard          = lazy(() => import("./pages/NewClientWizard"));
const TdsFilings               = lazy(() => import("./pages/TdsFilings"));
const ItReturns                = lazy(() => import("./pages/ItReturns"));
const ItrAisRecon              = lazy(() => import("./pages/ItrAisRecon"));
const ItrDemands               = lazy(() => import("./pages/ItrDemands"));
const Billing                  = lazy(() => import("./pages/Billing"));
const NewInvoice               = lazy(() => import("./pages/NewInvoice"));
const ErpLedger                = lazy(() => import("./pages/ErpLedger"));
const Timesheets               = lazy(() => import("./pages/Timesheets"));
const BankRecon                = lazy(() => import("./pages/BankRecon"));
const AuditIntelligence        = lazy(() => import("./pages/AuditIntelligence"));
const EngagementDetail         = lazy(() => import("./pages/EngagementDetail"));
const Documents                = lazy(() => import("./pages/Documents"));
const SettingsPage             = lazy(() => import("./pages/SettingsPage"));
const AuditFirms               = lazy(() => import("./pages/AuditFirms"));
const ClientGroups             = lazy(() => import("./pages/ClientGroups"));
const Form3CD                  = lazy(() => import("./pages/Form3CD"));
const Form3Reports             = lazy(() => import("./pages/Form3Reports"));
const NotesToAccounts          = lazy(() => import("./pages/NotesToAccounts"));
// REMOVED: const ComparativeStatements = lazy(() => import("./pages/ComparativeStatements")); — removed per client request
const UserManagement           = lazy(() => import("./pages/UserManagement"));
const ChangePassword           = lazy(() => import("./pages/ChangePassword"));
const AdminOverview            = lazy(() => import("./pages/admin/AdminOverview"));
const AdminFirms               = lazy(() => import("./pages/admin/AdminFirms"));
const AdminLogs                = lazy(() => import("./pages/admin/AdminLogs"));
const AdminAuditTrail          = lazy(() => import("./pages/admin/AdminAuditTrail"));
const AdminAiSkills            = lazy(() => import("./pages/admin/AdminAiSkills"));
const AdminThemeStudio         = lazy(() => import("./pages/admin/AdminThemeStudio"));
const AdminFirmAccess          = lazy(() => import("./pages/admin/AdminFirmAccess"));
const Login                    = lazy(() => import("./pages/Login"));
const ForgotPassword           = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword            = lazy(() => import("./pages/ResetPassword"));
const PortalHome               = lazy(() => import("./pages/PortalHome"));
const NotFound                 = lazy(() => import("./pages/NotFound"));
const AuditRedirect            = lazy(() => import("./pages/AuditRedirect"));
const AuditPreliminary         = lazy(() => import("./pages/AuditPreliminary"));
const AuditQueryTracker        = lazy(() => import("./pages/AuditQueryTracker"));
const AuditQueryDispatch       = lazy(() => import("./pages/AuditQueryDispatch"));
const AuditReportEngine        = lazy(() => import("./pages/AuditReportEngine"));
const PortalQueries            = lazy(() => import("./pages/PortalQueries"));
const PortalDocuments          = lazy(() => import("./pages/PortalDocuments"));
const PortalTdsModule          = lazy(() => import("./pages/PortalTdsModule"));
const NoticeDetail             = lazy(() => import("./pages/NoticeDetail"));
const RolesPermissions         = lazy(() => import("./pages/RolesPermissions"));
const AccessPermissions        = lazy(() => import("./pages/AccessPermissions"));
const FirmSettings             = lazy(() => import("./pages/FirmSettings"));
const ServiceMasters           = lazy(() => import("./pages/ServiceMasters"));
const RequiredDocsMaster       = lazy(() => import("./pages/RequiredDocsMaster"));
const TaxAuditTemplateSettings = lazy(() => import("./pages/TaxAuditTemplateSettings"));
const Chat                     = lazy(() => import("./pages/Chat"));
const Depreciation             = lazy(() => import("./pages/Depreciation"));
const Msme43b                  = lazy(() => import("./pages/Msme43b"));
const Recon26as                = lazy(() => import("./pages/Recon26as"));
const AuditPipeline            = lazy(() => import("./pages/AuditPipeline"));
const AuditMasterConfig        = lazy(() => import("./pages/AuditMasterConfig"));
const AuditWorksheetPageWrapper = lazy(() => import("./pages/AuditWorksheetPageWrapper"));
const AuditTracker             = lazy(() => import("./pages/AuditTracker"));
const TallySyncPage            = lazy(() => import("./pages/TallySyncPage"));
const LedgerVouchersView       = lazy(() => import("./pages/LedgerVouchersView"));

// ─── Internal team lazy pages ─────────────────────────────────────────────────
const InternalOverview         = lazy(() => import("./pages/internal/InternalOverview"));
const InternalOnboarding       = lazy(() => import("./pages/internal/InternalOnboarding"));
const InternalTickets          = lazy(() => import("./pages/internal/InternalTickets"));
const InternalTeam             = lazy(() => import("./pages/internal/InternalTeam"));

// Minimal fallback shown while a lazy page chunk is downloading
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="space-y-4 w-64">
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

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
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "client") return <Navigate to="/" replace />;
  // Force password change redirect — mirrors ProtectedRoute's staff-side gate.
  // Previously portal-client accounts could stay on their (possibly still
  // default/temporary) password indefinitely since only the staff router
  // enforced this flag.
  if (user.must_change_password && location.pathname !== "/settings/change-password") {
    return <Navigate to="/settings/change-password" replace />;
  }
  return <>{children}</>;
}

const INTERNAL_ROLES = ["implementation_executive", "client_success_executive"];

function CAGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }
  if (user?.role === "client") return <Navigate to="/portal" replace />;
  // Internal team members (IE, CSE) belong in /internal, not the main app
  if (user?.role && INTERNAL_ROLES.includes(user.role)) return <Navigate to="/internal" replace />;
  return <>{children}</>;
}

function InternalGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  const allowed = user.role === "superadmin" || INTERNAL_ROLES.includes(user.role);
  if (!allowed) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * Route-aware ErrorBoundary wrapper.
 * Must live INSIDE <BrowserRouter> so it can call useLocation().
 * Passes location.pathname as resetKey — when the user navigates to a
 * different route the ErrorBoundary automatically clears any previous error
 * so the new page can render without requiring a full page reload.
 */
function RouteErrorBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  );
}

const App = () => (
  <ErrorBoundary>
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <RouteErrorBoundary>
            <PermissionsProvider>
            <Suspense fallback={<PageLoader />}>
            <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/settings/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

            <Route element={<PortalGuard><PortalLayout /></PortalGuard>}>
              <Route path="/portal" element={<PortalHome />} />
              <Route path="/portal/queries" element={<PortalQueries />} />
              <Route path="/portal/documents" element={<PortalDocuments />} />
              {/* One TDS module; Data Entry / Correction are sub-tabs inside it */}
              <Route path="/portal/tds" element={<PortalTdsModule />} />
            </Route>

            {/* Internal team routes — IE, CSE, and superadmin */}
            <Route element={<InternalGuard><InternalLayout /></InternalGuard>}>
              <Route path="/internal" element={<InternalOverview />} />
              <Route path="/internal/onboarding" element={<InternalOnboarding />} />
              <Route path="/internal/tickets" element={<InternalTickets />} />
              <Route path="/internal/team" element={<InternalTeam />} />
            </Route>

            <Route element={<ProtectedRoute><CAGuard><AdminLayout /></CAGuard></ProtectedRoute>}>
              <Route path="/admin" element={<AdminOverview />} />
              <Route path="/admin/firms" element={<AdminFirms />} />
              <Route path="/admin/users" element={<UserManagement />} />
              <Route path="/admin/services" element={<ServiceMasters />} />
              {/* Unified Access & Permissions — new canonical route */}
              <Route path="/admin/access-permissions" element={<AccessPermissions />} />
              {/* Legacy redirects — keep for 60 days to avoid broken bookmarks */}
              <Route path="/admin/roles" element={<Navigate to="/admin/access-permissions" replace />} />
              <Route path="/admin/firm-access" element={<Navigate to="/admin/access-permissions" replace />} />
              <Route path="/admin/logs" element={<AdminLogs />} />
              <Route path="/admin/audit-trail" element={<AdminAuditTrail />} />
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
              {/* /audit/import removed — use Tally Sync (/audit/tally-sync) instead */}
              <Route path="/audit/scrutiny" element={<AuditScrutiny />} />
              <Route path="/audit/:clientId/scrutiny" element={<AuditScrutiny />} />
              {/* /audit/:clientId/import-trial-balance removed — use Tally Sync instead */}
              <Route path="/audit/3cd" element={<Form3CD />} />
              <Route path="/audit/:clientId/3cd" element={<Form3CD />} />
              <Route path="/audit/3reports" element={<Form3Reports />} />
              {/* REMOVED: /audit/comparative and /audit/:clientId/comparative — removed per client request */}
              <Route path="/audit/master-config" element={<AuditMasterConfig />} />
              <Route path="/audit/tracker" element={<AuditTracker />} />
              <Route path="/audit/tally-sync" element={<TallySyncPage />} />
              <Route path="/audit/tally-sync/ledger/:ledgerName" element={<LedgerVouchersView />} />
              <Route path="/audit/preliminary" element={<AuditPreliminary />} />
              <Route path="/audit/:clientId/preliminary" element={<AuditPreliminary />} />
              <Route path="/audit/queries" element={<AuditQueryTracker />} />
              <Route path="/audit/:clientId/queries" element={<AuditQueryTracker />} />
              <Route path="/audit/dispatch" element={<AuditQueryDispatch />} />
              <Route path="/audit/:clientId/queries/dispatch" element={<AuditQueryDispatch />} />
              <Route path="/audit/report" element={<AuditReportEngine />} />
              <Route path="/audit/notes" element={<NotesToAccounts />} />
              <Route path="/audit/:clientId/report" element={<AuditReportEngine />} />
              <Route path="/audit/:engagementId/worksheet" element={<AuditWorksheetPageWrapper />} />
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
              <Route path="/settings/access-permissions" element={<AccessPermissions />} />
              <Route path="/settings/roles" element={<Navigate to="/settings/access-permissions" replace />} />
              <Route path="/settings/services" element={<ServiceMasters />} />
              <Route path="/settings/required-docs" element={<RequiredDocsMaster />} />
              <Route path="/settings/tax-audit-templates" element={<TaxAuditTemplateSettings />} />
              <Route path="/notices" element={<Navigate to="/itr" replace />} />
              <Route path="/notices/:id" element={<NoticeDetail />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/depreciation" element={<Depreciation />} />
              <Route path="/msme-43b" element={<Msme43b />} />
              <Route path="/26as-recon" element={<Recon26as />} />
              <Route path="/documents" element={<Documents />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/users" element={<UserManagement />} />
              <Route path="/settings/audit-firms" element={<Navigate to="/settings/firm" replace />} />
            </Route>
            <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <FeedbackWidget />
            <ChatFloatingWidget />
            </PermissionsProvider>
            </RouteErrorBoundary>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  </ErrorBoundary>
);

export default App;
