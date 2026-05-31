export const STORAGE_KEY = "cupapi:tracker";

export type FeedEntry = {
  id: string;
  occurredAt: string;
  createdAt: string;
};

export type TrackerSettings = {
  babyName: string;
  intervalMinutes: number;
  graceMinutes: number;
};

export type TrackerData = {
  version: 1;
  feeds: FeedEntry[];
  settings: TrackerSettings;
};

export type FeedStatus = "baseline" | "on-time" | "late";
export type DueStatus = "empty" | "upcoming" | "due" | "late";

export type FeedWithStatus = FeedEntry & {
  gapMinutes: number | null;
  status: FeedStatus;
};

export const DEFAULT_DATA: TrackerData = {
  version: 1,
  feeds: [],
  settings: {
    babyName: "",
    intervalMinutes: 120,
    graceMinutes: 15,
  },
};

const minute = 60_000;

function isFeedEntry(value: unknown): value is FeedEntry {
  if (!value || typeof value !== "object") return false;
  const feed = value as FeedEntry;
  return (
    typeof feed.id === "string" &&
    typeof feed.occurredAt === "string" &&
    Number.isFinite(Date.parse(feed.occurredAt)) &&
    typeof feed.createdAt === "string" &&
    Number.isFinite(Date.parse(feed.createdAt))
  );
}

export function readStoredData(value: string | null): TrackerData {
  if (!value) return DEFAULT_DATA;

  try {
    const data = JSON.parse(value) as Partial<TrackerData>;
    if (
      data.version !== 1 ||
      !Array.isArray(data.feeds) ||
      !data.feeds.every(isFeedEntry) ||
      !data.settings ||
      typeof data.settings.babyName !== "string" ||
      !Number.isFinite(data.settings.intervalMinutes) ||
      !Number.isFinite(data.settings.graceMinutes)
    ) {
      return DEFAULT_DATA;
    }

    return {
      version: 1,
      feeds: data.feeds,
      settings: {
        babyName: data.settings.babyName,
        intervalMinutes: data.settings.intervalMinutes,
        graceMinutes: data.settings.graceMinutes,
      },
    };
  } catch {
    return DEFAULT_DATA;
  }
}

export function sortFeeds(feeds: FeedEntry[]) {
  return [...feeds].sort(
    (first, second) =>
      Date.parse(first.occurredAt) - Date.parse(second.occurredAt),
  );
}

export function getFeedStatuses(
  feeds: FeedEntry[],
  settings: TrackerSettings,
): FeedWithStatus[] {
  const sortedFeeds = sortFeeds(feeds);

  return sortedFeeds.map((feed, index) => {
    const previousFeed = sortedFeeds[index - 1];
    if (!previousFeed) {
      return { ...feed, gapMinutes: null, status: "baseline" };
    }

    const gapMinutes =
      (Date.parse(feed.occurredAt) - Date.parse(previousFeed.occurredAt)) /
      minute;
    const latestOnTime =
      Date.parse(previousFeed.occurredAt) +
      (settings.intervalMinutes + settings.graceMinutes) * minute;

    return {
      ...feed,
      gapMinutes,
      status: Date.parse(feed.occurredAt) <= latestOnTime ? "on-time" : "late",
    };
  });
}

export function getNextDueAt(
  feeds: FeedEntry[],
  intervalMinutes: number,
): number | null {
  if (feeds.length === 0) return null;
  const latest = sortFeeds(feeds).at(-1);
  return latest ? Date.parse(latest.occurredAt) + intervalMinutes * minute : null;
}

export function getDueStatus(
  nextDueAt: number | null,
  graceMinutes: number,
  now: number,
): DueStatus {
  if (nextDueAt === null) return "empty";
  if (now > nextDueAt + graceMinutes * minute) return "late";
  if (now >= nextDueAt) return "due";
  return "upcoming";
}
