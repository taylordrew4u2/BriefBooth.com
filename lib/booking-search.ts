type SearchableBooking = { id: string; client_name?: string; client_email?: string };
export function bookingMatchesSearch(booking: SearchableBooking, search: string) {
  const query = search.trim().toLocaleLowerCase();
  return !query || [booking.id, booking.client_name, booking.client_email]
    .some(value => value?.toLocaleLowerCase().includes(query));
}
