import Link from "next/link";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { SetupForm } from "@/components/app/auth-forms";
import { Card, CardContent } from "@/components/ui/card";
import { configurationStatus } from "@/lib/env";
import { adminExists } from "@/server/actions/auth";

export const metadata = { title: "Setup" };

const LABELS: Record<string, string> = {
  supabase: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
  serviceRole: "SUPABASE_SERVICE_ROLE_KEY",
  encryptionKey: "CREDENTIALS_ENCRYPTION_KEY",
  setupToken: "SETUP_TOKEN",
  cronSecret: "CRON_SECRET (background jobs)",
};

export default async function SetupPage() {
  const status = configurationStatus();
  const ready = status.supabase && status.serviceRole && status.setupToken;
  let hasAdmin = false;
  let dbError = false;
  if (ready) {
    try {
      hasAdmin = await adminExists();
    } catch {
      dbError = true;
    }
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <div>
          <h1 className="text-lg font-semibold">Initial setup</h1>
          <p className="text-sm text-muted-foreground">Create the first administrator for this workspace.</p>
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {Object.entries(status).map(([key, ok]) => (
            <li key={key} className="flex items-start gap-2">
              {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />}
              <span className={ok ? "text-muted-foreground" : "text-foreground"}><code className="text-xs">{LABELS[key]}</code></span>
            </li>
          ))}
        </ul>
        {!ready ? (
          <p className="text-sm text-muted-foreground">Add the missing environment variables (see README → Configuration), redeploy, then reload this page.</p>
        ) : dbError ? (
          <p className="text-sm text-danger">Couldn&apos;t reach the database. Check the Supabase keys and that the migrations have been applied.</p>
        ) : hasAdmin ? (
          <p className="text-sm text-muted-foreground">Setup is complete. <Link className="text-accent hover:underline" href="/login">Sign in</Link></p>
        ) : (
          <SetupForm />
        )}
      </CardContent>
    </Card>
  );
}
