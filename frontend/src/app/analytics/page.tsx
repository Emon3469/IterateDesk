import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics/analytics-view";

export const metadata: Metadata = { title: "Insights" };

export default function Page() {
  return <AnalyticsView />;
}
