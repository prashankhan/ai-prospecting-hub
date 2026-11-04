import "server-only";
import { ZodError } from "zod";
import { ForbiddenError } from "@/lib/domain/permissions";
import { ProviderError, PROVIDER_ERROR_MESSAGES } from "@/lib/ai/types";
import { redactSecrets } from "@/lib/security/crypto";

export type ActionResult<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string };

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export class UsageLimitError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "UsageLimitError";
  }
}

/** Converts known errors into safe, user-facing messages; logs the rest without secrets. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof UserFacingError || err instanceof ForbiddenError) return err.message;
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return issue ? `${issue.path.join(".") || "Input"}: ${issue.message}` : "Invalid input.";
  }
  if (err instanceof ProviderError) return `${PROVIDER_ERROR_MESSAGES[err.code]}${err.message ? ` (${redactSecrets(err.message)})` : ""}`;
  const pg = err as { code?: string; message?: string };
  if (pg && typeof pg.message === "string") {
    if (pg.code === "P0001") return pg.message;
    if (pg.code === "42501") return "You don't have permission to do that.";
    if (pg.code === "23505") return "That record already exists.";
  }
  console.error("[action] unexpected error:", redactSecrets(err instanceof Error ? `${err.name}: ${err.message}` : String(err)));
  return "Something went wrong. Please try again.";
}

export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (err) {
    // Let Next.js redirects/notFound propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw err;
    }
    return { ok: false, error: toErrorMessage(err) };
  }
}

/** Throws when a Supabase query returned an error. */
export function check<T>(res: { data: T; error: { message: string; code?: string } | null }): NonNullable<T> {
  if (res.error || res.data === null) {
    if (!res.error) throw new Error("Record not found");
    const e = new Error(res.error.message) as Error & { code?: string };
    e.code = res.error.code;
    throw e;
  }
  return res.data as NonNullable<T>;
}
