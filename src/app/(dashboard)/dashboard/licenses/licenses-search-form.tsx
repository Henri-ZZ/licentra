"use client";

import { useTransition } from "react";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

interface Props {
  defaultValue?: string;
  inputClassName?: string;
}

export function LicensesSearchForm({ defaultValue, inputClassName }: Props) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action=""
      className="flex gap-2"
      onSubmit={(e) => {
        // form is a GET; we want the same effect, but the transition
        // keeps the spinner going while the next page renders.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const q = String(fd.get("q") ?? "").trim();
        const next = q ? `/dashboard/licenses?q=${encodeURIComponent(q)}` : "/dashboard/licenses";
        startTransition(() => {
          window.location.href = next;
        });
      }}
    >
      <input
        name="q"
        defaultValue={defaultValue}
        placeholder="email or transaction id"
        className={
          inputClassName ??
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        }
      />
      <Button type="submit" disabled={pending}>
        {pending && <Spinner />}
        {pending ? "Searching…" : "Search"}
      </Button>
    </form>
  );
}
