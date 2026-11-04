"use client";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { toast } from "sonner";

type Result<T> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/**
 * Runs a server action inside a transition, shows a toast with the real outcome and
 * refreshes server data on success. Never shows success unless the server confirmed it.
 */
export function useAction<A extends unknown[], T>(
  action: (...args: A) => Promise<Result<T>>,
  opts: { success?: string | ((data: T) => string) | false; refresh?: boolean; refreshOnError?: boolean; onSuccess?: (data: T) => void; onError?: (error: string) => void } = {},
) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { success, refresh = true, refreshOnError = false, onSuccess, onError } = opts;

  const execute = useCallback(
    (...args: A) =>
      new Promise<Result<T>>((resolve) => {
        startTransition(async () => {
          let res: Result<T>;
          try {
            res = await action(...args);
          } catch {
            res = { ok: false, error: "Network error. Check your connection and try again." };
          }
          if (res.ok) {
            const msg = typeof success === "function" ? success(res.data) : success === false ? null : success ?? res.message;
            if (msg) toast.success(msg);
            onSuccess?.(res.data);
            if (refresh) router.refresh();
          } else {
            toast.error(res.error);
            onError?.(res.error);
            if (refreshOnError) router.refresh();
          }
          resolve(res);
        });
      }),
    [action, success, refresh, refreshOnError, onSuccess, onError, router],
  );

  return { execute, pending };
}
