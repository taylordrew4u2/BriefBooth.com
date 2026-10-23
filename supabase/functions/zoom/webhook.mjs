const encoder = new TextEncoder();
export async function hmac(secret, message) {
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)))].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
export async function handleWebhook(req, config, revoke, now=Date.now()) {
 if(!config.webhook_secret||!config.client_id)return new Response('Not configured',{status:503});
 const raw=await req.text();
 if(encoder.encode(raw).length>16384)return new Response('Too large',{status:413});
 const timestamp=req.headers.get('x-zm-request-timestamp')||'';
 const signature=req.headers.get('x-zm-signature')||'';
 if(!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return new Response('Unauthorized',{status:401});
 const expected='v0='+await hmac(config.webhook_secret,`v0:${timestamp}:${raw}`);
 if(!equal(signature,expected))return new Response('Unauthorized',{status:401});
 let body;try{body=JSON.parse(raw);}catch{return new Response('Invalid request',{status:400});}
 const payload=body?.payload;
 if(body?.event==='endpoint.url_validation'){
  if(typeof payload?.plainToken!=='string'||payload.plainToken.length>512)return new Response('Invalid challenge',{status:400});
  return Response.json({plainToken:payload.plainToken,encryptedToken:await hmac(config.webhook_secret,payload.plainToken)});
 }
 if(body?.event!=='app_deauthorized')return new Response(null,{status:204});
 if(payload?.client_id!==config.client_id||typeof payload.user_id!=='string'||!payload.user_id||payload.user_id.length>128)return new Response('Invalid identity',{status:400});
 const at=Date.parse(payload.deauthorization_time);
 if(!Number.isFinite(at)||at>now+300000)return new Response('Invalid time',{status:400});
 try{await revoke(payload.user_id,new Date(at).toISOString());}catch{return new Response('Please retry',{status:503});}
 return new Response(null,{status:204});
}
