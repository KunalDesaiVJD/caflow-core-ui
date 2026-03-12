import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

const STORAGE_KEY = "firmTheme";
const STYLE_ID = "firm-theme";

interface CachedTheme {
  cssVars: Record<string, string>;
  firmId: string;
  themeId?: string;
  ts: number;
}

const CSS_VARS_MAP: Record<string, Record<string, string>> = {
  midnight_professional: {
    "--bg-primary": "220 14% 7%", "--bg-secondary": "215 19% 13%",
    "--text-primary": "210 40% 98%", "--text-secondary": "215 20% 65%",
    "--accent": "42 52% 54%", "--sidebar-bg": "215 19% 13%",
  },
  clean_white: {
    "--bg-primary": "0 0% 100%", "--bg-secondary": "210 40% 98%",
    "--text-primary": "222 47% 11%", "--text-secondary": "215 16% 47%",
    "--accent": "174 68% 32%", "--sidebar-bg": "210 40% 98%",
  },
  sage_green: {
    "--bg-primary": "80 20% 97%", "--bg-secondary": "100 18% 92%",
    "--text-primary": "24 10% 10%", "--text-secondary": "25 7% 32%",
    "--accent": "40 35% 37%", "--sidebar-bg": "100 18% 92%",
  },
};

function injectVars(cssVars: Record<string, string>) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const entries = Object.entries(cssVars).map(([k, v]) => `${k}: ${v};`).join("\n  ");
  style.textContent = `:root {\n  ${entries}\n}`;
}

function applyCachedTheme(firmId: string | null) {
  if (!firmId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const cached: CachedTheme = JSON.parse(raw);
    if (cached.firmId === firmId && cached.cssVars) {
      injectVars(cached.cssVars);
    }
  } catch {}
}

function cacheTheme(firmId: string, cssVars: Record<string, string>, themeId?: string) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cssVars, firmId, themeId, ts: Date.now() } as CachedTheme));
  } catch {}
}

export function useThemeLoader() {
  const { user } = useAuth();
  const loadedRef = useRef<string | null>(null);

  // Step 1: Apply cached theme instantly
  useEffect(() => {
    if (user?.firm_id) applyCachedTheme(user.firm_id);
  }, [user?.firm_id]);

  // Step 2: Load from DB with role-based theme support
  useEffect(() => {
    if (!user?.firm_id) return;
    if (loadedRef.current === user.firm_id + (user.role || "")) return;
    loadedRef.current = user.firm_id + (user.role || "");

    (async () => {
      try {
        let cssVars: Record<string, string> | null = null;
        let themeId: string | undefined;

        // 1. Check role_theme_overrides for this firm + role
        if (user.role) {
          const { data: roleOverride } = await supabase
            .from("role_theme_overrides")
            .select("*")
            .eq("firm_id", user.firm_id!)
            .eq("role", user.role)
            .maybeSingle();

          if (roleOverride) {
            // Check if user has personal preference and override is allowed
            let usePersonal = false;
            if (roleOverride.allow_user_override) {
              try {
                const raw = localStorage.getItem("userThemePref");
                const prefs = raw ? JSON.parse(raw) : {};
                if (prefs.theme_color && CSS_VARS_MAP[prefs.theme_color]) {
                  cssVars = CSS_VARS_MAP[prefs.theme_color];
                  usePersonal = true;
                }
              } catch {}
            }

            if (!usePersonal) {
              // Use role default
              if (roleOverride.theme_id) {
                const { data: theme } = await supabase
                  .from("app_themes")
                  .select("css_vars")
                  .eq("id", roleOverride.theme_id)
                  .single();
                if (theme?.css_vars) {
                  cssVars = theme.css_vars as Record<string, string>;
                  themeId = roleOverride.theme_id;
                }
              }
              // Fallback to color_scheme from role override
              if (!cssVars && roleOverride.color_scheme && CSS_VARS_MAP[roleOverride.color_scheme]) {
                cssVars = CSS_VARS_MAP[roleOverride.color_scheme];
              }
            }
          }
        }

        // 2. Fallback: firm-level theme
        if (!cssVars) {
          const { data: firm } = await supabase
            .from("firms")
            .select("settings")
            .eq("id", user.firm_id!)
            .single();

          const settings = (firm?.settings || {}) as Record<string, any>;
          const themeColor = settings.theme_color as string | undefined;
          const firmThemeId = settings.theme_id as string | undefined;

          if (firmThemeId) {
            const { data: theme } = await supabase
              .from("app_themes")
              .select("css_vars")
              .eq("id", firmThemeId)
              .single();
            if (theme?.css_vars) {
              cssVars = theme.css_vars as Record<string, string>;
              themeId = firmThemeId;
            }
          }

          if (!cssVars && themeColor && CSS_VARS_MAP[themeColor]) {
            cssVars = CSS_VARS_MAP[themeColor];
          }
        }

        // 3. Fallback: system default
        if (!cssVars) {
          const { data: defaultTheme } = await supabase
            .from("app_themes")
            .select("css_vars")
            .eq("is_default", true)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (defaultTheme?.css_vars) {
            cssVars = defaultTheme.css_vars as Record<string, string>;
          }
        }

        if (cssVars) {
          injectVars(cssVars);
          cacheTheme(user.firm_id!, cssVars, themeId);
        }
      } catch {}
    })();
  }, [user?.firm_id, user?.role]);

  // Cleanup on logout
  useEffect(() => {
    if (!user) {
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
      loadedRef.current = null;
    }
  }, [user]);
}
