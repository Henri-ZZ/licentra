import { KeyRound } from "lucide-react";

import { SignOutButton } from "@/components/dashboard/sign-out-button";

export function DashboardHeader({ email }: { email: string }) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4" />
        <span className="font-semibold tracking-tight">Licentra</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">{email}</span>
        <SignOutButton />
      </div>
    </header>
  );
}