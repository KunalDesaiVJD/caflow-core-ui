import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, Receipt, Upload, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const actions = [
  { label: "Add TDS Entry", path: "/tds-filings", icon: Receipt },
  { label: "Upload Document", path: "/documents", icon: Upload },
  { label: "New Client", path: "/clients/new", icon: Users },
];

export function MobileFAB() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="fixed bottom-20 right-4 z-50 md:hidden flex flex-col-reverse items-end gap-2">
      {/* Menu items */}
      {open && (
        <>
          <div className="fixed inset-0 z-[-1]" onClick={() => setOpen(false)} />
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                setOpen(false);
                navigate(action.path);
              }}
              className="flex items-center gap-2 bg-card border border-border shadow-lg rounded-full pl-4 pr-3 py-2.5 text-sm font-medium text-foreground animate-in fade-in slide-in-from-bottom-2"
            >
              <span>{action.label}</span>
              <action.icon size={16} className="text-primary" />
            </button>
          ))}
        </>
      )}

      {/* FAB button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200",
          "bg-primary text-primary-foreground hover:scale-105 active:scale-95"
        )}
      >
        {open ? <X size={24} /> : <Plus size={24} />}
      </button>
    </div>
  );
}
