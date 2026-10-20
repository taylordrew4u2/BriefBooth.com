"use client";
import {useEffect,useState} from 'react';
import {db} from '@/lib/supabase';
import {Button} from '@/components/ui/button';
type Status={configured:boolean;connected:boolean;synced_at:string|null;error:string|null};
export function GoogleConnection(){
 const [status,setStatus]=useState<Status|null>(null);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [check,setCheck]=useState(0);
 useEffect(()=>{let active=true;Promise.resolve(db().rpc('google_status')).then(({data,error})=>{if(!active)return;if(error)setMessage('Google connection status is unavailable.');else setStatus(data);}).catch(()=>{if(active)setMessage('Google connection status is unavailable.');});return()=>{active=false;};},[check]);
 async function connect(){setBusy(true);setMessage('');try{const {data,error}=await db().rpc('google_begin');if(error||!data)throw Error(error?.message||'Unable to connect Google.');const url=new URL(data);if(url.origin!=='https://accounts.google.com')throw Error('Invalid authorization address.');window.location.assign(url.href);}catch(e){setMessage(e instanceof Error?e.message:'Unable to connect.');setBusy(false);}}
 async function disconnect(){setBusy(true);try{const {error}=await db().rpc('google_disconnect');if(error)throw error;setStatus(null);setCheck(c=>c+1);setMessage('Disconnected. Meeting types that offer Google Meet are hidden; refresh your studio before editing them. Existing Google events remain in your calendar.');}catch{setMessage('Could not disconnect. Please try again.');}finally{setBusy(false);}}
 return <section className="inset-form" aria-label="Google Calendar and Meet"><h3>Google Calendar &amp; Meet</h3><p>Choose Google Meet alongside Zoom. With your permission, BriefBooth checks busy times on your primary Google calendar and creates a calendar event and Meet link after confirmation or approval. No paid add-on is required.</p>
 <p className="helper">Availability refreshes about every five minutes. If sync becomes stale, new bookings pause until it recovers. Only busy times are stored; your other event titles stay private. Free Google account limits apply.</p>
 <p role="status">{status?.connected?status.error||'Google is connected.':status&&!status.configured?'Google setup is being completed. Your existing booking options still work.':status?'Google is not connected.':'Checking Google connection…'}</p>
 {status?.configured&&<Button type="button" disabled={busy} onClick={connect}>{busy?'Please wait…':status.connected?'Reconnect Google':'Connect Google Calendar & Meet'}</Button>}
 {status?.connected&&<Button type="button" variant="outline" disabled={busy} onClick={disconnect}>Disconnect Google</Button>}
 <Button type="button" variant="outline" disabled={busy} onClick={()=>setCheck(c=>c+1)}>Refresh connection status</Button>
 {message&&<p role="status">{message}</p>}
 <p className="helper">Disconnecting hides meeting types that offer Google Meet and removes saved credentials and busy times. To revoke Google’s permission as well, remove BriefBooth from your Google account’s third-party connections. Existing meetings remain in Google Calendar.</p></section>;
}
