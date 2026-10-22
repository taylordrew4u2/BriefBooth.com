import {createClient} from 'npm:@supabase/supabase-js@2';
import {scopes,eventId,eventBody,meetingUrl,busyPeriods} from './provider.mjs';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false}});
const callback='https://briefbooth.com/api/google/callback';
async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await db.rpc(name,args);if(error)throw Error('Calendar operation failed');return data;}
async function google(path:string,token:string,method='GET',body?:unknown){return fetch('https://www.googleapis.com/calendar/v3/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});}
async function sync(owner:string,token:string){const at=new Date();const end=new Date(at.getTime()+62*86400000);const r=await google('freeBusy',token,'POST',{timeMin:at.toISOString(),timeMax:end.toISOString(),items:[{id:'primary'}]});if(!r.ok)throw Error('Availability unavailable');await rpc('google_sync_busy',{p_owner:owner,p_busy:busyPeriods(await r.json()),p_at:at.toISOString()});}
Deno.serve(async req=>{
 const u=new URL(req.url);const redirect=(result:string)=>new Response(null,{status:303,headers:{Location:'https://briefbooth.com/studio/?google='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 if(req.method==='GET'&&u.pathname.endsWith('/callback')){
  try{
   const state=u.searchParams.get('state')||'';if(!/^[0-9a-f-]{36}$/i.test(state))return redirect('expired');
   const owner=await rpc('google_consume_state',{p_state:state});if(!owner)return redirect('expired');
   const code=u.searchParams.get('code');if(!code||u.searchParams.has('error'))return redirect('cancelled');
   const cfg=await rpc('google_config');
   const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client_id,client_secret:cfg.client_secret,code,redirect_uri:callback,grant_type:'authorization_code'}),signal:AbortSignal.timeout(10000)});
   if(!r.ok)return redirect('failed');const tokens=await r.json();if(!scopes.every(s=>String(tokens.scope||'').split(' ').includes(s)))return redirect('scope');
   await rpc('google_store',{p_owner:owner,p_tokens:tokens});
   await sync(owner,tokens.access_token);return redirect('connected');
  }catch{return redirect('failed');}
 }
 if(req.method!=='POST'||!u.pathname.endsWith('/sync'))return new Response('Not found',{status:404});
 try{
 const cfg=await rpc('google_config');
 if(!cfg.cron_secret||req.headers.get('X-Calendar-Job')!==cfg.cron_secret)return new Response('Unauthorized',{status:401});if(!cfg.client_id||!cfg.client_secret)return Response.json({configured:false});
 const deadline=Date.now()+40000;
 const connections=await rpc('google_worker_context');let processed=0;
 for(const c of connections){
  if(Date.now()>deadline)break;
  let token=c.tokens.access_token;
  try{
   if(Date.parse(c.expires_at)<Date.now()+120000){
    const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:cfg.client_id,client_secret:cfg.client_secret,refresh_token:c.tokens.refresh_token,grant_type:'refresh_token'}),signal:AbortSignal.timeout(10000)});
    if(!r.ok){await rpc('google_worker_error',{p_owner:c.owner_id,p_revoked:r.status===400||r.status===401});continue;}
    const t=await r.json();await rpc('google_store',{p_owner:c.owner_id,p_tokens:t,p_refresh:true});token=t.access_token;
   }
   await sync(c.owner_id,token);
   for(const j of await rpc('google_jobs',{p_owner:c.owner_id})){
    if(Date.now()>deadline)break;
    try{
     const id=eventId(j.booking_id);const path='calendars/primary/events/'+id;
     if(j.booking_status!=='confirmed'){
      const d=await google(path,token,'DELETE');if(!d.ok&&d.status!==404&&d.status!==410)throw Error('Delete delayed');
      await rpc('google_job_result_v2',{p_booking:j.booking_id,p_revision:j.revision,p_url:null,p_event:id,p_cancelled:true});continue;
     }
     let r=await google(path,token);if(r.status===404)r=await google('calendars/primary/events?conferenceDataVersion=1',token,'POST',eventBody(j));
     if(r.status===409)r=await google(path,token);if(!r.ok)throw Error('Meeting delayed');
     let event=await r.json();if(event.start?.dateTime && (Date.parse(event.start.dateTime)!==Date.parse(j.starts_at)||Date.parse(event.end?.dateTime)!==Date.parse(j.ends_at))){const body=eventBody(j);const updated=await google(path,token,'PATCH',{start:body.start,end:body.end,summary:body.summary});if(!updated.ok)throw Error('Update delayed');event=await updated.json();}const url=meetingUrl(event);if(!url)throw Error('Meeting not ready');
     await rpc('google_job_result_v2',{p_booking:j.booking_id,p_revision:j.revision,p_url:url,p_event:id,p_cancelled:false});
    }catch{await rpc('google_job_delay',{p_booking:j.booking_id});}
   }
   processed++;
  }catch{await rpc('google_worker_error',{p_owner:c.owner_id,p_revoked:false});}
 }
 return Response.json({processed});
 }catch{return new Response('Calendar sync unavailable',{status:503});}
});
