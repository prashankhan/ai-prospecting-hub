import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/app/auth-forms";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionUser } from "@/server/session";

export const metadata = { title: "Set password" };

export default async function SetPasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?error=link");
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-lg font-semibold">Set your password</h1>
          <p className="text-sm text-muted-foreground">Signed in as {user.email}</p>
        </div>
        <SetPasswordForm redirectTo="/dashboard" />
      </CardContent>
    </Card>
  );
}
