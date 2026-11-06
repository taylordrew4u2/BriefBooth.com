export function calendarFeed(events){
 const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r/g,'').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
 const stamp=s=>new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//BriefBooth//Consultations//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:BriefBooth consultations'];
 for(const e of events)lines.push('BEGIN:VEVENT',`UID:${e.id}@briefbooth.com`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(e.start)}`,`DTEND:${stamp(e.end)}`,`SEQUENCE:${Number(e.revision)||0}`,`SUMMARY:${esc(e.title)}`,`STATUS:${e.status==='confirmed'?'CONFIRMED':'CANCELLED'}`,'END:VEVENT');
 lines.push('END:VCALENDAR');
 const fold=line=>{let output='',part='',size=0;for(const ch of line){const bytes=new TextEncoder().encode(ch).length;if(size+bytes>75){output+=part+'\r\n';part=' ';size=1;}part+=ch;size+=bytes;}return output+part;};
 return lines.map(fold).join('\r\n')+'\r\n';
}
