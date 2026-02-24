import { useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY = "relay-inactivity-timeout";

export interface InactivitySettings {
  enabled: boolean;
  minutes: number;
}

const DEFAULTS: InactivitySettings = { enabled: false, minutes: 15 };

export function getInactivitySettings(): InactivitySettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : false,
      minutes: typeof parsed.minutes === "number" && parsed.minutes >= 1 ? parsed.minutes : 15,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveInactivitySettings(settings: InactivitySettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
];

export function useInactivityTimeout() {
  const { user, signOut } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetTimer = useCallback(() => {
    const { enabled, minutes } = getInactivitySettings();
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!enabled || !user) return;

    timerRef.current = setTimeout(() => {
      signOut();
    }, minutes * 60 * 1000);
  }, [user, signOut]);

  useEffect(() => {
    const { enabled } = getInactivitySettings();
    if (!enabled || !user) return;

    resetTimer();

    const handler = () => resetTimer();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true }));

    // Listen for settings changes from the same tab
    const storageHandler = () => resetTimer();
    window.addEventListener("storage", storageHandler);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handler));
      window.removeEventListener("storage", storageHandler);
    };
  }, [user, resetTimer]);
}
