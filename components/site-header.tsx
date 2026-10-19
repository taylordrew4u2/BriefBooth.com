import Link from "next/link";
export function Logo() {
  return (
    <Link href="/" className="logo" aria-label="BriefBooth home">
      <span className="logo-symbol" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="currentColor" focusable="false"><path d="M6 17 24 10 58 13 58 20 24 17 6 23Z M8 26 24 20 24 60 8 54Z M42 26 56 22 56 58 42 53Z M28 40 38 39 38 45 28 46Z M28 48 41 46 47 48 47 51 28 53Z" /></svg>
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
