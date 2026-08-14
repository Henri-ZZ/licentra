"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  products: { id: string; name: string }[];
  defaultProductId?: string;
  defaultValue?: string;
}

const ALL_PRODUCTS = "all";

export function LicensesSearchForm({
  products,
  defaultProductId,
  defaultValue,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(defaultValue ?? "");
  const [product, setProduct] = useState(defaultProductId ?? ALL_PRODUCTS);

  function navigate(nextQ: string, nextProduct: string) {
    const params = new URLSearchParams();
    if (nextProduct && nextProduct !== ALL_PRODUCTS) {
      params.set("productId", nextProduct);
    }
    if (nextQ) params.set("q", nextQ);
    const qs = params.toString();
    // Client-side navigation: no full page reload. The server component
    // re-renders from the new searchParams and Next swaps in the RSC payload.
    startTransition(() => {
      router.push(qs ? `/dashboard/licenses?${qs}` : "/dashboard/licenses");
    });
  }

  function onSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    navigate(q.trim(), product);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={product}
        onValueChange={(v) => {
          setProduct(v);
          navigate(q.trim(), v);
        }}
      >
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="All products" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_PRODUCTS}>All products</SelectItem>
          {products.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <form onSubmit={onSearch} className="flex flex-1 gap-2 min-w-[260px]">
        <input
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="email or transaction id"
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        <Button type="submit" disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>
    </div>
  );
}
