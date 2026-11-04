"use client";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="This page couldn't load"
      description={<>Something went wrong while loading data.{error.digest && <span className="mt-1 block font-mono text-xs">Reference: {error.digest}</span>}</>}
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
