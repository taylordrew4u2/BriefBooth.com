"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
export function ZoomConnection() {
 const [connected,setConnected]=useState(false);
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 useEffect(()=>{let active=true; db().rpc("zoom_status").then(({data})=>{if(active)setConnected(Boolean((data as {connected?:boolean}|null)?.connected));}); return ()=>{active=false;};},[]);
 async function connect(){
 setBusy(true);setMessage("");
 try {const {data,error}=await db().rpc("zoom_begin");if(error||!data)throw new Error(error?.message||"Zoom is not ready yet.");
 const url=new URL(data);if(url.origin!=="https://zoom.us")throw new Error("Invalid Zoom connection address.");window.location.assign(url.href);
 }catch(e){setMessage(e instanceof Error?e.message:"Unable to connect Zoom.");setBusy(false);}
 }
 return <section className="inset-form" aria-label="Zoom connection"><h3>Automatic Zoom links</h3><p>{connected?"Zoom is connected. Each new Zoom booking gets its own meeting link, emailed to you and your client.":"Connect your Zoom account to create a meeting automatically when someone books. Your Zoom plan’s limits still apply."}</p><Button type="button" onClick={connect} disabled={busy}>{busy?"Opening Zoom…":connected?"Reconnect Zoom":"Connect Zoom"}</Button>{message&&<p role="status">{message}</p>}<p className="helper">Cancelling a booking stops its confirmation emails. If its Zoom meeting was already created, remove it from Zoom yourself.</p></section>;
}
