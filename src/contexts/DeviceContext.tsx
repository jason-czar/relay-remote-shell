import { createContext, useContext, useState, ReactNode } from "react";
import type { Tables } from "@/integrations/supabase/types";

interface DeviceContextValue {
  devices: Tables<"devices">[];
  selectedDeviceId: string;
  setDevices: React.Dispatch<React.SetStateAction<Tables<"devices">[]>>;
  setSelectedDeviceId: React.Dispatch<React.SetStateAction<string>>;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<Tables<"devices">[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  return (
    <DeviceContext.Provider value={{ devices, selectedDeviceId, setDevices, setSelectedDeviceId }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDeviceContext() {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDeviceContext must be used within DeviceProvider");
  return ctx;
}
