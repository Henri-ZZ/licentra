import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

/**
 * Indeterminate spinner. Pair with a button or status row to signal
 * in-flight work. Sized via the parent's text-* class so it inherits
 * the surrounding font size.
 */
export function Spinner({ className }: Props) {
  return (
    <Loader2
      className={cn("size-4 animate-spin", className)}
      aria-label="Loading"
    />
  );
}