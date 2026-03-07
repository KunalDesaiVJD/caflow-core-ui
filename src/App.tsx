import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import { AdminLayout } from "./components/AdminLayout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Index from "./pages/Index";
import Clients from "./pages/Clients";
import ClientDetail from "./pages/ClientDetail";
import NewClientWizard from "./pages/NewClientWizard";
import TdsFilings from "./pages/TdsFilings";
import ItReturns from "./pages/ItReturns";
import ItrAisRecon from "./pages/ItrAisRecon";
import Billing from "./pages/Billing";
import NewInvoice from "./pages/NewInvoice";
import ErpLedger from "./pages/ErpLedger";
import AuditIntelligence from "./pages/AuditIntelligence";
import SettingsPage from "./pages/SettingsPage";
import UserManagement from "./pages/UserManagement";
import ChangePassword from "./pages/ChangePassword";
import AdminOverview from "./pages/admin/AdminOverview";
import AdminFirms from "./pages/admin/AdminFirms";
import AdminLogs from "./pages/admin/AdminLogs";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
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

          {/* Change password - protected but outside layouts */}
          <Route path="/settings/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

          {/* Superadmin platform */}
          <Route element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
            <Route path="/admin" element={<AdminOverview />} />
            <Route path="/admin/firms" element={<AdminFirms />} />
            <Route path="/admin/users" element={<UserManagement />} />
            <Route path="/admin/logs" element={<AdminLogs />} />
          </Route>

          {/* Protected app routes */}
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/" element={<Index />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/clients/new" element={<NewClientWizard />} />
            <Route path="/clients/edit/:clientId" element={<NewClientWizard />} />
            <Route path="/clients/:clientId" element={<ClientDetail />} />
            <Route path="/tds-filings" element={<TdsFilings />} />
            <Route path="/itr" element={<ItReturns />} />
            <Route path="/itr/:clientId" element={<ItrAisRecon />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/billing/new" element={<NewInvoice />} />
            <Route path="/erp-ledger" element={<ErpLedger />} />
            <Route path="/audit-intelligence" element={<AuditIntelligence />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/users" element={<UserManagement />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
