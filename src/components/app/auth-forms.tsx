"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "./field";
import { bootstrapAdmin, setPassword, signIn } from "@/server/actions/auth";

function FormError({ state }: { state: { ok: boolean; error?: string } | null }) {
  if (!state || state.ok || !("error" in state)) return null;
  return <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>;
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      {notice && <p className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">{notice}</p>}
      <FormError state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required minLength={8} />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending}>Sign in</Button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(bootstrapAdmin, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push("/projects");
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <Field label="Setup token" htmlFor="token" hint="The SETUP_TOKEN value from your hosting environment.">
        <Input id="token" name="token" type="password" required autoComplete="off" />
      </Field>
      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" required autoComplete="name" />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending}>Create administrator</Button>
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.push("/dashboard");
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError state={state} />
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending}>Save password</Button>
    </form>
  );
}
