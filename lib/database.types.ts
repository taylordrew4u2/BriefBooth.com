import type { IntakeQuestion } from "./intake";
// Schema contract; regenerate with Supabase CLI after changing the migration.
type ProfileRow = {
  id: string;
  slug: string;
  name: string;
  avatar_data: string;
  headline: string;
  bio: string;
  timezone: string;
  published: boolean;
  booking_mode: "instant" | "approval";
  intake_questions: IntakeQuestion[];
  payment_methods: string[];
  payment_notes: string;
};
type ServiceRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  duration: number;
  active: boolean;
  meeting_modes: string[];
  amount_cents: number;
};
type HoursRow = {
  id: string;
  owner_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};
type BookingRow = {
  id: string;
  owner_id: string;
  service_id: string;
  client_name: string;
  client_email: string;
  notes: string;
  starts_at: string;
  ends_at: string;
  status: string;
  meeting_mode: string;
  manage_token: string;
  created_at: string;
  title_snapshot: string;
  outcome: string|null;
  consultant_notes: string;
};
type Table<Row, Insert = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Partial<Row>;
  Relationships: [];
};
export type Database = {
  public: {
    Tables: {
      schedule_preferences: Table<{owner_id:string;notice_hours:number;horizon_days:number;buffer_minutes:number;reminders:boolean}>;
      schedule_overrides: Table<{owner_id:string;day:string;enabled:boolean;start_time:string;end_time:string}>;
      profiles: Table<ProfileRow>;
      services: Table<ServiceRow>;
      availability: Table<HoursRow>;
      bookings: Table<BookingRow>;
      consultant_settings: Table<{
        owner_id: string;
        meeting_url: string;
        in_person_address: string;
      }>;
    };
    Views: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
    Functions: {
      account_role: { Args: Record<string, never>; Returns: "client" | "consultant" | null };
      client_intake: { Args: { p_booking: string }; Returns: { questions: IntakeQuestion[] | null; answers: Record<string,string> | null; notes: string; revision: number } };
      client_update_intake: { Args: { p_booking: string; p_revision: number; p_answers: Record<string,string>; p_notes: string }; Returns: undefined };
      client_bookings: { Args: Record<string, never>; Returns: { id: string; title: string; consultant: string; starts_at: string; status: string; manage_token: string }[] };
      record_booking_outcome: {Args:{p_booking:string;p_outcome:string|null;p_notes:string};Returns:undefined};
      booking_health: {Args:{p_booking:string};Returns:unknown};
      retry_booking_delivery: {Args:{p_booking:string};Returns:undefined};
      request_account_removal:{Args:Record<string,never>;Returns:undefined};
      export_my_data:{Args:Record<string,never>;Returns:unknown};
      my_insights:{Args:Record<string,never>;Returns:unknown};
      record_funnel:{Args:{p_owner:string;p_visit:string;p_stage:string};Returns:undefined};
      reschedule_slots:{Args:{p_token:string;p_day:string};Returns:{starts_at:string}[]};
      reschedule_booking:{Args:{p_token:string;p_start:string;p_expected:string};Returns:undefined};
      zoom_cleanup_items:{Args:{p_booking:string};Returns:unknown};
      calendar_feed_link:{Args:{p_reset:boolean;p_disable:boolean};Returns:string|null};
      delete_my_account:{Args:{p_confirmation:string};Returns:undefined};
      review_booking: {Args: {p_booking: string;p_approve: boolean};Returns: string};
      google_status: {Args: Record<string, never>; Returns: {configured:boolean;connected:boolean;synced_at:string|null;error:string|null}};
      google_begin: {Args: Record<string, never>; Returns:string};
      google_disconnect: {Args: Record<string, never>; Returns:undefined};
      zoom_status: { Args: Record<string, never>; Returns: { connected: boolean } };
      zoom_begin: { Args: Record<string, never>; Returns: string };
      available_slots: {
        Args: { p_service: string; p_day: string };
        Returns: { starts_at: string }[];
      };
      book_consultation: {
        Args: {
          p_service: string;
          p_start: string;
          p_name: string;
          p_email: string;
          p_answers: Record<string, string>;
          p_request: string;
          p_meeting_mode?: string;
        };
        Returns: string;
      };
      booking_details: {
        Args: { p_token: string };
        Returns: {
          client_name: string;
          title: string;
          consultant: string;
          starts_at: string;
          ends_at: string;
          status: string;
          meeting_mode: string;
          meeting_url: string;
          in_person_address: string;
        }[];
      };
      cancel_booking: { Args: { p_token: string }; Returns: boolean };
      save_availability: {
        Args: {
          p_hours: { weekday: number; start_time: string; end_time: string }[];
        };
        Returns: undefined;
      };
    };
  };
};
