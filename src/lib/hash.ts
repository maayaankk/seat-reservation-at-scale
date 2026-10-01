export function canonicalizeSeats(seats: string[]): string[] {
  return [...new Set(seats)].sort();
}

export async function canonicalSeatsHash(seats: string[]): Promise<string> {
  const canonical = canonicalizeSeats(seats);
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonical)))
    .then((buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join(''));
}