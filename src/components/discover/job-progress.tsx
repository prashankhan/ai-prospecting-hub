"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { Square } from "lucide-react";
import { Confirm } from "@/components/app/confirm";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { advanceJob, cancelJob } from "@/server/actions/jobs";

/**
 * While a job is open, nudges it forward and refreshes progress. Jobs also continue via the
 * cron worker when this page is closed, so closing the browser doesn't stop them.
 */
export function JobProgressDriver({ jobId, active }: { jobId: string; active: boolean }) {
  const router = useRouter();
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const tick = async () => {
      if (busy.current || stopped || document.visibilityState !== "visible") return;
      busy.current = true;
      try {
        await advanceJob(jobId);
      } finally {
        busy.current = false;
        if (!stopped) router.refresh();
      }
    };
    void tick();
    const t = setInterval(tick, 4000);
    return () => { stopped = true; clearInterval(t); };
  }, [jobId, active, router]);
  return null;
}

export function CancelJobButton({ jobId }: { jobId: string }) {
  const { execute } = useAction(cancelJob);
  return (
    <Confirm
      trigger={<Button size="sm"><Square /> Cancel job</Button>}
      title="Cancel this job?"
      description="Work already completed is kept. The job stops after the record it is currently processing."
      confirmLabel="Cancel job"
      destructive
      onConfirm={() => execute(jobId)}
    />
  );
}
