import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/app/auth-forms";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured } from "@/lib/env";
import { getSessionUser } from "@/server/session";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  disabled: "This account is disabled. Contact an administrator.",
  link: "That sign-in link is invalid or has expired. Ask an administrator for a new invitation.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  await connection();
  if (!isSupabaseConfigured()) redirect("/setup");
  const { next, error } = await searchParams;
  const user = await getSessionUser();
  if (user?.status === "active") redirect("/dashboard");
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">Access is by invitation from an administrator.</p>
        </div>
        <LoginForm next={next} notice={error ? NOTICES[error] : undefined} />
        <p className="text-center text-xs text-muted-foreground">
          First deployment? <Link href="/setup" className="text-accent hover:underline">Set up the first administrator</Link>
        </p>
      </CardContent>
    </Card>
  );
}
