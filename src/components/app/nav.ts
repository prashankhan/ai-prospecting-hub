import { BarChart3, FolderKanban, LayoutDashboard, Radar, Send, Settings, Users, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
}

/** Primary navigation. An Inbox entry is reserved for V3 and intentionally not shown. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, shortcut: "G D" },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/discover", label: "Discover", icon: Radar },
  { href: "/prospects", label: "Prospects", icon: Users, shortcut: "G P" },
  { href: "/outreach", label: "Outreach", icon: Send, shortcut: "G O" },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];
