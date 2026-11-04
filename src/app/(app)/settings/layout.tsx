import { PageHeader } from "@/components/app/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { requireUser } from "@/server/session";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration. Infrastructure secrets stay in the hosting environment." />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <aside className="min-w-0"><SettingsNav isAdmin={user.role === "admin"} /></aside>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </>
  );
}
