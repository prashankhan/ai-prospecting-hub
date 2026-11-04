"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings", label: "General" },
  { href: "/settings/ai", label: "AI providers", admin: true },
  { href: "/settings/discovery", label: "Discovery providers", admin: true },
  { href: "/settings/duplicates", label: "Duplicate prevention", admin: true },
  { href: "/projects", label: "Projects" },
  { href: "/settings/team", label: "Team", admin: true },
  { href: "/settings/security", label: "Security" },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.filter((i) => isAdmin || !i.admin).map((i) => {
        const active = pathname === i.href;
        return (
          <Link
            key={i.href}
            href={i.href}
            aria-current={active ? "page" : undefined}
            className={cn("rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap transition-colors", active ? "bg-surface font-medium text-foreground shadow-xs ring-1 ring-border" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground")}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
