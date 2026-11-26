import type { Config } from "tailwindcss";


// GST Keeper design system: raw Tailwind palettes used across the app are re-pointed to the design's
// status / brand hues, so every hard-coded amber/emerald/blue/slate class renders in the new palette.
const scale = (h: number, sat: number, l: number[]) =>
  Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((k, i) => [k, `hsl(${h} ${sat}% ${l[i]}%)`]));
const STATUS_L = [97, 93, 85, 74, 60, 48, 40, 28, 22, 17, 11];
const warning = scale(38, 92, [97, 92, 84, 72, 58, 50, 42, 30, 24, 19, 12]);
const success = scale(142, 70, [97, 92, 84, 70, 52, 36, 30, 26, 21, 17, 10]);
const danger = scale(0, 78, [97, 93, 86, 76, 66, 60, 50, 42, 34, 27, 15]);
const navy = scale(220, 60, [97, 93, 85, 72, 55, 40, 32, 25, 20, 15, 10]);
const info = scale(199, 89, STATUS_L);
const neutral = scale(220, 13, [98, 96, 91, 84, 65, 46, 36, 27, 18, 11, 7]);
const designPalette = {
  amber: warning, yellow: warning, orange: warning,
  emerald: success, green: success, teal: success, lime: success,
  red: danger, rose: danger, pink: danger, fuchsia: danger,
  blue: navy, indigo: navy, violet: navy, purple: navy,
  sky: info, cyan: info,
  slate: neutral, gray: neutral, zinc: neutral, neutral: neutral, stone: neutral,
};

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Poppins", "Inter", "sans-serif"],
        heading: ["Poppins", "Inter", "sans-serif"],
      },
      colors: {
        ...designPalette,
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          strong: "hsl(var(--destructive-strong))",
        },
        coral: "hsl(var(--coral))",
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))", strong: "hsl(var(--success-strong))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        info: { DEFAULT: "hsl(var(--info))", foreground: "hsl(var(--info-foreground))" },
        "cell-input": { DEFAULT: "hsl(var(--cell-input))", foreground: "hsl(var(--cell-input-foreground))" },
        "cell-variance": { DEFAULT: "hsl(var(--cell-variance))", foreground: "hsl(var(--cell-variance-foreground))" },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          gold: "hsl(var(--sidebar-gold))",
          "gold-foreground": "hsl(var(--sidebar-gold-fg))",
          hover: "hsl(var(--sidebar-hover))",
          active: "hsl(var(--sidebar-active))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        "fade-in": { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      boxShadow: {
        sidebar: "4px 0 6px -1px rgb(0 0 0 / 0.1)",
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
