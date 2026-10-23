"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Public profile ID: keep this business resource in its owner's studio only.
const plannerOwnerId = "adc53778-f007-4c58-bd47-ba7a675abb29";
const plannerUrl = "https://customtechbuilt4u.com/project-brief/";
const clientMessage = `Hi! You can share your website, app or software ideas with 4u Digital here:

${plannerUrl}

Start with what you know and skip anything you haven’t decided. You can add examples, colors and files, then review everything before sending it to me.

4u Digital`;

export function ProjectPlannerCard({ ownerId }: { ownerId: string }) {
  const [feedback, setFeedback] = useState("");
  const linkField = useRef<HTMLInputElement>(null);
  const messageField = useRef<HTMLTextAreaElement>(null);
  const messagePreview = useRef<HTMLDetailsElement>(null);

  if (ownerId !== plannerOwnerId) return null;

  async function copy(kind: "link" | "message") {
    try {
      await navigator.clipboard.writeText(kind === "link" ? plannerUrl : clientMessage);
      setFeedback(kind === "link"
        ? "Planner link copied. Paste it into an email or message to your client."
        : "Client message copied. Paste it into your email or messaging app and send when you’re ready.");
    } catch {
      if (kind === "message" && messagePreview.current) messagePreview.current.open = true;
      const field = kind === "link" ? linkField.current : messageField.current;
      field?.focus();
      field?.select();
      setFeedback(kind === "link"
        ? "Automatic copying is unavailable. The planner link is selected and ready for you to copy."
        : "Automatic copying is unavailable. The client message is selected; copy it from the preview below.");
    }
  }

  return (
    <section className="booking-link-card project-planner-card" aria-labelledby="project-planner-title">
      <span className="studio-eyebrow">4U DIGITAL · CLIENT RESOURCES</span>
      <h2 id="project-planner-title">4u Digital project planner</h2>
      <p>Send clients a starting point for their website, app or software ideas. They can explore styles, add references and files, and skip anything they haven’t decided. Submitted briefs go to admin@customtechbuilt4u.com.</p>
      <label htmlFor="project-planner-link">Project planner link</label>
      <Input id="project-planner-link" ref={linkField} type="url" readOnly value={plannerUrl} onFocus={event => event.target.select()} />
      <div className="template-actions">
        <Button type="button" onClick={() => void copy("link")}>Copy planner link</Button>
        <Button type="button" variant="outline" className="planner-secondary-action" onClick={() => void copy("message")}>Copy client message</Button>
        <a className="button secondary" href={plannerUrl} target="_blank" rel="noopener noreferrer">Open project planner ↗</a>
      </div>
      <p className="planner-copy-feedback" role="status" aria-live="polite">{feedback}</p>
      <details ref={messagePreview} className="planner-message-preview">
        <summary>Preview client message</summary>
        <label htmlFor="project-planner-message">Message to send to a client</label>
        <Textarea id="project-planner-message" ref={messageField} readOnly value={clientMessage} rows={7} onFocus={event => event.target.select()} />
        <p className="field-help">Copying prepares the text for you. Choose the recipient and send it using your own email or messaging app.</p>
      </details>
    </section>
  );
}
