"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

function Brand({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-1.5 font-semibold tracking-tight">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
        <Sparkles className="size-3.5" />
      </span>
      {!collapsed && <span className="truncate text-sm">Prospecting Hub</span>}
    </Link>
  );
}

function NavLinks({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm font-medium transition-colors",
              active ? "bg-accent-soft text-accent-soft-foreground" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              collapsed && "justify-center px-0",
            )}
          >
            <item.icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
        return collapsed ? <Tooltip key={item.href} content={item.label} side="right">{link}</Tooltip> : link;
      })}
    </nav>
  );
}

export function Sidebar({ initialCollapsed }: { initialCollapsed: boolean }) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const router = useRouter();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `aph_sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  // "g" then a letter navigates (Linear-style); ignored while typing.
  useEffect(() => {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "[") {
        toggle();
        return;
      }
      if (armed) {
        const map: Record<string, string> = { d: "/dashboard", p: "/prospects", o: "/outreach", r: "/reports", s: "/settings", i: "/discover" };
        if (map[e.key]) router.push(map[e.key]);
        armed = false;
        return;
      }
      if (e.key === "g") {
        armed = true;
        clearTimeout(timer);
        timer = setTimeout(() => (armed = false), 1000);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col gap-4 border-r border-border bg-sidebar px-2.5 py-3 transition-[width] duration-150 md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <div className={cn("flex h-7 items-center", collapsed ? "justify-center" : "justify-between")}>
        <Brand collapsed={collapsed} />
      </div>
      <NavLinks collapsed={collapsed} />
      <div className={cn("mt-auto flex", collapsed ? "justify-center" : "justify-end")}>
        <Tooltip content={`${collapsed ? "Expand" : "Collapse"} sidebar ( [ )`} side="right">
          <Button variant="ghost" size="icon-sm" onClick={toggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </Tooltip>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Open navigation">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-4 p-3">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-7 items-center"><Brand /></div>
        <NavLinks onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
