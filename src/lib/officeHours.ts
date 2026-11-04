// src/lib/officeHours.ts
// Browser mirror of api/_lib/officeHours.ts.
//
// Both sides pin the business day to IST rather than the device clock. If this
// used the browser's local time, a seller on a laptop set to another timezone
// would see a countdown that disagreed with the server, and could be told an
// order is still acceptable when the API has already expired it.
//
// Office hours: 9 AM - 9 PM IST.

export const OFFICE_START_HOUR = 9;
export const OFFICE_END_HOUR = 21;

/** Human wording for the same window, so copy cannot drift from the logic. */
const hour12 = (h: number) => {
  const suffix = h >= 12 ? "PM" : "AM";
  const base = h % 12 === 0 ? 12 : h % 12;
  return base + " " + suffix;
};
export const OFFICE_HOURS_LABEL =
  hour12(OFFICE_START_HOUR) + " to " + hour12(OFFICE_END_HOUR) + " IST";

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function toIst(timestamp: number) {
  const shifted = new Date(timestamp + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function fromIst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
) {
  return Date.UTC(year, month, day, hour, minute) - IST_OFFSET_MS;
}

export function isWithinOfficeHours(timestamp: number): boolean {
  const { hour } = toIst(timestamp);
  return hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR;
}

export function getNextOfficeOpen(timestamp: number): number {
  const { year, month, day, hour } = toIst(timestamp);
  if (hour >= OFFICE_START_HOUR && hour < OFFICE_END_HOUR) return timestamp;
  if (hour < OFFICE_START_HOUR) {
    return fromIst(year, month, day, OFFICE_START_HOUR);
  }
  const tomorrow = toIst(timestamp + DAY_MS);
  return fromIst(tomorrow.year, tomorrow.month, tomorrow.day, OFFICE_START_HOUR);
}

function officeCloseOn(timestamp: number): number {
  const { year, month, day } = toIst(timestamp);
  return fromIst(year, month, day, OFFICE_END_HOUR);
}

/** Adds a duration that only elapses during office hours. */
export function addBusinessHours(
  startTime: number,
  durationMs: number,
): number {
  let remaining = Math.max(0, Number(durationMs) || 0);
  let current = isWithinOfficeHours(startTime)
    ? startTime
    : getNextOfficeOpen(startTime);

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
 * the deadline has already passed, so callers can tell overdue from paused.
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

/** hh:mm:ss of office time left, or "Overdue". */
export function formatBusinessHoursCountdown(
  deadline: number,
  now: number,
): string {
  const remaining = getRemainingBusinessTime(deadline, now);
  if (remaining <= 0) return "Overdue";

  const seconds = Math.floor(remaining / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(
    Math.floor((seconds % 3600) / 60),
  )}:${pad(seconds % 60)}`;
}

export function isCurrentlyOfficeHours(): boolean {
  return isWithinOfficeHours(Date.now());
}

/** Always rendered in IST so every seller sees the same opening time. */
export function getOfficeStatusMessage(): string {
  const now = Date.now();
  if (isWithinOfficeHours(now)) return "Office is open";

  const nextOpen = new Date(getNextOfficeOpen(now));
  const time = nextOpen.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = nextOpen.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
  });
  return `Office opens at ${time} IST on ${date}`;
}
