import Link from "next/link";
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="BriefBooth home">
      <span className="logo-symbol" aria-hidden="true">
        b.
      </span>
      BriefBooth
    </Link>
  );
}
export function SiteHeader() {
  return (
    <header className="site-header">
      <Logo />
      <nav aria-label="Main navigation">
        <Link href="/#how-it-works">How it works</Link>
        <Link href="/book/demo">Try booking</Link>
        <Link href="/account" className="nav-signin">
          Sign in
        </Link>
        <Link href="/account?mode=signup" className="button small">
          Create your page <span aria-hidden="true">↗</span>
        </Link>
      </nav>
    </header>
  );
}
