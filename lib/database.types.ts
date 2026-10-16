import type { IntakeQuestion } from "./intake";
// Schema contract; regenerate with Supabase CLI after changing the migration.
type ProfileRow = {
  id: string;
  slug: string;
  name: string;
  headline: string;
  bio: string;
  timezone: string;
  published: boolean;
  intake_questions: IntakeQuestion[];
};
type ServiceRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  duration: number;
  active: boolean;
  meeting_modes: string[];
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
