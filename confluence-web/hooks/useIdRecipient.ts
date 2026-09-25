"use client";

import { useQuery } from "@tanstack/react-query";
import { lookupConfluenceId } from "@/lib/api";
import { useDebounced } from "@/hooks/useDebounced";

const ID_TEXT = /^@[a-zA-Z0-9_]{3,20}$/;

/**
 * Recipient text that starts with "@" is a Confluence ID (Stage 8a). This resolves it
 * for display and for the safety checks; the quote itself sends recipientId and the API
 * resolves it again, so the browser can never redirect the payment.
 */
export function useIdRecipient(text: string) {
  const isId = text.trim().startsWith("@");
  const handle = isId ? text.trim().slice(1).toLowerCase() : "";
  const wellFormed = isId && ID_TEXT.test(text.trim());
  const debounced = useDebounced(handle, 350);
  const q = useQuery({
    queryKey: ["confluence-id", debounced],
    queryFn: () => lookupConfluenceId(debounced),
    enabled: wellFormed && debounced === handle && !!handle,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const resolved = wellFormed && debounced === handle ? q.data : undefined;
  return {
    isId,
    handle,
    wellFormed,
    loading: wellFormed && (debounced !== handle || q.isFetching),
    /** null = no such ID; undefined = not resolved yet. */
    resolved: resolved === undefined ? undefined : resolved,
  };
}
