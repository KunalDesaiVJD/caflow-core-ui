import { useLocation } from "react-router-dom";
import { ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const routeLabels: Record<string, string> = {
  "/": "Dashboard",
  "/clients": "Clients",
  "/tds-filings": "TDS Filings",
  "/it-returns": "IT Returns",
  "/itr": "IT Returns",
  "/billing": "Billing",
  "/erp-ledger": "ERP Ledger",
  "/audit-intelligence": "Audit Intelligence",
  "/documents": "Documents",
  "/settings": "Settings",
};

interface TopBarProps {
  onMenuClick?: () => void;
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const location = useLocation();
  const currentLabel = routeLabels[location.pathname] || "Page";

  const crumbs = location.pathname === "/"
    ? ["Dashboard"]
    : ["Dashboard", currentLabel];

  return (
    <header className="sticky top-0 z-30 h-14 bg-card border-b border-border flex items-center px-4 md:px-6">
      {onMenuClick && (
        <button
          onClick={onMenuClick}
          className="mr-3 p-1.5 rounded-md hover:bg-muted transition-colors md:hidden"
          aria-label="Open menu"
        >
          <Menu size={22} className="text-foreground" />
        </button>
      )}
      <nav className="flex items-center gap-1 text-sm min-w-0">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1 min-w-0">
            {i > 0 && <ChevronRight size={14} className="text-muted-foreground shrink-0" />}
            <span
              className={cn(
                "truncate",
                i === crumbs.length - 1
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {crumb}
            </span>
          </span>
        ))}
      </nav>
    </header>
  );
}

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
