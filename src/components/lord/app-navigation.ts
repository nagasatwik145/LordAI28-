import {
  BarChart3,
  Bell,
  Calendar,
  Crown,
  FileText,
  FolderOpen,
  GraduationCap,
  Gamepad2,
  Users,
  LayoutDashboard,
  MessageSquare,
  Network,
  Mic2,
  Sparkles,
  Settings,
  Scale,
  Search,
  Target,
  HeartPulse,
  TerminalSquare,
} from "lucide-react";

/** Shared destinations used by the desktop dock and mobile navigation. */
export const APP_NAVIGATION = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/command-center", label: "Daily Briefing", icon: Bell },
  { to: "/projects", label: "Projects", icon: FolderOpen },
  { to: "/anything-studio", label: "Anything Studio", icon: Sparkles },
  { to: "/developer-lab", label: "Developer Lab", icon: TerminalSquare },
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/mind-graph", label: "Mind Graph", icon: Network },
  { to: "/what-if", label: "What-If Lab", icon: Scale },
  { to: "/voice", label: "Voice Assistant", icon: Mic2 },
  { to: "/study", label: "Study", icon: GraduationCap },
  { to: "/create-apka-jalwa", label: "LORD WorldForge", icon: Gamepad2 },
  { to: "/community", label: "Community", icon: Users },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/tasks", label: "Tasks & Notifications", icon: Target },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/research", label: "Deep Research", icon: Search },
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
