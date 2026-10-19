// Public Zoom callbacks use the verified BriefBooth domain. No secrets live here.
const upstream='https://kjjfpacypvdfdktkssst.supabase.co/functions/v1/zoom';
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  const allowed=(url.pathname==='/api/zoom/callback'&&request.method==='GET')||(url.pathname==='/api/zoom/deauthorize'&&request.method==='POST');
  if(!allowed)return new Response('Not found',{status:404});
  if(Number(request.headers.get('content-length')||0)>16384)return new Response('Too large',{status:413});
  const target=upstream+url.pathname.slice('/api/zoom'.length)+url.search;
  const headers=new Headers();
  for(const key of ['content-type','x-zm-request-timestamp','x-zm-signature']){const value=request.headers.get(key);if(value)headers.set(key,value);}
  try{
   const body=request.method==='POST'?await request.arrayBuffer():undefined;
   if(body&&body.byteLength>16384)return new Response('Too large',{status:413});
   const result=await fetch(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(15000)});
   const out=new Headers(result.headers);out.set('Cache-Control','no-store');out.set('Referrer-Policy','no-referrer');
   return new Response(result.body,{status:result.status,headers:out});
  }catch{return new Response('Temporarily unavailable',{status:503});}
 }
};
