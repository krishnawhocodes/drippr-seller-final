/**
 * Office Hours Utilities (Backend/TypeScript for Vercel)
 * Office hours: 10 AM - 5 PM daily
 */

const OFFICE_START_HOUR = 10; // 10 AM
const OFFICE_END_HOUR = 20; // 8 PM (20:00)

/**
 * Check if a given timestamp is within office hours
 */
export function isWithinOfficeHours(timestamp: number): boolean {
  const date = new Date(timestamp);
  const hours = date.getHours();
  return hours >= OFFICE_START_HOUR && hours < OFFICE_END_HOUR;
}

/**
 * Get the next office opening time from a given timestamp
 * If already in office hours, returns the timestamp itself
 * If outside office hours, returns next 10 AM
 */
export function getNextOfficeOpen(timestamp: number): number {
  const date = new Date(timestamp);
  const hours = date.getHours();

  // If already within office hours, return as-is
  if (hours >= OFFICE_START_HOUR && hours < OFFICE_END_HOUR) {
    return timestamp;
  }

  // If before office hours today (before 10 AM), return today at 10 AM
  if (hours < OFFICE_START_HOUR) {
    const nextOpen = new Date(date);
    nextOpen.setHours(OFFICE_START_HOUR, 0, 0, 0);
    return nextOpen.getTime();
  }

  // If after office hours (>= 5 PM), return tomorrow at 10 AM
  const nextOpen = new Date(date);
  nextOpen.setDate(nextOpen.getDate() + 1);
  nextOpen.setHours(OFFICE_START_HOUR, 0, 0, 0);
  return nextOpen.getTime();
}

/**
 * Calculate the deadline by adding business hours to a start time
 * This accounts for office hours and skips non-business time
 * 
 * @param startTime - The starting timestamp
 * @param durationMs - Duration in milliseconds to add (e.g., 3 hours = 3 * 60 * 60 * 1000)
 * @returns The deadline timestamp
 */
export function addBusinessHours(startTime: number, durationMs: number): number {
  // If order comes outside office hours, start from next office open
  let effectiveStart = isWithinOfficeHours(startTime) 
    ? startTime 
    : getNextOfficeOpen(startTime);

  let remaining = durationMs;
  let current = effectiveStart;

  while (remaining > 0) {
    const currentDate = new Date(current);
    const currentHour = currentDate.getHours();

    // If we're outside office hours, jump to next office open
    if (currentHour < OFFICE_START_HOUR || currentHour >= OFFICE_END_HOUR) {
      current = getNextOfficeOpen(current);
      continue;
    }

    // Calculate time until office close
    const officeCloseToday = new Date(currentDate);
    officeCloseToday.setHours(OFFICE_END_HOUR, 0, 0, 0);
    const timeUntilClose = officeCloseToday.getTime() - current;

    if (remaining <= timeUntilClose) {
      // We can finish within today's office hours
      return current + remaining;
    } else {
      // Need to continue tomorrow
      remaining -= timeUntilClose;
      current = getNextOfficeOpen(officeCloseToday.getTime());
    }
  }

  return current;
}

/**
 * Calculate remaining business hours between now and a deadline
 * Returns only the time that falls within office hours
 * 
 * @param deadline - The target deadline timestamp
 * @param now - Current timestamp
 * @returns Remaining milliseconds within business hours (can be negative if overdue)
 */
export function getRemainingBusinessTime(deadline: number, now: number): number {
  // If deadline is in the past, return negative difference
  if (deadline <= now) {
    return deadline - now; // negative value
  }

  let remaining = 0;
  let current = now;

  while (current < deadline) {
    const currentDate = new Date(current);
    const currentHour = currentDate.getHours();

    // If current time is outside office hours, jump to next office open
    if (currentHour < OFFICE_START_HOUR || currentHour >= OFFICE_END_HOUR) {
      const nextOpen = getNextOfficeOpen(current);
      if (nextOpen >= deadline) {
        // Deadline is before next office opening, so no time remaining
        break;
      }
      current = nextOpen;
      continue;
    }

    // We're in office hours, calculate time until office close or deadline
    const officeCloseToday = new Date(currentDate);
    officeCloseToday.setHours(OFFICE_END_HOUR, 0, 0, 0);
    const closeTime = officeCloseToday.getTime();

    const nextBoundary = Math.min(closeTime, deadline);
    const segment = nextBoundary - current;
    
    remaining += segment;
    current = nextBoundary;

    // If we haven't reached deadline, we hit office close, so jump to next day
    if (current < deadline && current >= closeTime) {
      current = getNextOfficeOpen(current);
    }
  }

  return remaining;
}

export const OFFICE_HOURS = {
  START_HOUR: OFFICE_START_HOUR,
  END_HOUR: OFFICE_END_HOUR,
};
