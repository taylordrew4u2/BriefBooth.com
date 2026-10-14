export function calendarFile(
  title: string,
  start: string,
  end: string,
  location: string,
) {
  const esc = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;")
      .replace(/\r/g, "");
  const stamp = (s: string) =>
    new Date(s)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const data = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BriefBooth//Booking//EN",
    "BEGIN:VEVENT",
    `UID:${crypto.randomUUID()}@briefbooth`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([data], { type: "text/calendar;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "consultation.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
