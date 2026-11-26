import { useState } from "react";
import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";
import { MobileDrawer } from "./MobileDrawer";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileFAB } from "./MobileFAB";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useThemeLoader } from "@/hooks/useThemeLoader";

export function AppLayout() {
  useThemeLoader();
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (isMobile) {
    return (
      <div className="min-h-screen flex flex-col">
        <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
        <TopBar onMenuClick={() => setDrawerOpen(true)} />
        <main className="flex-1 p-3 pb-24 overflow-x-hidden">
          <Outlet />
        </main>
        <MobileFAB />
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-background">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className={cn(
          "flex-1 flex flex-col transition-all duration-300 min-w-0 overflow-x-hidden",
          collapsed ? "ml-14" : "ml-64"
        )}
      >
        {/* GST Keeper layout: no desktop top bar; full-width main with room for the assistant launcher */}
        <main className="flex-1 min-w-0 px-6 pt-6 pb-24 animate-fade-in">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
