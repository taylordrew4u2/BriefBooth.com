# 4u Digital project planner in BriefBooth

The 4u Digital consultant can open **Studio → Overview → 4u Digital project planner** to share https://customtechbuilt4u.com/project-brief/.

- **Copy planner link** copies the exact public planner address.
- **Copy client message** copies a short introduction containing the link and explaining that undecided questions can be skipped.
- **Open project planner** opens the planner in a separate tab.
- **Preview client message** exposes the complete, read-only draft. If clipboard access is unavailable, the relevant field is selected for manual copying; the message preview opens automatically when needed.

The owner chooses the client and sends the copied text through their email or messaging app. Copying does not send an email or create a booking. Submitted planner answers continue going to admin@customtechbuilt4u.com through the planner's existing delivery service.

The resource is scoped to the verified, persisted 4u Digital profile ID and is rendered only when the signed-in user ID matches the loaded profile. Other consultant studios do not display this business-specific card. Its public destination is not a secret, and the visibility condition does not replace backend authorization.

No database migration, booking worker change, new provider, paid plan, or billing setting is needed. Deployment uses the existing Cloudflare Pages Free project, preserving its existing review assets and verification files. Vercel remains paused.

Validation: ESLint, TypeScript, production export, existing async-handler regressions and local Pages route/security checks passed. A fully mocked browser check verified the correct owner, another consultant, read-only and keyboard behavior, link/message copying, clipboard failure selection, 390px and 320px layouts, and minimum 44px action targets. It made no live Supabase requests or writes.
