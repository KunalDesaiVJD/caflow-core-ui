import { useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";

const routeLabels: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/tds-filings": "TDS Filings",
  "/it-returns": "IT Returns",
  "/billing": "Billing",
  "/erp-ledger": "ERP Ledger",
  "/audit-intelligence": "Audit Intelligence",
  "/settings": "Settings",
};

export function TopBar() {
  const location = useLocation();
  const currentLabel = routeLabels[location.pathname] || "Page";

  const crumbs = location.pathname === "/"
    ? ["Dashboard"]
    : ["Dashboard", currentLabel];

  return (
    <header className="sticky top-0 z-30 h-14 bg-card border-b border-border flex items-center px-6">
      <nav className="flex items-center gap-1 text-sm">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-muted-foreground" />}
            <span
              className={
                i === crumbs.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>
    </header>
  );
}
