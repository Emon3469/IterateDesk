import {
  BookOpen,
  ChartLine,
  LayoutDashboard,
  MessagesSquare,
  PlugZap,
  ScrollText,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  title: string;
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Main",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard, title: "AI Support Overview" },
      { href: "/copilot", label: "Copilot", icon: MessagesSquare, title: "IT Support Copilot" },
      { href: "/knowledge", label: "Knowledge Base", icon: BookOpen, title: "Knowledge Base" },
    ],
  },
  {
    label: "Analytics",
    items: [
      { href: "/analytics", label: "Insights", icon: ChartLine, title: "Support Insights" },
      { href: "/audit", label: "Audit Trail", icon: ScrollText, title: "Audit Trail" },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/integrations", label: "Integrations", icon: PlugZap, title: "Integrations" },
    ],
  },
  {
    label: "Other",
    items: [
      { href: "/settings", label: "Settings", icon: Settings, title: "Settings" },
      { href: "/how-it-works", label: "How It Works", icon: Workflow, title: "How It Works" },
    ],
  },
];

export function titleFor(pathname: string) {
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)) return item.title;
    }
  }
  return "IterateDesk";
}
