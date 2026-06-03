import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminStoreProvider } from "@/components/admin/AdminStore";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

// Access is enforced server-side by middleware (only ADMIN_EMAILS sessions reach
// here) and again by requireAdmin() inside every admin Server Action.
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return (
    <AdminStoreProvider>
      <AdminShell>{children}</AdminShell>
    </AdminStoreProvider>
  );
}
