/* eslint-disable @next/next/no-img-element -- Small embedded avatars need no image service. */
export function ProfileAvatar({ name, image }: { name: string; image?: string }) {
  return <div className="avatar large">{image ? <img src={image} alt={`${name || "Consultant"} profile`} width={80} height={80} style={{width:"100%",height:"100%",objectFit:"contain",borderRadius:"inherit",background:"white"}} /> : name.split(" ").map(n=>n[0]).slice(0,2).join("")}</div>;
}
