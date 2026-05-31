"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DATA,
  FeedEntry,
  FeedStatus,
  FeedWithStatus,
  getDueStatus,
  getFeedStatuses,
  getNextDueAt,
  readStoredData,
  STORAGE_KEY,
  TrackerData,
  TrackerSettings,
} from "@/lib/tracker";

type Sheet =
  | { type: "add" }
  | { type: "edit"; feed: FeedEntry }
  | { type: "delete"; feed: FeedEntry }
  | null;

const fullDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const groupDate = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
});

const feedTime = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

const subscribeToHydration = () => () => {};
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

function sameLocalDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function toDateTimeLocal(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function createFeed(occurredAt: string): FeedEntry {
  const createdAt = new Date().toISOString();
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    occurredAt,
    createdAt,
  };
}

function formatGap(minutes: number | null) {
  if (minutes === null) return "First log";
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (hours === 0) return `${remainingMinutes}m gap`;
  if (remainingMinutes === 0) return `${hours}h gap`;
  return `${hours}h ${remainingMinutes}m gap`;
}

function formatAverageGap(minutes: number | null) {
  if (minutes === null) return "—";
  const roundedMinutes = Math.round(minutes);
  const hours = Math.floor(roundedMinutes / 60);
  const remainingMinutes = roundedMinutes % 60;
  if (hours === 0) return `${remainingMinutes}m`;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}m`;
}

function formatCountdown(nextDueAt: number, now: number) {
  const deltaMinutes = Math.ceil(Math.abs(nextDueAt - now) / 60_000);
  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  const label = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return nextDueAt > now ? `in ${label}` : `${label} ago`;
}

function BottleIcon({ large = false }: { large?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={large ? "bottle-icon bottle-icon-large" : "bottle-icon"}
      fill="none"
      viewBox="0 0 32 32"
    >
      <path d="M12 4h8M13 7h6v4l3 4v11a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V15l3-4V7Z" />
      <path d="M10 18h12M14 4V2h4v2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="inline-icon" viewBox="0 0 16 16">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg aria-hidden="true" className="chevron-icon" viewBox="0 0 16 16">
      <path d="m5 6 3 3 3-3" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" className="more-icon" viewBox="0 0 16 4">
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="8" cy="2" r="1.5" />
      <circle cx="14" cy="2" r="1.5" />
    </svg>
  );
}

function StatusDot({ status }: { status: FeedStatus }) {
  return <span aria-hidden="true" className={`timeline-dot ${status}`} />;
}

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

function ClockIcon() {
  return (
    <svg aria-hidden="true" className="clock-icon" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function Clock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(clockFormatter.format(new Date()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-label={time ? `Current time ${time}` : undefined}
      className="header-clock"
      suppressHydrationWarning
    >
      <ClockIcon />
      <span>{time ?? "--:--:--"}</span>
    </div>
  );
}

function SheetFrame({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="sheet-title"
        aria-modal="true"
        className="bottom-sheet"
        role="dialog"
      >
        <div className="sheet-handle" />
        <div className="sheet-heading">
          <h2 id="sheet-title">{title}</h2>
          <button aria-label="Close" className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function FeedFormSheet({
  feed,
  onClose,
  onDelete,
  onSave,
}: {
  feed?: FeedEntry;
  onClose: () => void;
  onDelete?: () => void;
  onSave: (occurredAt: string) => void;
}) {
  const [value, setValue] = useState(
    toDateTimeLocal(feed ? new Date(feed.occurredAt) : new Date()),
  );
  const [error, setError] = useState("");

  return (
    <SheetFrame
      title={feed ? "Edit drinking time" : "Add drinking time"}
      onClose={onClose}
    >
      <form
        className="sheet-form"
        onSubmit={(event) => {
          event.preventDefault();
          const selectedTime = new Date(value);
          if (!Number.isFinite(selectedTime.getTime())) {
            setError("Choose a valid date and time.");
            return;
          }
          if (selectedTime.getTime() > Date.now() + 60_000) {
            setError("Drinking time cannot be in the future.");
            return;
          }
          onSave(selectedTime.toISOString());
        }}
      >
        <label className="field">
          <span>Date and time</span>
          <input
            autoFocus
            max={toDateTimeLocal(new Date())}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            required
            type="datetime-local"
            value={value}
          />
        </label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="sheet-actions">
          {onDelete ? (
            <button
              className="text-button danger"
              onClick={onDelete}
              type="button"
            >
              Delete log
            </button>
          ) : (
            <span />
          )}
          <button className="button button-small" type="submit">
            Save time
          </button>
        </div>
      </form>
    </SheetFrame>
  );
}

function DeleteSheet({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <SheetFrame onClose={onCancel} title="Delete this log?">
      <p className="sheet-copy">
        This changes the schedule and summary. You cannot undo it.
      </p>
      <div className="delete-actions">
        <button className="button button-quiet" onClick={onCancel}>
          Keep log
        </button>
        <button className="button button-danger" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </SheetFrame>
  );
}

function TimelineGroup({
  entries,
  label,
  onEdit,
}: {
  entries: FeedWithStatus[];
  label: string;
  onEdit: (feed: FeedEntry) => void;
}) {
  return (
    <section className="timeline-group">
      <h3>{label}</h3>
      <div className="timeline-list">
        {[...entries].reverse().map((feed) => (
          <article className="timeline-row" key={feed.id}>
            <StatusDot status={feed.status} />
            <div className="timeline-time">
              {feedTime.format(new Date(feed.occurredAt))}
            </div>
            <div className="timeline-detail">
              <span className={`status-text ${feed.status}`}>
                {feed.status === "baseline"
                  ? "Baseline"
                  : feed.status === "late"
                    ? "Late"
                    : "On time"}
              </span>
              <span>{formatGap(feed.gapMinutes)}</span>
            </div>
            <button
              aria-label={`Edit ${feedTime.format(new Date(feed.occurredAt))} log`}
              className="row-action"
              onClick={() => onEdit(feed)}
            >
              <MoreIcon />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export default function Tracker() {
  const [data, setData] = useState<TrackerData>(() =>
    typeof window === "undefined"
      ? DEFAULT_DATA
      : readStoredData(window.localStorage.getItem(STORAGE_KEY)),
  );
  const [draftSettings, setDraftSettings] = useState<TrackerSettings>(
    () => data.settings,
  );
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data, hydrated]);

  useEffect(() => {
    const refreshNow = () => setNow(Date.now());
    const timer = window.setInterval(refreshNow, 30_000);
    document.addEventListener("visibilitychange", refreshNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshNow);
    };
  }, []);

  const feedStatuses = getFeedStatuses(data.feeds, data.settings);
  const nextDueAt = getNextDueAt(data.feeds, data.settings.intervalMinutes);
  const dueStatus = getDueStatus(nextDueAt, data.settings.graceMinutes, now);
  const today = new Date(now);
  const todaysFeeds = feedStatuses.filter((feed) =>
    sameLocalDay(new Date(feed.occurredAt), today),
  );
  const earlierFeeds = feedStatuses.filter(
    (feed) => !sameLocalDay(new Date(feed.occurredAt), today),
  );
  const averageGap = todaysFeeds.reduce(
    (summary, feed) => {
      if (feed.gapMinutes === null) return summary;
      return {
        total: summary.total + feed.gapMinutes,
        count: summary.count + 1,
      };
    },
    { total: 0, count: 0 },
  );

  const earlierGroups = (() => {
    const groups = new Map<string, FeedWithStatus[]>();
    for (const feed of earlierFeeds) {
      const label = groupDate.format(new Date(feed.occurredAt));
      groups.set(label, [...(groups.get(label) ?? []), feed]);
    }
    return [...groups.entries()].reverse();
  })();

  function markNow() {
    const feed = createFeed(new Date().toISOString());
    setData((current) => ({ ...current, feeds: [...current.feeds, feed] }));
    setNow(Date.now());
  }

  function saveManualFeed(occurredAt: string) {
    setData((current) => ({
      ...current,
      feeds: [...current.feeds, createFeed(occurredAt)],
    }));
    setSheet(null);
    setNow(Date.now());
  }

  function updateFeed(feed: FeedEntry, occurredAt: string) {
    setData((current) => ({
      ...current,
      feeds: current.feeds.map((item) =>
        item.id === feed.id ? { ...item, occurredAt } : item,
      ),
    }));
    setSheet(null);
    setNow(Date.now());
  }

  function deleteFeed(feed: FeedEntry) {
    setData((current) => ({
      ...current,
      feeds: current.feeds.filter((item) => item.id !== feed.id),
    }));
    setSheet(null);
    setNow(Date.now());
  }

  if (!hydrated) {
    return (
      <main className="tracker-shell">
        <div className="loading-card" aria-label="Loading tracker" />
      </main>
    );
  }

  const babyName = data.settings.babyName.trim();
  const dueTitle =
    dueStatus === "empty"
      ? "Ready when you are"
      : dueStatus === "late"
        ? "A little past due"
        : dueStatus === "due"
          ? "It is drinking time"
          : "Next drinking time";

  return (
    <main className="tracker-shell">
      <header className="page-header">
        <div className="brand-mark">
          <BottleIcon />
        </div>
        <div>
          <p className="eyebrow">
            {babyName ? `${babyName}'s little log` : "Baby's little log"}
          </p>
          <h1>Drinking tracker</h1>
          <p className="date-label">{fullDate.format(today)}</p>
        </div>
        <Clock />
      </header>

      <section className={`hero-card ${dueStatus}`}>
        <div className="hero-status">
          <span className={`status-pill ${dueStatus}`}>
            {dueStatus === "empty" ? "Start here" : dueStatus}
          </span>
          {nextDueAt ? (
            <span>Every {data.settings.intervalMinutes / 60}h</span>
          ) : null}
        </div>
        {nextDueAt ? (
          <>
            <p className="hero-kicker">{dueTitle}</p>
            <div className="due-time">{feedTime.format(new Date(nextDueAt))}</div>
            <p className="countdown">{formatCountdown(nextDueAt, now)}</p>
          </>
        ) : (
          <div className="empty-hero">
            <BottleIcon large />
            <p className="hero-kicker">{dueTitle}</p>
            <h2>Mark the first drink</h2>
            <p>Your next schedule appears after the first log.</p>
          </div>
        )}
        <button className="button mark-button" onClick={markNow}>
          <PlusIcon />
          Mark drinking now
        </button>
      </section>

      <section className="summary-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">At a glance</p>
            <h2>Today</h2>
          </div>
          <span>
            {todaysFeeds.length === 1 ? "1 log" : `${todaysFeeds.length} logs`}
          </span>
        </div>
        <div className="summary-grid">
          <div>
            <strong>{todaysFeeds.length}</strong>
            <span>Drinks</span>
          </div>
          <div>
            <strong>
              {todaysFeeds.filter((feed) => feed.status === "on-time").length}
            </strong>
            <span>On time</span>
          </div>
          <div>
            <strong>
              {todaysFeeds.filter((feed) => feed.status === "late").length}
            </strong>
            <span>Late</span>
          </div>
          <div>
            <strong>
              {formatAverageGap(
                averageGap.count ? averageGap.total / averageGap.count : null,
              )}
            </strong>
            <span>Avg. gap</span>
          </div>
        </div>
      </section>

      <section className="history-section">
        <div className="section-heading history-heading">
          <div>
            <p className="eyebrow">The little details</p>
            <h2>Drinking history</h2>
          </div>
          <button
            className="text-button"
            onClick={() => setSheet({ type: "add" })}
          >
            <PlusIcon />
            Add manually
          </button>
        </div>

        {todaysFeeds.length > 0 ? (
          <TimelineGroup
            entries={todaysFeeds}
            label="Today"
            onEdit={(feed) => setSheet({ type: "edit", feed })}
          />
        ) : (
          <div className="empty-history">
            <p>No drinks marked today.</p>
            <span>Use the button above whenever feeding begins.</span>
          </div>
        )}

        {earlierFeeds.length > 0 ? (
          <button
            className="earlier-toggle"
            onClick={() => setShowEarlier((current) => !current)}
          >
            <ChevronIcon />
            {showEarlier ? "Hide earlier activity" : "Show earlier activity"}
          </button>
        ) : null}

        {showEarlier
          ? earlierGroups.map(([label, entries]) => (
              <TimelineGroup
                entries={entries}
                key={label}
                label={label}
                onEdit={(feed) => setSheet({ type: "edit", feed })}
              />
            ))
          : null}
      </section>

      <details className="settings-section" open={settingsOpen}>
        <summary
          onClick={(event) => {
            event.preventDefault();
            setSettingsOpen((current) => !current);
          }}
        >
          <span>
            <span className="eyebrow">Personalize</span>
            <strong>Tracker settings</strong>
          </span>
          <ChevronIcon />
        </summary>
        <form
          className="settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            setData((current) => ({ ...current, settings: draftSettings }));
            setSettingsSaved(true);
            window.setTimeout(() => setSettingsSaved(false), 1800);
          }}
        >
          <label className="field">
            <span>
              Baby name <small>optional</small>
            </span>
            <input
              onChange={(event) =>
                setDraftSettings((current) => ({
                  ...current,
                  babyName: event.target.value,
                }))
              }
              placeholder="Little one"
              type="text"
              value={draftSettings.babyName}
            />
          </label>
          <div className="settings-grid">
            <label className="field">
              <span>Drink every</span>
              <div className="input-with-unit">
                <input
                  max="1440"
                  min="15"
                  onChange={(event) =>
                    setDraftSettings((current) => ({
                      ...current,
                      intervalMinutes: event.target.valueAsNumber || 15,
                    }))
                  }
                  type="number"
                  value={draftSettings.intervalMinutes}
                />
                <span>min</span>
              </div>
            </label>
            <label className="field">
              <span>Grace period</span>
              <div className="input-with-unit">
                <input
                  max="240"
                  min="0"
                  onChange={(event) =>
                    setDraftSettings((current) => ({
                      ...current,
                      graceMinutes: Number.isFinite(event.target.valueAsNumber)
                        ? event.target.valueAsNumber
                        : 0,
                    }))
                  }
                  type="number"
                  value={draftSettings.graceMinutes}
                />
                <span>min</span>
              </div>
            </label>
          </div>
          <div className="settings-actions">
            <span>
              {settingsSaved ? "Saved locally" : "Stored on this device only"}
            </span>
            <button className="button button-small" type="submit">
              Save settings
            </button>
          </div>
        </form>
      </details>

      <footer>Your gentle, private record. Stored only on this device.</footer>

      {sheet?.type === "add" ? (
        <FeedFormSheet onClose={() => setSheet(null)} onSave={saveManualFeed} />
      ) : null}
      {sheet?.type === "edit" ? (
        <FeedFormSheet
          feed={sheet.feed}
          onClose={() => setSheet(null)}
          onDelete={() => setSheet({ type: "delete", feed: sheet.feed })}
          onSave={(occurredAt) => updateFeed(sheet.feed, occurredAt)}
        />
      ) : null}
      {sheet?.type === "delete" ? (
        <DeleteSheet
          onCancel={() => setSheet({ type: "edit", feed: sheet.feed })}
          onConfirm={() => deleteFeed(sheet.feed)}
        />
      ) : null}
    </main>
  );
}
