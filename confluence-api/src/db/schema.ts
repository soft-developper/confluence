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
