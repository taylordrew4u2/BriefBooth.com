import type { Metadata } from "next";
import { RecoveryStatus } from "@/components/recovery-client";
export const metadata: Metadata = { title: "Your booking", robots: { index: false, follow: false } };
export default function Page() { return <RecoveryStatus />; }
