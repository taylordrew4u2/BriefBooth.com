import type { Metadata } from "next";
import { RecoveryReview } from "@/components/recovery-client";
export const metadata: Metadata = { title: "Review booking requests", robots: { index: false, follow: false } };
export default function Page() { return <RecoveryReview />; }
