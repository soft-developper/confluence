"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { isAddress } from "viem";
import { useAddressBook } from "@/lib/addressBook";
import { findLookalike, recipientKind, type LookalikeMatch, type RecipientKind } from "@/lib/addressSafety";
import { shortAddress, type BridgeChain } from "@/lib/chains";

export interface RecipientChecks {
  lookalike: LookalikeMatch | undefined;
  kind: RecipientKind | undefined;
  checkingKind: boolean;
}

/** Lookalike (against saved, recent and your own address) and contract checks for a recipient. */
export function useRecipientChecks(
  owner: `0x${string}` | undefined,
  recipient: string | undefined,
  destination: BridgeChain | undefined,
): RecipientChecks {
  const book = useAddressBook(owner);
  const valid = !!recipient && isAddress(recipient);
  const known = useMemo<LookalikeMatch[]>(
    () => [
      ...book.saved.map((s) => ({ address: s.address, label: s.label })),
      ...book.recents.map((r) => ({ address: r.address, ...(book.labelOf(r.address) ? { label: book.labelOf(r.address) } : {}) })),
      ...(owner ? [{ address: owner, label: "your wallet" }] : []),
    ],
    [book, owner],
  );
  const lookalike = valid ? findLookalike(recipient, known) : undefined;
  const kindQ = useQuery({
    queryKey: ["recipient-kind", destination?.id, recipient?.toLowerCase()],
    queryFn: () => recipientKind(destination!, recipient!),
    enabled: valid && !!destination,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return { lookalike, kind: kindQ.data, checkingKind: kindQ.isFetching };
}

/** Warn-only notices for a recipient. Renders nothing when there is nothing to say. */
export function RecipientWarnings({ checks, destination }: { checks: RecipientChecks; destination: BridgeChain }) {
  const { lookalike, kind } = checks;
  if (!lookalike && kind !== "contract") return null;
  return (
    <div className="flex flex-col gap-2">
      {lookalike && (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger bg-bg p-3 text-[13px]">
          <span className="font-medium">This address looks like {lookalike.label ? `"${lookalike.label}"` : "one you used before"}, but it is different</span>
          <span className="text-ink-muted">
            Known: <span className="font-mono">{shortAddress(lookalike.address)}</span>. Scammers create addresses with the same first and last
            characters (address poisoning). Compare every character before you send.
          </span>
        </div>
      )}
      {kind === "contract" && (
        <div role="status" className="flex flex-col gap-1 rounded-md border border-warning bg-bg p-3 text-[13px]">
          <span className="font-medium">The recipient is a smart contract on {destination.name}</span>
          <span className="text-ink-muted">
            Smart wallets such as Safe can receive and move USDC, but many other contracts cannot, and USDC sent to them can be stuck for good.
            Only continue if you know this contract can handle USDC.
          </span>
        </div>
      )}
    </div>
  );
}
