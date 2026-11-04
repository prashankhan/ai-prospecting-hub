"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { Check, ChevronsUpDown, FolderKanban, LogOut, Monitor, Moon, Plus, Sun, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { selectProject, signOut } from "@/server/actions/auth";
import type { ProjectSummary, SessionUser } from "@/server/session";
import { MobileNav } from "./sidebar";

export function ProjectSwitcher({ projects, current, isAdmin }: { projects: ProjectSummary[]; current: ProjectSummary | null; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-64 gap-2 px-2 font-semibold text-foreground" loading={pending} aria-label="Switch project">
          {!pending && (
            <span className="grid size-5 place-items-center rounded-sm bg-surface-muted text-2xs font-semibold text-muted-foreground">
              {initials(current?.name)}
            </span>
          )}
          <span className="truncate">{current?.name ?? "No project"}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        {projects.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No projects available</div>}
        {projects.map((p) => (
          <DropdownMenuItem
            key={p.id}
            onSelect={() =>
              start(async () => {
                const res = await selectProject(p.id);
                if (!res.ok) toast.error(res.error);
                router.refresh();
              })
            }
          >
            <span className="truncate">{p.name}</span>
            {p.status === "paused" && <Badge className="ml-auto">Paused</Badge>}
            {p.id === current?.id && <Check className="ml-auto !text-accent" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/projects"><FolderKanban /> Manage projects</Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/projects/new"><Plus /> New project</Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: SessionUser }) {
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  const themes = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-soft-foreground">
            {initials(user.fullName ?? user.email)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-medium">{user.fullName ?? user.email}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          <Badge tone={user.role === "admin" ? "accent" : "neutral"} className="mt-1.5 capitalize">{user.role === "admin" ? "Administrator" : "Operator"}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        {themes.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={(e) => { e.preventDefault(); setTheme(t.id); }}>
            <t.icon /> {t.label}
            {theme === t.id && <Check className="ml-auto !text-accent" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/security"><UserRound /> Account & security</Link>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onSelect={() => start(() => signOut())}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar({ user, projects, current }: { user: SessionUser; projects: ProjectSummary[]; current: ProjectSummary | null }) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border bg-canvas/85 px-3 backdrop-blur md:px-5">
      <MobileNav />
      <ProjectSwitcher projects={projects} current={current} isAdmin={user.role === "admin"} />
      <div className="ml-auto flex items-center gap-1">
        <UserMenu user={user} />
      </div>
    </header>
  );
}
