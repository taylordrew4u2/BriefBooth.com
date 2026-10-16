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
              Give clients a simple way to book your time.
              <br className="desktop-break" /> You bring the expertise. We’ll
              handle the scheduling.
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
                <div className="calendar-title">
                  <strong>Choose a time</strong>
                  <span>October 2026</span>
                </div>
                <div className="mini-calendar">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                    <span className="weekday" key={"d" + i}>
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: 28 }, (_, i) => (
                    <span
                      key={i}
                      className={
                        i === 14
                          ? "calendar-picked"
                          : i < 11
                            ? "calendar-muted"
                            : ""
                      }
                    >
                      {i + 1}
                    </span>
                  ))}
                </div>
                <div className="time-preview">
                  <span>10:00 am</span>
                  <span className="time-picked">11:30 am</span>
                  <span>2:00 pm</span>
                </div>
                <Link href="/book/demo" className="button preview-button">
                  Try the booking experience <span aria-hidden="true">→</span>
                </Link>
                <span className="preview-timezone">
                  Times shown in your local timezone
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
                Add your profile and the consultations you offer. Choose how
                long each conversation needs.
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
                Send your personal link. Clients choose a time and book without
                creating an account.
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
        <span>Good conversations start with a little time.</span>
        <Link href="/account">Consultant sign in ↗</Link>
      </footer>
    </>
  );
}
