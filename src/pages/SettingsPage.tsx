import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Users, ChevronRight, Building, Bell, Shield } from "lucide-react";

const SettingsPage = () => {
  const { user } = useAuth();
  const isAdmin = ["superadmin", "firm_admin"].includes(user?.role || "");

  const settingsLinks = [
    ...(isAdmin
      ? [{ title: "Team Members", description: "Manage users, roles, and permissions", icon: Users, path: "/settings/users" }]
      : []),
    { title: "Firm Profile", description: "Update firm name, ICAI registration, and details", icon: Building, path: "/settings" },
    { title: "Notifications", description: "Configure email and in-app notification preferences", icon: Bell, path: "/settings" },
    { title: "Security", description: "Password policies, MFA settings, and session management", icon: Shield, path: "/settings" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground mb-1">Settings</h1>
        <p className="text-muted-foreground">Firm settings, team management, and preferences.</p>
      </div>
      <div className="grid gap-3">
        {settingsLinks.map((item) => (
          <Link
            key={item.title}
            to={item.path}
            className="flex items-center gap-4 p-4 bg-card border border-border rounded-lg hover:border-primary/40 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
              <item.icon size={20} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground">{item.title}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
            <ChevronRight size={18} className="text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </Link>
        ))}
      </div>
    </div>
  );
};
export default SettingsPage;
