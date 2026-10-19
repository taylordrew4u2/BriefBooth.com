import { handleWebhook } from './webhook.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2';
const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
const callback='https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/zoom/callback';
const origin='https://briefbooth.com';
async function rpc(name:string,args:Record<string,unknown>={}) {
 const {data,error}=await db.rpc(name,args); if(error) throw new Error('Zoom setup could not be saved.'); return data;
}
Deno.serve(async req=>{
 const url=new URL(req.url);
 if(req.method==='POST'&&url.pathname.endsWith('/deauthorize')){
  try {
   const cfg=await rpc('zoom_config');
   return await handleWebhook(req,{client_id:cfg.prod_client_id,webhook_secret:cfg.prod_webhook_secret},
    (userId:string,at:string)=>rpc('zoom_revoke_identity',{p_zoom_user_id:userId,p_revoked_at:at}));
  }catch{return new Response('Please retry',{status:503});}
 }
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
 let userId=null;
 if(context.environment==='production'){
  if(!String(tokens.scope||'').split(' ').includes('user:read:user'))return redirect('scope');
  const identity=await fetch('https://api.zoom.us/v2/users/me',{headers:{Authorization:'Bearer '+tokens.access_token},signal:AbortSignal.timeout(10000)});
  if(!identity.ok)return redirect('failed');
  const user=await identity.json();
  if(typeof user.id!=='string'||!user.id||user.id.length>128)return redirect('failed');
  userId=user.id;
 }
 await rpc('zoom_store_identity',{p_owner:context.owner_id,p_tokens:tokens,p_environment:context.environment,p_zoom_user_id:userId});
 return redirect('connected');
 } catch {return redirect('failed');}
});
