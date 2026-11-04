"use client";
import { useTheme } from "next-themes";
import { useActionState, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Monitor, Moon, Sun } from "lucide-react";
import { Field } from "@/components/app/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { updateOwnProfile } from "@/server/actions/auth";

export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const options = [
    { id: "light", label: "Light", Icon: Sun },
    { id: "dark", label: "Dark", Icon: Moon },
    { id: "system", label: "System", Icon: Monitor },
  ];
  return (
    <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-2">
      {options.map(({ id, label, Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={mounted && theme === id}
          onClick={() => setTheme(id)}
          className={cn("flex flex-col items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-3 text-sm transition-colors hover:border-border-strong", mounted && theme === id && "border-accent ring-3 ring-accent/15")}
        >
          <Icon className="size-4 text-muted-foreground" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProfileForm({ fullName, email }: { fullName: string | null; email: string }) {
  const [state, action, pending] = useActionState(updateOwnProfile, null);
  useEffect(() => {
    if (state?.ok) toast.success("Profile updated.");
    else if (state && !state.ok) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" defaultValue={fullName ?? ""} required maxLength={120} />
      </Field>
      <Field label="Email" htmlFor="email" hint="Contact an administrator to change your email.">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <div><Button type="submit" variant="primary" loading={pending}>Save profile</Button></div>
    </form>
  );
}
