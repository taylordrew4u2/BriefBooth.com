import Manage from "@/components/manage-client";
export function generateStaticParams() { return [{ token: "preview" }]; }
export default function Page() { return <Manage />; }
