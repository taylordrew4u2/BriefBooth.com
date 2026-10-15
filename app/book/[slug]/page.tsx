import Booking from "@/components/booking-client";
export function generateStaticParams() { return [{ slug: "demo" }]; }
export default function Page() { return <Booking />; }
