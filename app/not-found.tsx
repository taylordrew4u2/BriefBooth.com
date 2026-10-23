import Link from "next/link";
import { Logo } from "@/components/site-header";
export default function NotFound() {
  return <><header className="simple-header"><Logo /></header><main id="main" className="info-page"><h1>Page not found</h1><p>This link may have changed. Check the address or return to BriefBooth.</p><Link href="/">Return to home</Link></main></>;
}
