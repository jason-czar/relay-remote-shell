import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        xs:   ["var(--text-xs)",   { lineHeight: "var(--leading-normal)" }],
        sm:   ["var(--text-sm)",   { lineHeight: "var(--leading-normal)" }],
        base: ["var(--text-base)", { lineHeight: "var(--leading-normal)" }],
        lg:   ["var(--text-lg)",   { lineHeight: "var(--leading-relaxed)" }],
        xl:   ["var(--text-xl)",   { lineHeight: "var(--leading-snug)" }],
        "2xl":["var(--text-2xl)",  { lineHeight: "var(--leading-snug)" }],
        "3xl":["var(--text-3xl)",  { lineHeight: "var(--leading-tight)" }],
        "4xl":["var(--text-4xl)",  { lineHeight: "var(--leading-tight)" }],
        "5xl":["var(--text-5xl)",  { lineHeight: "var(--leading-tight)" }],
      },
      lineHeight: {
        tight:   "var(--leading-tight)",
        snug:    "var(--leading-snug)",
        normal:  "var(--leading-normal)",
        relaxed: "var(--leading-relaxed)",
      },
      letterSpacing: {
        tighter: "var(--tracking-tighter)",
        tight:   "var(--tracking-tight)",
        normal:  "var(--tracking-normal)",
        wide:    "var(--tracking-wide)",
        widest:  "var(--tracking-widest)",
      },
      fontWeight: {
        normal:   "var(--font-normal)",
        medium:   "var(--font-medium)",
        semibold: "var(--font-semibold)",
        bold:     "var(--font-bold)",
      },
      colors: {
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
        },
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
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        status: {
          online: "hsl(var(--status-online))",
          offline: "hsl(var(--status-offline))",
          connecting: "hsl(var(--status-connecting))",
        },
        terminal: {
          bg: "hsl(var(--terminal-bg))",
          fg: "hsl(var(--terminal-fg))",
          cursor: "hsl(var(--terminal-cursor))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-from-right": {
          "0%": { opacity: "0", transform: "translateX(18px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "slide-up-fade": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "ping-ring": {
          "0%":   { transform: "scale(1)",    opacity: "0.5" },
          "70%":  { transform: "scale(1.55)", opacity: "0" },
          "100%": { transform: "scale(1.55)", opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "fade-in": "fade-in 0.35s ease-out both",
        "slide-up-fade": "slide-up-fade 0.25s cubic-bezier(0.22,1,0.36,1) both",
        "ping-ring": "ping-ring 1.5s ease-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
