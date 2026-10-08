import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { decodeEventLog, parseAbiItem } from "viem";
import type { BridgeChain, ChainRegistry } from "../chains/registry.js";
import type { Db } from "../db/client.js";
import { transferEvents, transfers, type TransferSpeed } from "../db/schema.js";
import { getReceipt, type TxReceipt } from "./chainReads.js";

/**
 * Source-chain proof of a burn (confluence:source-burn-proof).
 *
 * Circle only attests a Standard burn after source finality (about 15 minutes on Base or
 * Ethereum), and history used to wait for that. This check reads the burn receipt from the
 * source chain instead, so a real burn shows in history within a tracker pass of being
 * reported, even when the mint later needs a manual step or Circle never attests it.
 *
 * Event layout from Circle's TokenMessengerV2 source (circlefin/evm-cctp-contracts,
 * src/v2/TokenMessengerV2.sol). It is not shipped in App Kit's bundle as an ABI.
 * The depositor field is not used for ownership: with a custom fee App Kit burns through
 * Circle's TokenMessengerWithFees, so the depositor is that contract, not the user.
 */
export const DEPOSIT_FOR_BURN = parseAbiItem(
  "event DepositForBurn(address indexed burnToken, uint256 amount, address indexed depositor, bytes32 mintRecipient, uint32 destinationDomain, bytes32 destinationTokenMessenger, bytes32 destinationCaller, uint256 maxFee, uint32 indexed minFinalityThreshold, bytes hookData)",
);

// keccak256("Transfer(address,address,uint256)"), the standard ERC-20 Transfer event.
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const SOURCE_BURN_RESULTS = ["ok", "reverted", "no_matching_burn", "sender_mismatch"] as const;
export type SourceBurnResult = (typeof SOURCE_BURN_RESULTS)[number];

export interface BurnExpectation {
  tokenMessenger: string;
  usdcAddress: string;
  amountBase: string;
  sender: string;
  recipient: string;
  destinationDomain: number;
  speed: TransferSpeed;
}

const lc = (s: string) => s.toLowerCase();
const last40 = (a: string) => lc(a).replace(/^0x/, "").slice(-40);
const topicAddress = (t: string | undefined) => (t ? "0x" + last40(t) : "");

/** Pure check of one receipt against the transfer. null = the receipt is not available yet. */
export function checkBurnReceipt(receipt: TxReceipt | null, want: BurnExpectation): SourceBurnResult | null {
  if (!receipt) return null;
  if (receipt.status !== "0x1") return "reverted";
  const wantThreshold = want.speed === "FAST" ? 1000 : 2000;
  let amount: bigint;
  try {
    amount = BigInt(want.amountBase);
  } catch {
    return "no_matching_burn";
  }
  const match = receipt.logs.some((l) => {
    if (lc(l.address) !== lc(want.tokenMessenger)) return false;
    try {
      const ev = decodeEventLog({ abi: [DEPOSIT_FOR_BURN], data: l.data as `0x${string}`, topics: l.topics as [`0x${string}`, ...`0x${string}`[]] });
      const a = ev.args;
      return (
        lc(a.burnToken) === lc(want.usdcAddress) &&
        a.amount === amount &&
        last40(a.mintRecipient) === last40(want.recipient) &&
        a.destinationDomain === want.destinationDomain &&
        a.minFinalityThreshold === wantThreshold
      );
    } catch {
      return false; // another event from the same contract
    }
  });
  if (!match) return "no_matching_burn";
  // Made by this wallet: it sent the transaction, or (smart wallets, sent by a bundler) the
  // receipt shows source USDC leaving the wallet.
  const me = lc(want.sender);
  if (lc(receipt.from) === me) return "ok";
  const outOfWallet = receipt.logs.some(
    (l) => lc(l.address) === lc(want.usdcAddress) && lc(l.topics[0] ?? "") === TRANSFER_TOPIC && topicAddress(l.topics[1]) === me,
  );
  return outOfWallet ? "ok" : "sender_mismatch";
}

/** Rows newer than this are checked; older unproven burns are left to Circle's data. */
export const SOURCE_CHECK_WINDOW_MS = 48 * 60 * 60 * 1000;
const PER_PASS = 10;

export interface SourceBurnPassResult {
  checked: number;
  proven: number;
  rejected: number;
  errors: number;
}

/**
 * One pass: reported burns that Circle has not verified yet and that were never checked on
 * the source chain. Only writes the two source_burn columns and an audit event; it never
 * changes a transfer's state (Circle's data stays the authority for that).
 */
export async function checkSourceBurnsOnce(
  deps: { db: Db; registry: ChainRegistry; fetchImpl?: typeof fetch; log?: (m: string) => void },
  now = Date.now(),
): Promise<SourceBurnPassResult> {
  const { db, registry } = deps;
  const log = deps.log ?? (() => {});
  const rows = await db
    .select()
    .from(transfers)
    .where(
      and(
        isNotNull(transfers.burnTxHash),
        isNull(transfers.verifiedAt),
        isNull(transfers.sourceBurnCheck),
        gt(transfers.createdAt, new Date(now - SOURCE_CHECK_WINDOW_MS)),
      ),
    )
    .orderBy(sql`${transfers.createdAt} desc`)
    .limit(PER_PASS);

  const out: SourceBurnPassResult = { checked: 0, proven: 0, rejected: 0, errors: 0 };
  for (const r of rows) {
    const src: BridgeChain | undefined = registry.byId.get(r.sourceChain);
    const dst: BridgeChain | undefined = registry.byId.get(r.destinationChain);
    if (!src || !dst || !src.tokenMessenger || !r.burnTxHash) continue;
    out.checked++;
    try {
      const receipt = await getReceipt(src.rpcUrls, r.burnTxHash, deps.fetchImpl);
      const result = checkBurnReceipt(receipt, {
        tokenMessenger: src.tokenMessenger,
        usdcAddress: src.usdcAddress,
        amountBase: r.amountBase,
        sender: r.sender,
        recipient: r.recipient,
        destinationDomain: dst.cctpDomain,
        speed: r.speed,
      });
      if (result === null) continue; // the chain does not know it yet: next pass
      const detail = { actor: "source-check", result, txHash: r.burnTxHash };
      await db.batch([
        db
          .update(transfers)
          .set({ sourceBurnCheck: result, ...(result === "ok" ? { sourceBurnAt: new Date(now) } : {}) })
          .where(and(eq(transfers.id, r.id), isNull(transfers.sourceBurnCheck))),
        db.run(
          sql`insert into ${transferEvents} (transfer_id, from_state, to_state, source, detail)
              select ${r.id}, ${r.state}, ${r.state}, 'worker', ${JSON.stringify(detail)} where changes() = 1`,
        ),
      ]);
      if (result === "ok") out.proven++;
      else out.rejected++;
      log(`tracker: ${r.id.slice(0, 8)} source burn check: ${result}`);
    } catch (e) {
      out.errors++;
      log(`tracker: ${r.id.slice(0, 8)} source burn check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
