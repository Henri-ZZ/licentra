import { redirect } from "next/navigation";

import { DashboardHeader } from "@/components/dashboard/header";
import { RouteProgressBar } from "@/components/dashboard/route-progress-bar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getSessionEmail } from "@/lib/auth";

export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const session = await getSessionEmail();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <RouteProgressBar />
      <DashboardSidebar />
      <div className="flex flex-1 flex-col">
        <DashboardHeader email={session} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
