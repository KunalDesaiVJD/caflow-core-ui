import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export function ChatFloatingWidget() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [unreadCount, setUnreadCount] = useState(0);

  // Don't show on chat page itself or login/portal
  if (!user || location.pathname === "/chat" || location.pathname.startsWith("/login") || location.pathname.startsWith("/portal")) {
    return null;
  }

  return (
    <button
      onClick={() => navigate("/chat")}
      className={cn(
        "fixed bottom-20 right-5 z-50 h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg",
        "flex items-center justify-center hover:scale-105 transition-transform",
        "md:bottom-6"
      )}
      title="Chat"
    >
      <MessageSquare size={22} />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 h-5 min-w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
