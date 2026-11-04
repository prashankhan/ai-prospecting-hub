import { Sparkles } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 font-semibold tracking-tight">
        <span className="grid size-7 place-items-center rounded-md bg-accent text-accent-foreground"><Sparkles className="size-4" /></span>
        AI Prospecting Hub
      </div>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
