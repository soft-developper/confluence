"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatUnits, parseUnits, type EIP1193Provider } from "viem";
import { useBalance, useConnection, useReadContract, useSwitchChain } from "wagmi";
import { fetchSwapChains, postSwapFee, type SwapChainInfo, type SwapTokenSymbol } from "@/lib/api";
import { shortAddress } from "@/lib/chains";
import { cleanAmount, developerFee, loadSwapKit } from "@/lib/swapKit";
import { useBridgeChains } from "@/components/Providers";
import { ConnectModal } from "@/components/wallet/ConnectModal";
import { useDebounced } from "@/hooks/useDebounced";
import { useSwapExecution } from "@/hooks/useSwapExecution";

const SLIPPAGES = [50, 100, 300] as const;
const DEFAULT_SLIPPAGE = 100; // 1% (locked decision; App Kit's own default is 300)
const AMOUNT_INPUT = /^\d{0,18}(\.\d{0,18})?$/;
/** Warn when our fee is at least this share of the swap. */
const HIGH_FEE_SHARE = 0.05;

function fmt(v: string, max = 6): string {
  const [w = "0", f = ""] = v.split(".");
  const t = f.slice(0, max).replace(/0+$/, "");
  return `${w.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${t ? `.${t}` : ""}`;
}

export function SwapCard() {
  const { chains: bridgeChains } = useBridgeChains();
  const { address, chainId, status, connector } = useConnection();
  const { mutate: switchChain, isPending: switching } = useSwitchChain();
  const [connectOpen, setConnectOpen] = useState(false);
  const closeConnect = useCallback(() => setConnectOpen(false), []);

  const chainsQ = useQuery({ queryKey: ["swap-chains"], queryFn: fetchSwapChains, staleTime: 10 * 60_000 });
  const swapChains = chainsQ.data ?? [];
  const [chainId_, setChainId] = useState<string | null>(null);
  const chain: SwapChainInfo | undefined = swapChains.find((c) => c.id === chainId_) ?? swapChains[0];
  // Stage 6b: destination network. Only offered when the API lists more than one swap
  // chain (mainnet); on testnet Arc Testnet is the only swap chain, so this stays hidden.
  const [destId, setDestId] = useState<string | null>(null);
  const dest: SwapChainInfo | undefined = swapChains.find((c) => c.id === destId) ?? chain;
  const crossChain = !!chain && !!dest && dest.id !== chain.id;
  const [tokenIn, setTokenIn] = useState<SwapTokenSymbol>("USDC");
  const [tokenOut, setTokenOut] = useState<SwapTokenSymbol>("EURC");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(DEFAULT_SLIPPAGE);
  const [reviewing, setReviewing] = useState(false);
  const exec = useSwapExecution();

  // Keep both tokens valid: tokenIn on the source chain, tokenOut on the destination.
  useEffect(() => {
    if (!chain || !dest) return;
    const src = chain.tokens.map((t) => t.symbol);
    const dst = dest.tokens.map((t) => t.symbol);
    const tin = src.includes(tokenIn) ? tokenIn : (src[0] ?? "USDC");
    if (tin !== tokenIn) setTokenIn(tin);
    const bad = !dst.includes(tokenOut) || (!crossChain && tokenOut === tin);
    if (bad) setTokenOut(dst.find((s) => crossChain || s !== tin) ?? "EURC");
  }, [chain, dest, crossChain, tokenIn, tokenOut]);

  const tin = chain?.tokens.find((t) => t.symbol === tokenIn);
  const tout = dest?.tokens.find((t) => t.symbol === tokenOut);
  const destBridgeChain = bridgeChains.find((c) => c.id === dest?.id);
  // USDC to USDC between chains is a bridge (CCTP, 1:1), not a swap.
  const useBridge = crossChain && tokenIn === "USDC" && tokenOut === "USDC";
  const bridgeChain = bridgeChains.find((c) => c.id === chain?.id);
  const onChain = !!chain && chainId === chain.evmChainId;

  // Balance of the input token on the swap chain.
  const erc20Bal = useReadContract({
    address: (tin?.address ?? undefined) as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: chain?.evmChainId,
    query: { enabled: !!address && !!tin?.address && !!chain },
  });
  const nativeBal = useBalance({ address, chainId: chain?.evmChainId, query: { enabled: !!address && !!tin && !tin.address } });
  const balanceBase: bigint | undefined = tin?.address ? (erc20Bal.data as bigint | undefined) : nativeBal.data?.value;
  const balance = tin && balanceBase !== undefined ? formatUnits(balanceBase, tin.decimals) : undefined;

  const cleaned = tin ? cleanAmount(amount, tin.decimals) : null;
  const debounced = useDebounced(cleaned, 500);
  const insufficient = !!cleaned && !!tin && balanceBase !== undefined && parseUnits(cleaned, tin.decimals) > balanceBase;

  const estimateQ = useQuery({
    queryKey: ["swap-estimate", chain?.id, dest?.id, tokenIn, tokenOut, debounced, slippage, address],
    queryFn: async () => {
      const provider = (await connector!.getProvider()) as EIP1193Provider;
      const { kit, adapter } = await loadSwapKit({
        provider,
        registry: bridgeChains,
        tokenIn,
        tokenOut,
        // Estimates only: the recipient does not change the quote. Real swaps use the
        // fee recipient the API returns for the chain.
        feeRecipient: address!,
        askFee: async ({ token, amount: a }) => (await postSwapFee({ chain: chain!.id, token, amount: a })).fee,
      });
      return kit.estimateSwap({
        from: { adapter, chain: chain!.id as never },
        ...(crossChain ? { to: { chain: dest!.id as never, recipientAddress: address! } } : {}),
        tokenIn,
        tokenOut,
        amountIn: debounced!,
        config: { slippageBps: slippage },
      });
    },
    enabled:
      !!debounced && !!chain && !!address && !!connector && onChain && !insufficient && !useBridge && (crossChain || tokenIn !== tokenOut) && exec.run.phase === "idle",
    staleTime: 20_000,
    refetchInterval: reviewing ? false : 30_000,
    retry: false,
  });
  const est = estimateQ.data;
  const fee = developerFee(est?.fees);
  const feeShare = useMemo(() => {
    if (!fee || !cleaned) return 0;
    const base = fee.token === tokenIn ? Number(cleaned) : fee.token === tokenOut ? Number(est?.estimatedOutput.amount ?? 0) : 0;
    return base > 0 ? Number(fee.amount) / base : 0;
  }, [fee, cleaned, tokenIn, tokenOut, est]);
  const stale = !!est && debounced !== cleaned;

  function flip() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount("");
  }
  function onMax() {
    if (balance && tin) setAmount(tin.address ? balance : ""); // never max out native gas
  }

  let action: { label: string; onClick?: () => void; disabled?: boolean };
  if (status !== "connected") action = { label: "Connect wallet", onClick: () => setConnectOpen(true) };
  else if (!chain) action = { label: chainsQ.isError ? "Swap unavailable" : "Loading...", disabled: true };
  else if (!onChain) action = { label: switching ? "Switching..." : `Switch to ${chain.name}`, onClick: () => switchChain({ chainId: chain.evmChainId }), disabled: switching };
  else if (!cleaned) action = { label: "Enter an amount", disabled: true };
  else if (insufficient) action = { label: `Insufficient ${tin?.label ?? tokenIn}`, disabled: true };
  else if (useBridge) action = { label: "USDC between chains: use Bridge", disabled: true };
  else if (estimateQ.isFetching && !est) action = { label: "Getting estimate...", disabled: true };
  else if (!est || stale) action = { label: estimateQ.isError ? "No estimate" : "Getting estimate...", disabled: true };
  else action = { label: "Review swap", onClick: () => setReviewing(true) };

  const run = exec.run;
  const started = run.phase !== "idle";
  const explorer = run.explorerUrl ?? (bridgeChain && run.swapTx ? bridgeChain.explorerTxUrl.replace("{hash}", run.swapTx) : undefined);
  const destExplorer = destBridgeChain && run.destinationTx ? destBridgeChain.explorerTxUrl.replace("{hash}", run.destinationTx) : undefined;

  // ---------- review and execution ----------
  if (reviewing && est && chain && tin && tout && address && cleaned) {
    return (
      <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="swap-title">
        {!started && (
          <button type="button" onClick={() => setReviewing(false)} className="self-start text-sm text-ink-muted hover:text-ink">
            ‹ Back
          </button>
        )}
        <h1 id="swap-title" className="text-[22px] font-medium">
          {run.phase === "success" ? "Swap complete" : run.phase === "error" ? "Swap stopped" : started ? "Swapping" : "Review swap"}
        </h1>
        <div className="flex flex-col gap-1 rounded-md border border-border bg-bg p-4">
          <span className="text-xs text-ink-muted">You pay</span>
          <span className="tnum text-xl font-medium text-source-text">
            {fmt(cleaned)} {tin.label}
          </span>
          <span className="mt-2 text-xs text-ink-muted">{run.amountOut ? "You received" : "You receive (estimated)"}</span>
          <span className="tnum text-[28px] leading-9 font-medium text-destination-text">
            {fmt(run.amountOut ?? est.estimatedOutput.amount)} {tout.label}
          </span>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          {crossChain && dest ? (
            <>
              <Row label="From network" value={chain.name} />
              <Row label="To network" value={dest.name} />
            </>
          ) : (
            <Row label="Network" value={chain.name} />
          )}
          <Row label={`Minimum received (${slippage / 100}% slippage)`} value={`${fmt(est.stopLimit.amount)} ${tout.label}`} />
          <Row label="Confluence fee" value={fee ? `${fmt(fee.amount)} ${fee.token === "NATIVE" ? (tin.symbol === "NATIVE" ? tin.label : tout.label) : fee.token}` : "Included"} />
          <Row label="Wallet" value={shortAddress(address)} />
        </dl>
        {!started && (
          <p className="rounded-md border border-border bg-bg p-3 text-[13px] text-ink-muted">
            Your wallet may ask you to approve {tin.label} first, then to sign the swap. If the price moves more than {slippage / 100}% before the swap
            lands, it reverts instead of giving you less than the minimum.
          </p>
        )}
        {started && (
          <ol className="flex flex-col text-[15px]" aria-live="polite">
            <Step done={!!run.approvalTx || !!run.swapTx || run.phase === "success"} active={run.phase === "running" && !run.approvalTx && !run.swapTx}
              text={run.approvalTx ? `${tin.label} approved` : run.swapTx || run.phase === "success" ? `${tin.label} allowance ready` : `Approve ${tin.label} (if your wallet asks)`} />
            <Step done={!!run.swapTx} active={run.phase === "running" && !run.swapTx && !!run.approvalTx} text={run.swapTx ? "Swap submitted" : "Sign the swap"} />
            {crossChain && dest ? (
              <Step
                done={run.phase === "success"}
                active={run.phase === "running" && !!run.swapTx}
                text={run.phase === "success" ? `Delivered on ${dest.name}` : `Delivering on ${dest.name}`}
              />
            ) : (
              <Step done={run.phase === "success"} active={run.phase === "running" && !!run.swapTx} text={run.phase === "success" ? "Swap confirmed" : "Waiting for confirmation"} />
            )}
          </ol>
        )}
        {run.phase === "error" && run.error && (
          <div role="alert" className="rounded-md border border-danger bg-bg p-3 text-[13px]">
            {run.error}
          </div>
        )}
        {explorer && (
          <a href={explorer} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-action-text">
            {crossChain ? "View source transaction" : "View swap transaction"}
          </a>
        )}
        {destExplorer && (
          <a href={destExplorer} target="_blank" rel="noopener noreferrer" className="self-start text-sm text-action-text">
            View delivery on {dest?.name}
          </a>
        )}
        {!started ? (
          <Primary
            onClick={() =>
              connector &&
              void exec.start({
                chain: chain.id,
                ...(crossChain && dest ? { destinationChain: dest.id } : {}),
                sender: address,
                tokenIn,
                tokenOut,
                amountIn: cleaned,
                slippageBps: slippage,
                registry: bridgeChains,
                getProvider: () => connector.getProvider(),
              })
            }
            disabled={!onChain}
          >
            {onChain ? "Confirm and swap" : `Switch to ${chain.name} first`}
          </Primary>
        ) : exec.busy ? (
          <Primary disabled>{run.phase === "preparing" ? "Preparing..." : "Swapping..."}</Primary>
        ) : (
          <Primary
            onClick={() => {
              exec.reset();
              setReviewing(false);
              if (run.phase === "success") setAmount("");
              void erc20Bal.refetch();
              void nativeBal.refetch();
            }}
          >
            {run.phase === "success" ? "Swap again" : "Back to swap"}
          </Primary>
        )}
        {exec.busy && <p className="text-center text-xs text-ink-muted">Keep this page open until the swap finishes.</p>}
      </section>
    );
  }

  // ---------- form ----------
  return (
    <section className="flex w-full max-w-[460px] flex-col gap-5 rounded-lg border border-border bg-surface p-5 sm:p-6" aria-labelledby="swap-title">
      <div className="flex items-center justify-between">
        <h1 id="swap-title" className="text-[22px] font-medium">
          Swap
        </h1>
        <span className="font-mono text-xs text-ink-muted">Powered by Circle App Kit</span>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-ink-muted">Network</span>
        {swapChains.length > 1 ? (
          <select
            aria-label="Swap network"
            value={chain?.id ?? ""}
            onChange={(e) => setChainId(e.target.value)}
            className="h-9 rounded-md border border-border-control bg-bg px-2 text-sm"
          >
            {swapChains.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-medium">{chain?.name ?? (chainsQ.isError ? "Unavailable" : "Loading...")}</span>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-4">
        <div className="flex items-center justify-between text-xs text-ink-muted">
          <span>You pay</span>
          <span className="tnum font-mono">{balance !== undefined ? `Balance ${fmt(balance)}` : address ? "Balance ..." : ""}</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            id="swap-amount"
            aria-label={`Amount of ${tin?.label ?? tokenIn} to swap`}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(/,/g, "");
              if (AMOUNT_INPUT.test(v)) setAmount(v);
            }}
            className="tnum min-w-0 flex-1 bg-transparent text-[22px] font-medium outline-none"
          />
          {tin?.address && balance !== undefined && (
            <button type="button" onClick={onMax} className="rounded-[4px] border border-border-control px-2 py-0.5 text-xs font-medium text-action-text">
              Max
            </button>
          )}
          <TokenSelect chain={chain} value={tokenIn} onChange={setTokenIn} exclude={undefined} label="Token to pay" />
        </div>
      </div>

      <button type="button" onClick={flip} aria-label="Switch tokens" className="-my-3 self-center rounded-md border border-border-control bg-surface px-3 py-1 text-sm">
        ⇅
      </button>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-bg p-4">
        <div className="flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span>You receive (estimated)</span>
          {swapChains.length > 1 && chain && (
            <select
              aria-label="Receive on network"
              value={dest?.id ?? chain.id}
              onChange={(e) => setDestId(e.target.value)}
              className="h-7 rounded-[4px] border border-border-control bg-surface px-1.5 text-xs"
            >
              {swapChains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id === chain.id ? `${c.name} (same network)` : `on ${c.name}`}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className={`tnum min-w-0 flex-1 truncate text-[22px] font-medium ${est && !stale ? "text-destination-text" : "text-ink-muted"}`}>
            {est && !stale ? fmt(est.estimatedOutput.amount) : estimateQ.isFetching ? "..." : "0.00"}
          </span>
          <TokenSelect chain={dest} value={tokenOut} onChange={setTokenOut} exclude={crossChain ? undefined : tokenIn} label="Token to receive" />
        </div>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        {est && !stale && tin && tout && cleaned && (
          <>
            <Row label="Rate" value={`1 ${tin.label} ≈ ${fmt(String(Number(est.estimatedOutput.amount) / Number(cleaned)), 6)} ${tout.label}`} />
            <Row label="Minimum received" value={`${fmt(est.stopLimit.amount)} ${tout.label}`} />
            <Row label="Confluence fee" value={fee ? `${fmt(fee.amount)} ${fee.token}` : "Included"} />
          </>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-muted">Slippage</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Slippage tolerance">
            {SLIPPAGES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={slippage === s}
                onClick={() => setSlippage(s)}
                className={`rounded-[4px] border px-2 py-0.5 font-mono text-xs ${slippage === s ? "border-action text-action-text" : "border-border-control text-ink-muted"}`}
              >
                {s / 100}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {useBridge && (
        <div role="status" className="rounded-md border border-border-control bg-bg p-3 text-[13px]">
          Moving USDC between chains is a bridge, not a swap: CCTP moves it 1:1.{" "}
          <Link href="/" className="font-medium text-action-text">
            Open the Bridge
          </Link>
        </div>
      )}
      {crossChain && dest && !useBridge && (
        <p className="text-xs text-ink-muted">
          Cross-chain swap: you sign on {chain?.name}; the {tout?.label ?? tokenOut} arrives in your wallet on {dest.name}. Circle takes the fee from
          the token you pay.
        </p>
      )}
      {feeShare >= HIGH_FEE_SHARE && fee && (
        <div role="status" className="rounded-md border border-warning bg-bg p-3 text-[13px]">
          The {fmt(fee.amount)} {fee.token} fee is {Math.round(feeShare * 100)}% of this swap. The fee is flat up to 1,000, so larger swaps cost
          proportionally less.
        </div>
      )}
      {estimateQ.isError && cleaned && !insufficient && (
        <div role="alert" className="rounded-md border border-danger bg-bg p-3 text-[13px]">
          No estimate for this swap right now: {(estimateQ.error as Error).message.slice(0, 160)}
        </div>
      )}

      <Primary onClick={action.onClick} disabled={action.disabled}>
        {action.label}
      </Primary>
      <ConnectModal open={connectOpen} onClose={closeConnect} />
    </section>
  );
}

function TokenSelect({
  chain,
  value,
  onChange,
  exclude,
  label,
}: {
  chain: SwapChainInfo | undefined;
  value: SwapTokenSymbol;
  onChange: (t: SwapTokenSymbol) => void;
  exclude: SwapTokenSymbol | undefined;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as SwapTokenSymbol)}
      className="h-9 rounded-md border border-border-control bg-surface px-2 text-sm font-medium"
    >
      {(chain?.tokens ?? []).filter((t) => t.symbol !== exclude).map((t) => (
        <option key={t.symbol} value={t.symbol}>
          {t.label}
        </option>
      ))}
    </select>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tnum text-right font-mono text-[13px]">{value}</dd>
    </div>
  );
}

function Step({ done, active, text }: { done: boolean; active: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-2.5 border-b border-border py-2.5 last:border-b-0 ${done || active ? "text-ink" : "text-ink-muted"}`}>
      <span aria-hidden="true" className={done ? "text-destination-text" : active ? "animate-pulse text-action-text" : "text-border-control"}>
        {done ? "●" : "○"}
      </span>
      {text}
    </li>
  );
}

function Primary({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-13 w-full rounded-md bg-action text-[15px] font-medium text-on-action hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      {children}
    </button>
  );
}
