import Link from "next/link";
import { SiteHeader, Logo } from "@/components/site-header";
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <section className="hero">
          <div className="hero-copy">
            <div className="product-label">
              <span />
              BUILT FOR INDEPENDENT CONSULTANTS
            </div>
            <h1>
              Your expertise.
              <br />
              Their next step.
              <br />
              <span>One booking link.</span>
            </h1>
            <p>
              Get to know your clients before you meet.
              <br className="desktop-break" /> One link for your intake questions, consultation options, and availability.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/account?mode=signup">
                Create your booking page <span aria-hidden="true">↗</span>
              </Link>
              <Link className="text-link" href="/book/demo">
                See it in action <span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="hero-note">
              No credit card. No scheduling subscription.
            </div>
          </div>
          <div className="product-preview">
            <div className="browser-bar">
              <div className="browser-dots">
                <i />
                <i />
                <i />
              </div>
              <span>briefbooth.com/book/you</span>
              <span aria-hidden="true">↗</span>
            </div>
            <div className="preview-content">
              <div className="preview-profile">
                <div className="avatar">AM</div>
                <h2>Alex Morgan</h2>
                <p>Business & growth consultant</p>
                <div className="profile-rule" />
                <h3>Let’s find your next move.</h3>
                <p>
                  A focused conversation.
                  <br />A clearer way forward.
                </p>
                <div className="preview-meta">
                  <span>◷ &nbsp; 30 minutes</span>
                  <span>↗ &nbsp; Video consultation</span>
                </div>
                <span className="sample-tag">Example booking page</span>
              </div>
              <div className="preview-calendar">
                <div className="preview-journey"><span>1 · Introduce yourself</span><span>2 · Choose a consultation</span><span>3 · Pick a time</span></div>
                <div className="preview-question">
                  <span className="step-number">A QUICK INTRODUCTION</span>
                  <h3>What would you like to work on?</h3>
                  <p>A sentence or two is plenty.</p>
                  <div className="preview-answer">I’m launching a new project and would love help planning my next steps.</div>
                  <span className="field-help">Your consultant gets the context before you meet.</span>
                </div>
                <Link href="/book/demo" className="button preview-button">
                  Try the booking experience <span aria-hidden="true">→</span>
                </Link>
                <span className="preview-timezone">
                  No client account needed
                </span>
              </div>
            </div>
            <div className="preview-footer">
              <span className="status-dot" /> Your schedule. Your terms.
            </div>
          </div>
        </section>
        <section className="value-strip">
          <span>Less back-and-forth.</span>
          <span>More meaningful conversations.</span>
          <span>Built around your availability.</span>
        </section>
        <section id="how-it-works" className="how-section">
          <div className="section-intro">
            <h2>
              From “let’s talk”
              <br />
              to on the calendar.
            </h2>
            <p>
              Set it up once. Share it anywhere.
              <br />
              Make room for the work you do best.
            </p>
          </div>
          <div className="steps">
            <article>
              <span className="step-number">01 / YOUR PAGE</span>
              <h3>Make it yours.</h3>
              <p>
                Add your profile, choose an intake template, and offer the consultations that fit your work.
              </p>
            </article>
            <article>
              <span className="step-number">02 / YOUR SCHEDULE</span>
              <h3>Set your boundaries.</h3>
              <p>
                Choose your weekly hours and timezone. Clients see available
                times, with room to prepare.
              </p>
            </article>
            <article>
              <span className="step-number">03 / YOUR NEXT CLIENT</span>
              <h3>Share. Book. Connect.</h3>
              <p>
                Send your personal link. Clients answer your questions, then book a time—no account needed.
              </p>
            </article>
          </div>
        </section>
        <section className="closing">
          <div>
            <h2>Your next conversation starts here.</h2>
            <p>A booking page that works as independently as you do.</p>
          </div>
          <Link className="button" href="/account?mode=signup">
            Create your page <span aria-hidden="true">↗</span>
          </Link>
        </section>
        <section className="faq">
          <h2>A few good questions.</h2>
          <details>
            <summary>Do my clients need an account?</summary>
            <p>
              No. They complete your questionnaire, select a consultation, and
              choose an available time.
            </p>
          </details>
          <details>
            <summary>Can clients cancel a booking?</summary>
            <p>
              Yes. Every confirmed booking has a private management link.
              Clients can cancel before the consultation starts and book another
              time.
            </p>
          </details>
          <details>
            <summary>Does BriefBooth sync my other calendars?</summary>
            <p>
              Not yet. BriefBooth prevents conflicts with bookings made here.
              You can download a calendar event after booking. External calendar
              sync and automatic email reminders are not included.
            </p>
          </details>
        </section>
      </main>
      <footer className="site-footer">
        <Logo />
        <span><Link href="/support">Support</Link> · <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link></span>
        <Link href="/account">Consultant sign in ↗</Link>
      </footer>
    </>
  );
}
