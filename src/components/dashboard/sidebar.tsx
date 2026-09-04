"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BookOpenText,
  CreditCard,
  KeySquare,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/products", label: "Products", icon: Package },
  { href: "/dashboard/licenses", label: "Licenses", icon: KeySquare },
  { href: "/dashboard/orders", label: "Orders", icon: CreditCard },
  { href: "/dashboard/api-docs", label: "API Docs", icon: BookOpenText },
];

const COLLAPSED_KEY = "licentra.sidebarCollapsed";

export function DashboardSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // ignore storage read failures
    }
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore storage write failures
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-muted/30 transition-[width] duration-200 md:flex",
        collapsed ? "w-14" : "w-56",
      )}
    >
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-2",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className={cn("truncate", collapsed && "hidden")}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-2 rounded-md text-sm text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground",
            collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          <span className={cn("truncate", collapsed && "hidden")}>
            Collapse
          </span>
        </button>
      </div>
    </aside>
  );
}
