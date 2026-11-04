"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!rounded-md !border !border-border !bg-surface !text-foreground !shadow-md !font-sans !text-sm",
              description: "!text-muted-foreground",
              error: "!text-danger",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
