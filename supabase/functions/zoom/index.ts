import { createClient } from 'npm:@supabase/supabase-js@2';
const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const callback='https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/zoom/callback';
const origin='https://briefbooth.com';
async function rpc(name:string,args:Record<string,unknown>={}) {
 const {data,error}=await db.rpc(name,args); if(error) throw new Error('Zoom setup could not be saved.'); return data;
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 const redirect=(result:string)=>new Response(null,{status:303,headers:{Location:origin+'/studio/?zoom='+result,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 if(req.method!=='GET'||!url.pathname.endsWith('/callback')) return new Response('Not found',{status:404});
 try {
 const state=url.searchParams.get('state')||'';
 if(!/^[0-9a-f-]{36}$/i.test(state)) return redirect('expired');
 const context=await rpc('zoom_consume_context',{p_state:state});
 if(!context) return redirect('expired');
 const code=url.searchParams.get('code');
 if(!code||url.searchParams.has('error')) return redirect('cancelled');
 const config=await rpc('zoom_environment_config',{p_environment:context.environment});
 const res=await fetch('https://zoom.us/oauth/token',{method:'POST',headers:{Authorization:'Basic '+btoa(config.client_id+':'+config.client_secret),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:callback}),signal:AbortSignal.timeout(10000)});
 if(!res.ok) return redirect('failed');
 const tokens=await res.json();
 if(!String(tokens.scope||'').split(' ').includes('meeting:write:meeting')) return redirect('scope');
 await rpc('zoom_store_connection',{p_owner:context.owner_id,p_tokens:tokens,p_environment:context.environment});
 return redirect('connected');
 } catch {return redirect('failed');}
});
