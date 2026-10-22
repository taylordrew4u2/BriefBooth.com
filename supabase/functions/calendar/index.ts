import {createClient} from 'npm:@supabase/supabase-js@2';
import {calendarFeed} from './format.mjs';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async req=>{
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex'};
 if(req.method!=='GET')return new Response('Not found',{status:404,headers});
 const token=new URL(req.url).pathname.split('/').pop()?.replace(/\.ics$/,'');
 if(!token||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))return new Response('Not found',{status:404,headers});
 const {data,error}=await db.rpc('calendar_feed_events',{p_token:token});
 if(error)return new Response('Calendar temporarily unavailable',{status:503,headers});
 if(!data)return new Response('Not found',{status:404,headers});
 return new Response(calendarFeed(data.events),{headers:{...headers,'Content-Type':'text/calendar; charset=utf-8'}});
});
