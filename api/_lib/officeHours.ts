// api/_lib/officeHours.ts
// Business-hours maths for the order workflow, server side.
//
// IMPORTANT: Vercel functions run in UTC while the business runs on IST, so
// this module never uses the host clock's local time. Every hour-of-day
// decision is made after shifting into IST explicitly. The browser copy in
// src/lib/officeHours.ts can rely on local time because it runs on the user's
// machine; this one cannot.

/** Office opens at 09:00 IST. */
export const OFFICE_START_HOUR = 9;
/** Office closes at 21:00 IST. */
export const OFFICE_END_HOUR = 21;

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type IstParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
};

function toIst(timestamp: number): IstParts {
  const shifted = new Date(timestamp + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    ms: shifted.getUTCMilliseconds(),
  };
}

/** Builds an epoch timestamp from an IST wall-clock time. */
function fromIst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
): number {
  return Date.UTC(year, month, day, hour, minute, second) - IST_OFFSET_MS;
}

export function isWithinOfficeHours(timestamp: number): boolean {
  const { hour } = toIst(timestamp);
  return hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR;
}

/**
 * The next moment the office is open. Returns the timestamp unchanged when it
 * already falls inside office hours.
 */
export function getNextOfficeOpen(timestamp: number): number {
  const { year, month, day, hour } = toIst(timestamp);
  if (hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR) return timestamp;
  if (hour < OFFICE_START_HOUR) {
    return fromIst(year, month, day, OFFICE_START_HOUR);
  }
  // After close: tomorrow morning. Re-reading the parts of tomorrow's
  // timestamp keeps month and year rollovers correct.
  const tomorrow = toIst(timestamp + DAY_MS);
  return fromIst(tomorrow.year, tomorrow.month, tomorrow.day, OFFICE_START_HOUR);
}

/** End of the office day that `timestamp` falls in, in IST. */
function officeCloseOn(timestamp: number): number {
  const { year, month, day } = toIst(timestamp);
  return fromIst(year, month, day, OFFICE_END_HOUR);
}

/**
 * Adds a duration that only elapses during office hours.
 *
 * An order placed at 20:00 with a 3 hour window is therefore due at 10:00 the
 * next morning, not at 23:00 the same night.
 */
export function addBusinessHours(startTime: number, durationMs: number): number {
  let remaining = Math.max(0, Number(durationMs) || 0);
  let current = isWithinOfficeHours(startTime)
    ? startTime
    : getNextOfficeOpen(startTime);

  // Each pass consumes at most one office day, so this terminates.
  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    const closeAt = officeCloseOn(current);
    const availableToday = closeAt - current;
    if (remaining <= availableToday) return current + remaining;
    remaining -= availableToday;
    current = getNextOfficeOpen(closeAt);
  }
  return current;
}

/**
 * Office-hours time left until `deadline`. Negative (the raw difference) when
 * the deadline has already passed, so callers can tell overdue from "paused".
 */
export function getRemainingBusinessTime(
  deadline: number,
  now: number,
): number {
  if (deadline <= now) return deadline - now;

  let remaining = 0;
  let current = now;

  for (let guard = 0; guard < 400 && current < deadline; guard += 1) {
    if (!isWithinOfficeHours(current)) {
      const nextOpen = getNextOfficeOpen(current);
      if (nextOpen >= deadline) break;
      current = nextOpen;
      continue;
    }
    const boundary = Math.min(officeCloseOn(current), deadline);
    remaining += boundary - current;
    current = boundary;
    if (current < deadline) current = getNextOfficeOpen(current);
  }

  return remaining;
}

/** Vendors get this much office time to accept an order. */
export const VENDOR_ACCEPT_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * The single source of truth for an order's acceptance deadline.
 *
 * Older orders stored a raw `createdAt + 3h`, which could fall in the middle
 * of the night; those are honoured as-is so a deadline never moves under a
 * seller who has already seen it. New orders get a business-hours deadline.
 */
export function vendorAcceptDeadline(order: {
  createdAt?: number;
  vendorAcceptBy?: number | null;
}): number {
  const stored = Number(order?.vendorAcceptBy);
  if (Number.isFinite(stored) && stored > 0) return stored;
  const createdAt = Number(order?.createdAt) || Date.now();
  return addBusinessHours(createdAt, VENDOR_ACCEPT_WINDOW_MS);
}
