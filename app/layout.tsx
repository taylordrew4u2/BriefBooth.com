import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "BriefBooth — Your expertise. Their next step.",
    template: "%s | BriefBooth",
  },
  description:
    "A simple booking page for independent consultants. Share your expertise, set your availability, and let clients book a consultation.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
