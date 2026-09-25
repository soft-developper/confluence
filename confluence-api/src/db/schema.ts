import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Confluence schema v1. One database per environment (testnet, mainnet), so no env column.
 * Amounts are USDC base units (6 decimals) stored as integer strings, never floats.
 * Timestamps are Unix milliseconds.
 */

export const TRANSFER_STATES = [
  "CREATED",
  "APPROVED",
  "BURN_SUBMITTED",
  "BURN_CONFIRMED",
  "ATTESTATION_PENDING",
  "ATTESTED",
  "MINT_SUBMITTED",
  "COMPLETED",
  "FAILED",
  "RECOVERY_REQUIRED",
] as const;
export type TransferState = (typeof TRANSFER_STATES)[number];

export const TRANSFER_SPEEDS = ["FAST", "SLOW"] as const;
export type TransferSpeed = (typeof TRANSFER_SPEEDS)[number];

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('subsec') * 1000)`);

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    sourceChain: text("source_chain").notNull(),
    destinationChain: text("destination_chain").notNull(),
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    // Stage 8a: the Confluence ID the payer chose; the API resolved it to `recipient`.
    recipientId: text("recipient_id"),
    // Stage 8b: set when paying a payment request.
    requestId: text("request_id"),
    amountBase: text("amount_base").notNull(),
    platformFeeBase: text("platform_fee_base").notNull(),
    cctpFeeBase: text("cctp_fee_base").notNull(),
    forwardingFeeBase: text("forwarding_fee_base").notNull(),
    speed: text("speed", { enum: TRANSFER_SPEEDS }).notNull(),
    useForwarder: integer("use_forwarder", { mode: "boolean" }).notNull(),
    feeRecipient: text("fee_recipient").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("quotes_sender_idx").on(t.sender)],
);

export const transfers = sqliteTable(
  "transfers",
  {
    id: text("id").primaryKey(),
    quoteId: text("quote_id").notNull().references(() => quotes.id),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state", { enum: TRANSFER_STATES }).notNull().default("CREATED"),
    sourceChain: text("source_chain").notNull(),
    destinationChain: text("destination_chain").notNull(),
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    // Stage 8a: copied from the quote.
    recipientId: text("recipient_id"),
    // Stage 8b: set when paying a payment request.
    requestId: text("request_id"),
    amountBase: text("amount_base").notNull(),
    platformFeeBase: text("platform_fee_base").notNull(),
    speed: text("speed", { enum: TRANSFER_SPEEDS }).notNull(),
    useForwarder: integer("use_forwarder", { mode: "boolean" }).notNull(),
    burnTxHash: text("burn_tx_hash"),
    mintTxHash: text("mint_tx_hash"),
    errorCode: text("error_code"),
    // sha256 (hex) of the secret report token returned once by POST /transfers.
    // The browser sends the token with step reports; we never store the token itself.
    reportTokenHash: text("report_token_hash"),
    // Last time the Stage 4 tracker checked this row (Circle and the chain). Null = never.
    trackedAt: integer("tracked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => [
    uniqueIndex("transfers_idempotency_key_uq").on(t.idempotencyKey),
    // one transfer per quote
    uniqueIndex("transfers_quote_id_uq").on(t.quoteId),
    uniqueIndex("transfers_burn_tx_hash_uq").on(t.burnTxHash),
    index("transfers_state_idx").on(t.state),
    index("transfers_sender_idx").on(t.sender),
    index("transfers_tracked_at_idx").on(t.trackedAt),
    index("transfers_request_id_idx").on(t.requestId),
  ],
);

export const transferEvents = sqliteTable(
  "transfer_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transferId: text("transfer_id").notNull().references(() => transfers.id),
    fromState: text("from_state", { enum: TRANSFER_STATES }),
    toState: text("to_state", { enum: TRANSFER_STATES }).notNull(),
    // who observed the change: the tracking worker, the client, or an admin
    source: text("source", { enum: ["worker", "client", "admin"] }).notNull(),
    detail: text("detail", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [index("transfer_events_transfer_idx").on(t.transferId)],
);

export const feeRecipients = sqliteTable(
  "fee_recipients",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chain: text("chain").notNull(),
    address: text("address").notNull(),
    effectiveFrom: integer("effective_from", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fee_recipients_chain_from_uq").on(t.chain, t.effectiveFrom)],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    createdAt: createdAt(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index("idempotency_keys_expires_idx").on(t.expiresAt)],
);

// ---------- swaps (Stage 6a) ----------

export const SWAP_STATES = ["CREATED", "SUBMITTED", "COMPLETED", "FAILED"] as const;
export type SwapState = (typeof SWAP_STATES)[number];

/**
 * Same-chain swaps executed in the browser with App Kit (keyless). Token amounts are
 * stored human-readable exactly as App Kit uses them (tokens have different decimals).
 */
export const swaps = sqliteTable(
  "swaps",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state", { enum: SWAP_STATES }).notNull(),
    chain: text("chain").notNull(),
    // Stage 6b: set only for cross-chain swaps (App Kit destination chain).
    destinationChain: text("destination_chain"),
    sender: text("sender").notNull(),
    recipient: text("recipient").notNull(),
    tokenIn: text("token_in").notNull(),
    tokenOut: text("token_out").notNull(),
    amountIn: text("amount_in").notNull(),
    feeRecipient: text("fee_recipient").notNull(),
    // What our backend calculated (computeFee asked POST /swaps/fee) and on which side.
    feeSide: text("fee_side", { enum: ["input", "output"] }),
    feeToken: text("fee_token"),
    feeExpected: text("fee_expected"),
    // What Circle's swap result reported as the developer fee.
    feeCharged: text("fee_charged"),
    estimatedOut: text("estimated_out"),
    minOut: text("min_out"),
    amountOut: text("amount_out"),
    approvalTxHash: text("approval_tx_hash"),
    swapTxHash: text("swap_tx_hash"),
    // Stage 6b: the delivery transaction on the destination chain (cross-chain only).
    destinationTxHash: text("destination_tx_hash"),
    errorCode: text("error_code"),
    reportTokenHash: text("report_token_hash"),
    trackedAt: integer("tracked_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => [
    uniqueIndex("swaps_idempotency_key_uq").on(t.idempotencyKey),
    uniqueIndex("swaps_swap_tx_hash_uq").on(t.swapTxHash),
    index("swaps_sender_idx").on(t.sender),
    index("swaps_state_idx").on(t.state),
  ],
);

export const swapEvents = sqliteTable(
  "swap_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    swapId: text("swap_id")
      .notNull()
      .references(() => swaps.id),
    fromState: text("from_state", { enum: SWAP_STATES }),
    toState: text("to_state", { enum: SWAP_STATES }).notNull(),
    source: text("source", { enum: ["client", "worker"] }).notNull(),
    detail: text("detail", { mode: "json" }),
    createdAt: createdAt(),
  },
  (t) => [index("swap_events_swap_idx").on(t.swapId)],
);

// ---------- accounts and sign-in (Stage 7a) ----------

/** One wallet is one account (locked decision). Address stored lowercase. */
export const accounts = sqliteTable(
  "accounts",
  {
    address: text("address").primaryKey(),
    // Confluence ID: lowercase, permanent once claimed (locked decision).
    confluenceId: text("confluence_id"),
    idClaimedAt: integer("id_claimed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("accounts_confluence_id_uq").on(t.confluenceId)],
);

/** Single-use Sign-In with Ethereum nonces (EIP-4361). */
export const authNonces = sqliteTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

/** Session tokens: only the sha256 is stored; 7-day expiry; revocable. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    address: text("address")
      .notNull()
      .references(() => accounts.address),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_hash_uq").on(t.tokenHash), index("sessions_address_idx").on(t.address)],
);

/**
 * Server copy of the browser address book (Stage 3 shape). One row per saved address
 * per owner; merges keep the newest updatedAt; deletes are kept as deletedAt tombstones.
 */
export const addressBookEntries = sqliteTable(
  "address_book_entries",
  {
    owner: text("owner")
      .notNull()
      .references(() => accounts.address),
    address: text("address").notNull(), // lowercase key
    id: text("id").notNull(),
    displayAddress: text("display_address").notNull(), // EIP-55 as saved
    label: text("label").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("address_book_owner_address_uq").on(t.owner, t.address)],
);

// ---------- payment requests (Stage 8b) ----------

/**
 * Fixed amount, paid once (locked decision). Status is derived when read: paid when a
 * transfer made from the request reached COMPLETED; otherwise open, expired or cancelled.
 */
export const paymentRequests = sqliteTable(
  "payment_requests",
  {
    id: text("id").primaryKey(),
    creator: text("creator")
      .notNull()
      .references(() => accounts.address), // lowercase; also the payee
    payeeId: text("payee_id"), // creator's Confluence ID at creation, for display
    destinationChain: text("destination_chain").notNull(),
    amountBase: text("amount_base").notNull(), // USDC the payee must receive (estimated)
    memo: text("memo"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("payment_requests_creator_idx").on(t.creator)],
);
