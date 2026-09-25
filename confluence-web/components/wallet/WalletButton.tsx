"use client";

import { useCallback, useState } from "react";
import { useConnection, useDisconnect } from "wagmi";
import { useBridgeChains } from "@/components/Providers";
import { shortAddress } from "@/lib/chains";
import { ConnectModal } from "./ConnectModal";

export function WalletButton() {
  const { address, chainId, status } = useConnection();
  const { mutate: disconnect } = useDisconnect();
  const { byEvmId } = useBridgeChains();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  if (status !== "connected" || !address) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 rounded-md bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
        >
          {status === "reconnecting" || status === "connecting" ? "Connecting..." : "Connect wallet"}
        </button>
        <ConnectModal open={open} onClose={close} />
      </>
    );
  }

  const chain = chainId ? byEvmId.get(chainId) : undefined;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenu((m) => !m)}
        aria-expanded={menu}
        className="flex h-10 items-center gap-2 rounded-md border border-border-control bg-surface px-3 text-[13px] hover:border-action-text"
      >
        {/* The network name hides on the narrowest phones so the header fits (address stays). */}
        <span className={`${chain ? "text-ink-muted" : "text-warning"} hidden min-[380px]:inline`}>{chain ? chain.name : "Unsupported network"}</span>
        <span className="font-mono">{shortAddress(address)}</span>
      </button>
      {menu && (
        <div className="absolute right-0 z-40 mt-2 w-48 rounded-lg border border-border bg-surface-raised p-1 text-sm">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(address);
              setMenu(false);
            }}
            className="w-full rounded-md px-3 py-2 text-left hover:bg-surface"
          >
            Copy address
          </button>
          <button
            type="button"
            onClick={() => {
              disconnect();
              setMenu(false);
            }}
            className="w-full rounded-md px-3 py-2 text-left text-danger hover:bg-surface"
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
