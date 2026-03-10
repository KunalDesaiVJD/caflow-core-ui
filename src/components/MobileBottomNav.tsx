import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Receipt,
  FileText,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { title: "Dashboard", path: "/", icon: LayoutDashboard },
  { title: "Clients", path: "/clients", icon: Users },
  { title: "TDS", path: "/tds-filings", icon: Receipt },
  { title: "ITR", path: "/itr", icon: FileText },
  { title: "Audit", path: "/audit-intelligence", icon: Search },
];

export function MobileBottomNav() {
  const location = useLocation();

  const isActive = (path: string) =>
    path === "/" ? location.pathname === "/" : location.pathname.startsWith(path);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-card border-t border-border safe-bottom">
      <div className="flex items-center justify-around h-16">
        {items.map((item) => {
          const active = isActive(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] font-medium transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon
                size={20}
                className={cn(active && "text-primary")}
              />
              <span>{item.title}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
