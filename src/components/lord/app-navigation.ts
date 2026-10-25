import {
  BarChart3,
  Calendar,
  Crown,
  FileText,
  FolderOpen,
  GraduationCap,
  Gamepad2,
  LayoutDashboard,
  MessageSquare,
  Network,
  Mic2,
  Sparkles,
  Settings,
  Scale,
  Target,
  HeartPulse,
} from "lucide-react";

/** Shared destinations used by the desktop dock and mobile navigation. */
export const APP_NAVIGATION = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/anything-studio", label: "Anything Studio", icon: Sparkles },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/mind-graph", label: "Mind Graph", icon: Network },
  { to: "/what-if", label: "What-If Lab", icon: Scale },
  { to: "/voice", label: "Voice Assistant", icon: Mic2 },
  { to: "/study", label: "Study", icon: GraduationCap },
  { to: "/create-apka-jalwa", label: "LORD WorldForge", icon: Gamepad2 },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks & Notifications", icon: Target },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
  { to: "/observability", label: "Health Center", icon: HeartPulse },
  { to: "/upgrade", label: "LORD Pro", icon: Crown },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export const PRIMARY_NAVIGATION = APP_NAVIGATION.filter(({ to }) =>
  ["/", "/chat", "/voice", "/study"].includes(to),
);

export const SECONDARY_NAVIGATION = APP_NAVIGATION.filter(
  (item) => !PRIMARY_NAVIGATION.some((primary) => primary.to === item.to),
);
