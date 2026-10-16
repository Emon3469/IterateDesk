import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditView } from "@/components/audit/audit-view";

export const metadata: Metadata = { title: "Audit Trail" };

export default function Page() {
  return (
    <Suspense>
      <AuditView />
    </Suspense>
  );
}
