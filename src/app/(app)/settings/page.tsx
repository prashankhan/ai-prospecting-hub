import { ProfileForm, ThemePicker } from "@/components/settings/general";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/server/session";

export const metadata = { title: "Settings" };

export default async function GeneralSettingsPage() {
  const user = await requireUser();
  return (
    <>
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Theme preference is stored in this browser.</CardDescription>
        </CardHeader>
        <CardContent><ThemePicker /></CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your name appears on assignments, notes and activity.</CardDescription>
        </CardHeader>
        <CardContent><ProfileForm fullName={user.fullName} email={user.email} /></CardContent>
      </Card>
      <Card>
        <CardHeader className="flex-col gap-0.5">
          <CardTitle>Keyboard shortcuts</CardTitle>
          <CardDescription>Available when focus is not in a text field.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {[
              ["g d / g p / g o", "Go to dashboard / prospects / outreach"],
              ["g i / g r / g s", "Go to discover / reports / settings"],
              ["[", "Collapse or expand the sidebar"],
              ["j / k", "Outreach: next / previous prospect"],
              ["c", "Outreach: copy message and open Instagram"],
              ["e", "Outreach: edit message"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt><kbd className="rounded-sm border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
