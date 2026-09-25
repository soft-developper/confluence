"use client";

import { useEffect, useRef } from "react";
import { useConnection } from "wagmi";
import { SessionExpiredError, syncAddressBook } from "@/lib/api";
import { exportEntries, importEntries, onAddressBookChange } from "@/lib/addressBook";
import { clearSession, useSession } from "@/lib/session";

export const SYNC_EVENT = "confluence:address-book-synced";

/**
 * While signed in, keeps the browser address book and the server copy in step (Stage 7b):
 * one sync when the session starts, then a debounced upload after each local change.
 * Never asks for a signature itself (sign-in happens only on the Profile tab).
 */
export function SessionSync() {
  const { address } = useConnection();
  const session = useSession(address);
  const busy = useRef(false);
  const again = useRef(false);

  useEffect(() => {
    if (!session || !address) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const run = async () => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        const merged = await syncAddressBook(session.token, exportEntries(address));
        if (!cancelled) {
          importEntries(address, merged as never);
          window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { at: Date.now(), count: merged.filter((e) => !e.deletedAt).length } }));
        }
      } catch (e) {
        if (e instanceof SessionExpiredError) clearSession();
        else console.warn("confluence: address book sync failed:", e instanceof Error ? e.message : e);
      } finally {
        busy.current = false;
        if (again.current && !cancelled) {
          again.current = false;
          void run();
        }
      }
    };
    void run();
    const off = onAddressBookChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void run(), 1500);
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      off();
    };
    // re-run only when the session itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token, address]);

  return null;
}
