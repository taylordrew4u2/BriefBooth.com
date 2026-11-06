import Link from "next/link";
import { SiteHeader, Logo } from "@/components/site-header";
export default function Home() {
  if (process.env.NEXT_PUBLIC_BOOKING_RECOVERY === "1") return <ConsultationHome />;
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
        <section className="consultant-control" aria-labelledby="control-title">
          <div className="control-intro">
            <span className="step-number">PREPARED BEFORE THE FIRST HELLO</span>
            <h2 id="control-title">Less admin.<br />A better first conversation.</h2>
            <p>Give every client a clear next step, and keep the details together in your studio.</p>
          </div>
          <div className="control-features">
            <article><span aria-hidden="true">01</span><div><h3>Ask a little. Learn a lot.</h3><p>Start with a specialty template. Clients answer one friendly question at a time, with room to skip optional details.</p></div></article>
            <article><span aria-hidden="true">02</span><div><h3>You decide what gets confirmed.</h3><p>Let clients book instantly or review each request first. Your intake answers are right there when you decide.</p></div></article>
            <article><span aria-hidden="true">03</span><div><h3>Keep everyone on the same page.</h3><p>Confirmation emails bring together the intake, appointment time, and Zoom link or in-person details.</p></div></article>
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
            <summary>Can I approve requests before a meeting is confirmed?</summary>
            <p>Yes. Choose approval mode in your studio. Review the client’s intake, then approve or decline. The requested time is held while you decide.</p>
          </details>
          <details>
            <summary>Can I charge for my consultation?</summary>
            <p>Offer free consultations, arrange payment directly, or connect Stripe to accept payment at checkout. Stripe processing fees apply to paid bookings; BriefBooth adds no platform fee.</p>
          </details>
          <details><summary>Will clients receive reminders?</summary><p>Consultants can enable appointment reminders in Availability. Reminders use the existing free email allowance and may be delayed if its limit is reached.</p></details>
          <details>
            <summary>Can I connect Zoom?</summary>
            <p>Automatic Zoom connections are currently available to our initial connected account while broader access awaits Zoom review. Other consultants can add a Zoom meeting link in their studio.</p>
          </details>
          <details>
            <summary>Does BriefBooth sync my other calendars?</summary>
            <p>
              Connect Google Calendar to check busy times on your primary calendar and create Google Meet consultations. Availability refreshes periodically. Apple and Outlook can subscribe to a private calendar feed or use calendar downloads. Their busy times are not read by BriefBooth.
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

function ConsultationHome() {
  return <>
    <SiteHeader />
    <main id="main">
      <section className="hero">
        <div className="hero-copy">
          <div className="product-label"><span />4U DIGITAL · FREE CONSULTATIONS</div>
          <h1>Your idea.<br />A clearer plan.<br /><span>Let’s talk.</span></h1>
          <p>Book a free 30-minute Google Meet consultation with 4u Digital for your website, app, software, or automation project.</p>
          <div className="hero-actions">
            <Link className="button" href="/book/4u-digital/">Request a consultation <span aria-hidden="true">↗</span></Link>
            <Link className="text-link" href="#how-it-works">How booking works <span aria-hidden="true">↓</span></Link>
          </div>
          <div className="hero-note">No payment or client account needed. Your appointment is confirmed after approval.</div>
        </div>
        <div className="product-preview">
          <div className="browser-bar"><span>briefbooth.com/book/4u-digital</span></div>
          <div className="preview-content">
            <div className="preview-profile">
              <div className="avatar">4u</div>
              <h2>4u Digital</h2>
              <p>App, web &amp; full-stack development</p>
              <div className="profile-rule" />
              <h3>A rough idea is enough.</h3>
              <p>Tell us what you want to build, improve, or fix. We’ll work through the next step together.</p>
              <div className="preview-meta"><span>◷ &nbsp; 30 minutes</span><span>↗ &nbsp; Google Meet</span></div>
            </div>
            <div className="preview-calendar">
              <div className="preview-question">
                <span className="step-number">YOUR FIRST CONVERSATION</span>
                <h3>Choose a time that works.</h3>
                <p>Share a little context, request an available time, and receive a private link to check your request.</p>
                <p>When 4u Digital approves, your confirmation includes the Google Meet link.</p>
              </div>
              <Link href="/book/4u-digital/" className="button preview-button">Choose a consultation <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>
      <section id="how-it-works" className="how-section">
        <div className="section-intro"><h2>From an idea<br />to a conversation.</h2><p>Your request stays inside BriefBooth.</p></div>
        <div className="steps">
          <article><span className="step-number">01 / INTRODUCE YOURSELF</span><h3>Tell us a little.</h3><p>Choose your project types and share any helpful context. A detailed project plan is optional.</p></article>
          <article><span className="step-number">02 / REQUEST A TIME</span><h3>Find an opening.</h3><p>Choose from available times. Your request awaits approval; it is not yet a confirmed appointment.</p></article>
          <article><span className="step-number">03 / MEET ONLINE</span><h3>Get your confirmation.</h3><p>After approval, your private booking page and confirmation show the Google Meet link.</p></article>
        </div>
      </section>
      <section className="faq">
        <h2>Before you book.</h2>
        <details><summary>Does this consultation cost anything?</summary><p>No. The first 30-minute consultation is free. You won’t enter a card or make a payment to book.</p></details>
        <details><summary>How do I check or cancel my request?</summary><p>Keep the private booking link shown after you submit. You can use it to check your status or cancel before your appointment starts.</p></details>
        <details><summary>Can I create a consultant account?</summary><p>Account sign-in, new consultant registration, and the full Studio are temporarily unavailable. This booking page is for 4u Digital consultations.</p></details>
      </section>
    </main>
    <footer className="site-footer"><Logo /><span><Link href="/support/">Support</Link> · <Link href="/privacy/">Privacy</Link> · <Link href="/terms/">Terms</Link></span><Link href="/booking-review/">Review consultation requests ↗</Link></footer>
  </>;
}
