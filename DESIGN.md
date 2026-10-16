# BriefBooth design direction

The product is a consultation booking platform for independent consultants. The approved palette is light grey `#B4B4B4`, blue `#137FEC`, dark grey `#676767`, and black grey `#333333`, with white surfaces and restrained tints. The product interface is centered on choosing a service and reserving a time. The earlier cream/forest/architectural brand board was rejected and is not a source for future UI work. Do not introduce outdoor imagery or lifestyle art.

Use the BriefBooth override at the end of `app/globals.css` as the active brand token source. Instrument Sans is the intended font. The used React primitives are retained in `components/ui/`; form inputs, textareas, and primary buttons use them. Keep controls accessible and keyboard-operable. Use visible labels, active state fills, error messages, loading feedback, and touch areas at least 44px high.

The homepage explains the product and shows an explicitly labeled example. `/book/demo` is an interactive demonstration, not a real consultant or persisted booking. Never replace actual bookings with sample data in `/studio`.

Booking is three screens: service selection, date/time selection, then client details. Clients require no account. Consultant settings are profile, consultations, availability, and bookings. The booking confirmation explains that the client must save their private link and that no email is sent.

Visual review used screenshots at 390, 1440, and 1728 pixels, verified the loaded font, and measured rendered spacing. Final measured review had no critical or serious findings; moderate findings concern nonstandard spacing values. There was no pre-existing UI in the repository to use as a visual baseline.

Use exact brand blue for main calls to action with large bold white labels. Smaller controls use dark grey/white or blue-tinted selected fills so normal-size labels remain readable. Never use light grey for body text on white.
