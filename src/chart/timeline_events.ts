/**
 * Historical events shown on the time axis of the timeline hourglass chart.
 *
 * The events are loaded at runtime from a JSON file served next to the app
 * (timeline-events.json by default), so they can be configured on the server
 * without rebuilding the app. The URL of the file can be changed with the
 * TIMELINE_EVENTS_URL environment variable of the Docker image (injected into
 * a meta tag by Caddy) or with VITE_TIMELINE_EVENTS_URL at build time.
 *
 * File format: an array of events, e.g.
 *   [
 *     {"label": "I. világháború", "from": "1914-07-28", "to": "1918-11-11"},
 *     {"label": "Kiegyezés", "from": 1867, "color": "#2e7d32"}
 *   ]
 * "from" and "to" are years (1914) or dates ("1914", "1914-07", "1914-07-28").
 * Without "to", the event lasts until the end of the given year, month or day.
 */

export interface TimelineEvent {
  label: string;
  /** Start as a fractional year. */
  from: number;
  /** End as a fractional year. */
  to: number;
  color?: string;
}

export const DEFAULT_TIMELINE_EVENTS_URL = 'timeline-events.json';
const META_TAG_NAME = 'topola-timeline-events-url';

/**
 * Parses a year or a date to a fractional year: its start, or its end if
 * `end` is true (the end of 1914 is 1915.0).
 */
export function parseEventDate(value: unknown, end: boolean): number | null {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string') {
    return null;
  }
  const match = /^(-?\d{1,4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(text.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = match[2] !== undefined ? Number(match[2]) : undefined;
  const day = match[3] !== undefined ? Number(match[3]) : undefined;
  if (
    (month !== undefined && (month < 1 || month > 12)) ||
    (day !== undefined && (day < 1 || day > 31))
  ) {
    return null;
  }
  if (month === undefined) {
    return year + (end ? 1 : 0);
  }
  const monthStart = year + (month - 1) / 12;
  if (day === undefined) {
    return monthStart + (end ? 1 / 12 : 0);
  }
  return monthStart + (day - 1 + (end ? 1 : 0)) / 31 / 12;
}

/** Accepts only plain color values: #rgb, #rrggbb(aa), or a color name. */
function parseColor(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(value.trim())
    ? value.trim()
    : undefined;
}

/** Validates the contents of the events file. Invalid entries are skipped. */
export function parseTimelineEvents(json: unknown): TimelineEvent[] {
  if (!Array.isArray(json)) {
    return [];
  }
  const events: TimelineEvent[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const entry = item as Record<string, unknown>;
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const from = parseEventDate(entry.from, false);
    const to = parseEventDate(entry.to ?? entry.from, true);
    if (!label || from === null || to === null || to < from) {
      continue;
    }
    events.push({label, from, to, color: parseColor(entry.color)});
  }
  return events;
}

/** URL of the events file: from the build, the server, or the default. */
export function getTimelineEventsUrl(): string {
  const envUrl = import.meta.env.VITE_TIMELINE_EVENTS_URL;
  if (envUrl) {
    return envUrl;
  }
  const metaUrl = document
    .querySelector(`meta[name="${META_TAG_NAME}"]`)
    ?.getAttribute('content');
  // Ignore an empty value and the raw template expression (when the page is
  // not served by Caddy).
  if (metaUrl && !metaUrl.includes('{{')) {
    return metaUrl;
  }
  return DEFAULT_TIMELINE_EVENTS_URL;
}

let events: TimelineEvent[] = [];
let loading: Promise<TimelineEvent[]> | undefined;
let listener: (() => void) | undefined;

/** The events loaded so far (empty until the file is loaded). */
export function getTimelineEvents(): TimelineEvent[] {
  return events;
}

/** Sets the function called when the events have been loaded. */
export function setTimelineEventsListener(callback: (() => void) | undefined) {
  listener = callback;
}

/**
 * Loads the events once. A missing or invalid file means no events, so the
 * chart works without it.
 */
export function loadTimelineEvents(): Promise<TimelineEvent[]> {
  if (!loading) {
    loading = (async () => {
      try {
        const response = await window.fetch(getTimelineEventsUrl(), {
          cache: 'no-cache',
        });
        if (!response.ok) {
          return [];
        }
        events = parseTimelineEvents(await response.json());
        listener?.();
      } catch (e) {
        console.warn('Failed to load timeline events', e);
      }
      return events;
    })();
  }
  return loading;
}
