export const HEALTH_STATUSES = [
  "Healthy",
  "Degraded",
  "Unavailable",
  "Not Configured",
  "Not Tested",
] as const;

export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthCheck {
  id: string;
  label: string;
  status: HealthStatus;
  summary: string;
  verification: "request" | "connectivity" | "configuration" | "not-tested";
  checkedAt: string;
}

export interface HealthCenterSnapshot {
  status: HealthStatus;
  checkedAt: string;
  checks: HealthCheck[];
  activeChecks: boolean;
}
