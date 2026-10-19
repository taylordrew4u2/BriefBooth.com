import { defaultQuestions, type IntakeQuestion } from "./intake";
import type { Database } from "./database.types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
let instance: SupabaseClient<Database> | null = null;
export function db() {
  if (!configured)
    throw new Error(
      "Live booking is not connected yet. Follow the setup guide to connect Supabase.",
    );
  return (instance ??= createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ));
}
export type Profile = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  bio: string;
  timezone: string;
  meeting_url: string;
  in_person_address: string;
  published: boolean;
  intake_questions: IntakeQuestion[];
  payment_methods: string[];
  payment_notes: string;
};
export type Service = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  duration: number;
  active: boolean;
  meeting_modes: string[];
  amount_cents: number;
};
export const demoProfile: Profile = {
  id: "demo",
  slug: "demo",
  name: "Alex Morgan",
  headline: "Business & growth consultant",
  bio: "A little clarity goes a long way. Let’s talk through your next move and turn a big question into a practical plan.",
  timezone: "America/New_York",
  meeting_url: "",
  in_person_address: "",
  published: true,
  intake_questions: defaultQuestions,
  payment_methods: ["Cash App", "Venmo"],
  payment_notes: "We’ll agree on any consultation fee together before we meet.",
};
export const demoServices: Service[] = [
  {
    id: "intro",
    owner_id: "demo",
    title: "Discovery call",
    description:
      "A quick conversation to connect, explore your goals, and see how I can help.",
    duration: 15,
    active: true,
    amount_cents: 0,
    meeting_modes: ["zoom", "in_person"],
  },
  {
    id: "strategy",
    owner_id: "demo",
    title: "Strategy session",
    description:
      "Dedicated time to work through a challenge and map out your next steps.",
    duration: 60,
    active: true,
    amount_cents: 0,
    meeting_modes: ["zoom", "in_person"],
  },
];
