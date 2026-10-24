import type React from "react";
import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { monitoring } from "@/lib/monitoring-service";

export interface AppContextType {
  metrics: {
    latency: number;
    uptime: number;
    apiStatus: string;
    dbStatus: string;
    authStatus: string;
    errorCount: number;
  };
  currentRoute: string;
  activeWorkflow: string | null;
  history: Array<{ timestamp: number; action: string; data?: unknown }>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const location = useLocation();

  // [DIAG] Detect AppContextProvider remounts.
  const [metrics, setMetrics] = useState({
    latency: 0,
    uptime: 0,
    apiStatus: "online",
    dbStatus: "online",
    authStatus: "online",
    errorCount: 0,
  });
  const currentRoute = location.pathname;
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [history, setHistory] = useState<
    Array<{ timestamp: number; action: string; data?: unknown }>
  >([]);

  useEffect(() => {
    return monitoring.subscribe((next) => {
      setMetrics({
        latency: next.latency,
        uptime: next.uptime,
        apiStatus: next.apiStatus,
        dbStatus: next.dbStatus,
        authStatus: next.authStatus,
        errorCount: next.errorCount,
      });
    });
  }, []);

  const value: AppContextType = {
    metrics,
    currentRoute,
    activeWorkflow,
    history,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- custom hook is intentionally exported alongside the provider
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within AppContextProvider");
  }
  return context;
}
