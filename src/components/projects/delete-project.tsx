"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Confirm } from "@/components/app/confirm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { deleteProject } from "@/server/actions/projects";

export function DeleteProject({ projectId, name }: { projectId: string; name: string }) {
  const [typed, setTyped] = useState("");
  const router = useRouter();
  const { execute } = useAction(deleteProject, { onSuccess: () => router.push("/projects") });
  return (
    <Confirm
      destructive
      trigger={<Button variant="danger-ghost">Delete project</Button>}
      title={`Delete ${name}?`}
      description="This permanently deletes the project, its prospects, drafts, notes and activity. Global business identities and do-not-contact records are kept."
      confirmLabel="Delete permanently"
      onConfirm={() => execute(projectId, typed)}
    >
      <Input aria-label="Type the project name to confirm" placeholder={name} value={typed} onChange={(e) => setTyped(e.target.value)} />
    </Confirm>
  );
}
