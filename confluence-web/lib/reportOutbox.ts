/**
 * Durable outbox for step reports (confluence:report-outbox).
 *
 * The server learns a bridge's burn hash, or a swap's transaction, only from these reports.
 * If one is lost (network drop, API cold start, rate limit, or a "state_changed" conflict the
 * API asks us to resend), the record is later treated as abandoned and pruned, even though
 * funds moved. So every report is written to this browser's storage first and removed only
 * once the API accepts it (or rejects it for good). Unsent reports are retried with backoff
 * while the page is open, and again whenever the app loads, comes back online or regains focus.
 *
 * Reports for the same transfer or swap always go in the order they were made. The report
 * token needed to send them is the one already kept by lib/transferToken.
 */
import { ApiError, postSwapEvent, postTransferEvent, type StepReportBody, type SwapReportBody } from "./api";
import { loadTransferToken } from "./transferToken";

type Entry =
  | { key: string; kind: "transfer"; id: string; body: StepReportBody; createdAt: number; attempts: number; nextAt: number }
  | { key: string; kind: "swap"; id: string; body: SwapReportBody; createdAt: number; attempts: number; nextAt: number };

const STORE = "confluence:report-outbox";
const MAX_AGE_MS = 7 * 24 * 3600_000;
const MAX_ENTRIES = 300;
/** Wait before each retry: 2s, 5s, 15s, 30s, 1 min, then every 2 min. */
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000];

let memory: Entry[] = []; // used when storage is blocked (private mode, quota)
let storageOk = true;

function load(): Entry[] {
  if (!storageOk) return memory;
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as Entry[]) : [];
    const now = Date.now();
    return Array.isArray(list) ? list.filter((e) => e && typeof e.key === "string" && now - e.createdAt < MAX_AGE_MS) : [];
  } catch {
    storageOk = false;
    return memory;
  }
}

function save(list: Entry[]): void {
  const trimmed = list.slice(-MAX_ENTRIES);
  memory = trimmed;
  if (!storageOk) return;
  try {
    if (trimmed.length === 0) localStorage.removeItem(STORE);
    else localStorage.setItem(STORE, JSON.stringify(trimmed));
  } catch {
    storageOk = false;
  }
}

/** Re-reads storage for every change, so entries added meanwhile are never overwritten. */
function mutate(fn: (list: Entry[]) => Entry[]): void {
  save(fn(load()));
}

type Outcome = "done" | "drop" | "retry";

async function sendOne(e: Entry, token: string): Promise<Outcome> {
  try {
    if (e.kind === "transfer") await postTransferEvent(e.id, token, e.body);
    else await postSwapEvent(e.id, token, e.body);
    return "done";
  } catch (err) {
    if (!(err instanceof ApiError)) return "retry"; // network error or timeout
    if (err.status === 409 && err.code === "state_changed") return "retry"; // the API asks for a resend
    if (err.status === 429) return err.code === "too_many_reports" ? "drop" : "retry";
    if (err.status >= 500) return "retry"; // includes maintenance (503)
    return "drop"; // invalid, unknown transfer or token, or a conflicting hash: resending can't help
  }
}

let flushing: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;

async function flushOnce(): Promise<void> {
  const blocked = new Set<string>(); // an earlier report for this id is still waiting
  for (const e of load()) {
    const id = `${e.kind}:${e.id}`;
    if (blocked.has(id)) continue;
    if (e.nextAt > Date.now()) {
      blocked.add(id);
      continue;
    }
    const token = loadTransferToken(e.id);
    if (!token) {
      mutate((l) => l.filter((x) => x.key !== e.key));
      continue;
    }
    const outcome = await sendOne(e, token);
    if (outcome === "retry") {
      blocked.add(id);
      const wait = BACKOFF_MS[Math.min(e.attempts, BACKOFF_MS.length - 1)]!;
      mutate((l) => l.map((x) => (x.key === e.key ? { ...x, attempts: x.attempts + 1, nextAt: Date.now() + wait } : x)));
    } else {
      if (outcome === "drop") console.warn(`confluence: report ${e.kind}:${e.body.step} for ${e.id.slice(0, 8)} was rejected; not resending`);
      mutate((l) => l.filter((x) => x.key !== e.key));
    }
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  const list = load();
  if (list.length === 0) return;
  const soonest = Math.min(...list.map((e) => e.nextAt));
  timer = setTimeout(() => void flushReports(), Math.max(1_000, soonest - Date.now()));
}

/** Sends every report that is due. Never throws; concurrent calls share one pass. */
export function flushReports(): Promise<void> {
  if (flushing) {
    again = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      await flushOnce();
    } catch (e) {
      console.warn("confluence: report outbox pass failed:", e instanceof Error ? e.message : e);
    } finally {
      flushing = null;
      if (again) {
        again = false;
        void flushReports();
      } else schedule();
    }
  })();
  return flushing;
}

function enqueue(entry: Omit<Entry, "key" | "createdAt" | "attempts" | "nextAt">): Promise<void> {
  const now = Date.now();
  mutate((l) => [...l, { ...entry, key: `${now}-${Math.random().toString(36).slice(2, 10)}`, createdAt: now, attempts: 0, nextAt: 0 } as Entry]);
  return flushReports();
}

/** Queues a bridge step report. The promise settles after the first send attempt; it never rejects. */
export function enqueueTransferReport(id: string, body: StepReportBody): Promise<void> {
  return enqueue({ kind: "transfer", id, body });
}

/** Queues a swap report. The promise settles after the first send attempt; it never rejects. */
export function enqueueSwapReport(id: string, body: SwapReportBody): Promise<void> {
  return enqueue({ kind: "swap", id, body });
}

/** Starts background delivery: now, when the browser comes back online, and when the tab is shown again. */
export function startReportOutbox(): () => void {
  const onOnline = () => void flushReports();
  const onVisible = () => {
    if (document.visibilityState === "visible") void flushReports();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  void flushReports();
  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
