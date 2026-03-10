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

/** Inject CSS variables into :root via a <style> tag */
function injectVars(cssVars: Record<string, string>) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  const entries = Object.entries(cssVars)
    .map(([k, v]) => `${k}: ${v};`)
    .join("\n  ");
  style.textContent = `:root {\n  ${entries}\n}`;
}

/** Apply cached theme immediately to avoid flash */
function applyCachedTheme(firmId: string | null) {
  if (!firmId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const cached: CachedTheme = JSON.parse(raw);
    if (cached.firmId === firmId && cached.cssVars) {
      injectVars(cached.cssVars);
    }
  } catch {
    // ignore parse errors
  }
}

/** Save theme to localStorage */
function cacheTheme(firmId: string, cssVars: Record<string, string>, themeId?: string) {
  const data: CachedTheme = { cssVars, firmId, themeId, ts: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full – ignore
  }
}

export function useThemeLoader() {
  const { user } = useAuth();
  const loadedRef = useRef<string | null>(null);

  // Step 1: Apply cached theme instantly on firm_id change
  useEffect(() => {
    if (user?.firm_id) {
      applyCachedTheme(user.firm_id);
    }
  }, [user?.firm_id]);

  // Step 2: Load from DB and refresh
  useEffect(() => {
    if (!user?.firm_id) return;
    if (loadedRef.current === user.firm_id) return;
    loadedRef.current = user.firm_id;

    (async () => {
      try {
        // Get firm settings to find theme_id or theme_color
        const { data: firm } = await supabase
          .from("firms")
          .select("settings")
          .eq("id", user.firm_id!)
          .single();

        const settings = (firm?.settings || {}) as Record<string, any>;
        const themeColor = settings.theme_color as string | undefined;
        const themeId = settings.theme_id as string | undefined;

        let cssVars: Record<string, string> | null = null;

        // Try loading by theme_id first
        if (themeId) {
          const { data: theme } = await supabase
            .from("app_themes")
            .select("css_vars")
            .eq("id", themeId)
            .single();
          if (theme?.css_vars) {
            cssVars = theme.css_vars as Record<string, string>;
          }
        }

        // Try loading by color_scheme name
        if (!cssVars && themeColor) {
          const { data: theme } = await supabase
            .from("app_themes")
            .select("css_vars")
            .eq("color_scheme", themeColor)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (theme?.css_vars) {
            cssVars = theme.css_vars as Record<string, string>;
          }
        }

        // Fallback: load default theme
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
      } catch {
        // Silently fail – cached theme is already applied
      }
    })();
  }, [user?.firm_id]);

  // Cleanup on logout
  useEffect(() => {
    if (!user) {
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
      loadedRef.current = null;
    }
  }, [user]);
}
