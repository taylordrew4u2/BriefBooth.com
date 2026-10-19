import Link from "next/link";
import {Logo} from "./site-header";
export function InfoPage({title,children}:{title:string;children:React.ReactNode}){return <><header className="simple-header"><Logo/><Link href="/studio">Your studio ↗</Link></header><main id="main" className="info-page"><h1>{title}</h1>{children}<hr/><nav aria-label="Help and policies"><Link href="/support">Support</Link> · <Link href="/zoom">Zoom guide</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></nav></main></>}
