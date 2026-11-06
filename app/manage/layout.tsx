import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Manage your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default function ManageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
