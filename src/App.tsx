import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./components/AppLayout";
import Index from "./pages/Index";
import Clients from "./pages/Clients";
import TdsFilings from "./pages/TdsFilings";
import ItReturns from "./pages/ItReturns";
import Billing from "./pages/Billing";
import ErpLedger from "./pages/ErpLedger";
import AuditIntelligence from "./pages/AuditIntelligence";
import SettingsPage from "./pages/SettingsPage";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/tds-filings" element={<TdsFilings />} />
            <Route path="/it-returns" element={<ItReturns />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/erp-ledger" element={<ErpLedger />} />
            <Route path="/audit-intelligence" element={<AuditIntelligence />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
