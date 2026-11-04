import { cookies } from "next/headers";
import { Sidebar } from "@/components/app/sidebar";
import { Topbar } from "@/components/app/topbar";
import { getAccessibleProjects, getCurrentProject, requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [projects, current, store] = await Promise.all([getAccessibleProjects(), getCurrentProject(), cookies()]);
  const collapsed = store.get("aph_sidebar")?.value === "collapsed";
  return (
    <div className="flex min-h-dvh">
      <Sidebar initialCollapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} projects={projects} current={current} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
