"use client";
import { DropdownMenu as DM } from "radix-ui";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export const DropdownMenuRadioGroup = DM.RadioGroup;
export const DropdownMenuSub = DM.Sub;

export function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-y-auto rounded-md border border-border bg-surface p-1 text-sm shadow-md data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}
const itemClass =
  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-muted-foreground";
export function DropdownMenuItem({ className, destructive, ...props }: React.ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return <DM.Item className={cn(itemClass, destructive && "text-danger [&_svg]:text-danger", className)} {...props} />;
}
export function DropdownMenuRadioItem({ className, children, ...props }: React.ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem className={cn(itemClass, "pr-7", className)} {...props}>
      {children}
      <DM.ItemIndicator className="absolute right-2"><Check className="size-4" /></DM.ItemIndicator>
    </DM.RadioItem>
  );
}
export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2 py-1.5 text-2xs font-medium text-muted-foreground uppercase tracking-wide", className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
export function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof DM.SubTrigger>) {
  return <DM.SubTrigger className={cn(itemClass, "data-[state=open]:bg-surface-hover", className)} {...props} />;
}
export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof DM.SubContent>) {
  return (
    <DM.Portal>
      <DM.SubContent className={cn("z-50 min-w-44 rounded-md border border-border bg-surface p-1 text-sm shadow-md", className)} {...props} />
    </DM.Portal>
  );
}
