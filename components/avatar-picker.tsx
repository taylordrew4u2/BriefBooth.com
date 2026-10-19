"use client";
import { useState } from "react";
import { ProfileAvatar } from "./profile-avatar";
import { Button } from "./ui/button";
export function AvatarPicker({name,value,onChange}:{name:string;value:string;onChange:(value:string)=>void}) {
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  async function choose(file?:File) {
    if(!file)return;
    setMessage("");
    if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>100*1024){setMessage("Choose a PNG, JPG, or WebP image no larger than 100 KB.");return;}
    setBusy(true);
    let bitmap:ImageBitmap|undefined;
    try {
      bitmap=await createImageBitmap(file);
      if(bitmap.width>4096||bitmap.height>4096)throw new Error("Please choose an image smaller than 4096 × 4096 pixels.");
      const scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
      const context=canvas.getContext("2d");if(!context)throw new Error("Your browser could not prepare this image.");
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      let data=canvas.toDataURL("image/webp",0.8);
      if(!data.startsWith("data:image/webp;base64,"))throw new Error("Please use a browser that supports WebP images.");
      if(data.length>43715)data=canvas.toDataURL("image/webp",0.5);
      if(data.length>43715)throw new Error("This image is too detailed. Try a simpler or smaller image.");
      onChange(data);setMessage("Image ready. Save your profile to publish it.");
    }catch(error){setMessage(error instanceof Error?error.message:"Unable to read this image.");}
    finally{bitmap?.close();setBusy(false);}
  }
  return <section className="inset-form" aria-label="Profile image"><h3>Your photo or logo</h3><ProfileAvatar name={name} image={value}/><label>Choose a small image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{void choose(e.target.files?.[0]);e.target.value="";}} /></label><p className="helper">PNG, JPG, or WebP · maximum 100 KB. We resize to 256 pixels and store at most 32 KB. Your image is public on your booking page.</p>{value&&<Button type="button" variant="outline" disabled={busy} onClick={()=>{onChange("");setMessage("Image removed from draft. Save your profile to apply.");}}>Remove image</Button>}{message&&<p role="status">{message}</p>}</section>;
}
