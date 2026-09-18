import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const creatorRoutes = sqliteTable("creator_routes", {
  id: text("id").primaryKey(),
  platform: text("platform", { enum: ["instagram", "tiktok"] }).notNull(),
  normalizedHandle: text("normalized_handle").notNull(),
  platformUserId: text("platform_user_id"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  status: text("status", { enum: ["pending", "verified", "disputed", "disabled"] }).notNull().default("pending"),
  vaultKey: text("vault_key").notNull(),
  vaultAddress: text("vault_address"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  verifiedAt: text("verified_at"),
}, (table) => [
  uniqueIndex("idx_creator_routes_platform_handle").on(table.platform, table.normalizedHandle),
  uniqueIndex("idx_creator_routes_vault_key").on(table.vaultKey),
  uniqueIndex("idx_creator_routes_platform_user").on(table.platform, table.platformUserId),
]);

export const launchIntents = sqliteTable("launch_intents", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  chainId: integer("chain_id").notNull(),
  launchKey: text("launch_key").notNull(),
  vaultAddress: text("vault_address"),
  vaultTxHash: text("vault_tx_hash"),
  status: text("status", { enum: ["pending", "vault_ready", "launched", "expired", "failed"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
  finalizedAt: text("finalized_at"),
}, (table) => [
  uniqueIndex("idx_launch_intents_launch_key").on(table.launchKey),
  index("idx_launch_intents_status").on(table.status, table.expiresAt),
  index("idx_launch_intents_route").on(table.routeId),
]);

export const launchLinks = sqliteTable("launch_links", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  tokenAddress: text("token_address").notNull(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  launchIntentId: text("launch_intent_id").references(() => launchIntents.id),
  vaultKey: text("vault_key"),
  vaultAddress: text("vault_address"),
  vaultTxHash: text("vault_tx_hash"),
  name: text("name"),
  symbol: text("symbol"),
  logoUrl: text("logo_url"),
  description: text("description"),
  launcherAddress: text("launcher_address"),
  status: text("status", { enum: ["draft", "submitted", "live", "failed"] }).notNull().default("live"),
  creatorFeeBps: integer("creator_fee_bps").notNull().default(400),
  creatorShareBps: integer("creator_share_bps").notNull().default(8000),
  burnShareBps: integer("burn_share_bps").notNull().default(2000),
  launchTxHash: text("launch_tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_launch_links_chain_token").on(table.chainId, table.tokenAddress),
  index("idx_launch_links_route").on(table.routeId),
]);

export const feeBatches = sqliteTable("fee_batches", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  launchLinkId: text("launch_link_id").references(() => launchLinks.id),
  chainId: integer("chain_id").notNull(),
  txHash: text("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  assetAddress: text("asset_address").notNull(),
  amountRaw: text("amount_raw").notNull(),
  onchainLotId: text("onchain_lot_id"),
  claimDeadline: text("claim_deadline").notNull(),
  status: text("status", { enum: ["claimable", "claimed", "expired", "settling"] }).notNull().default("claimable"),
  payoutTxHash: text("payout_tx_hash"),
  burnTxHash: text("burn_tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
}, (table) => [
  uniqueIndex("idx_fee_batches_event").on(table.chainId, table.txHash, table.logIndex),
  index("idx_fee_batches_route_status").on(table.routeId, table.status),
  index("idx_fee_batches_launch_status").on(table.launchLinkId, table.status),
  index("idx_fee_batches_deadline_status").on(table.claimDeadline, table.status),
]);

export const withdrawalRequests = sqliteTable("withdrawal_requests", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  launchLinkId: text("launch_link_id").references(() => launchLinks.id),
  assetAddress: text("asset_address").notNull(),
  amountRaw: text("amount_raw").notNull(),
  recipientAddress: text("recipient_address").notNull(),
  status: text("status", { enum: ["pending", "submitted", "confirmed", "failed"] }).notNull().default("pending"),
  txHash: text("tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
}, (table) => [
  index("idx_withdrawal_requests_route_status").on(table.routeId, table.status),
]);

export const claimRequests = sqliteTable("claim_requests", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  launchLinkId: text("launch_link_id").notNull().references(() => launchLinks.id),
  status: text("status", { enum: ["pending", "submitted", "confirmed", "failed"] }).notNull().default("pending"),
  txHash: text("tx_hash"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
}, (table) => [
  index("idx_claim_requests_status").on(table.status, table.createdAt),
  index("idx_claim_requests_route").on(table.routeId, table.status),
]);

export const buybackJobs = sqliteTable("buyback_jobs", {
  id: text("id").primaryKey(),
  sourceType: text("source_type", { enum: ["creator_launch", "official_fees"] }).notNull(),
  sourceId: text("source_id").notNull(),
  amountRaw: text("amount_raw").notNull(),
  status: text("status", { enum: ["pending", "submitted", "confirmed", "failed"] }).notNull().default("pending"),
  txHash: text("tx_hash"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  settledAt: text("settled_at"),
}, (table) => [
  uniqueIndex("idx_buyback_jobs_source").on(table.sourceType, table.sourceId),
  index("idx_buyback_jobs_status").on(table.status, table.createdAt),
]);

export const oauthStates = sqliteTable("oauth_states", {
  state: text("state").primaryKey(),
  platform: text("platform", { enum: ["instagram", "tiktok"] }).notNull(),
  codeVerifier: text("code_verifier").notNull(),
  returnTo: text("return_to").notNull().default("/"),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const creatorSessions = sqliteTable("creator_sessions", {
  id: text("id").primaryKey(),
  routeId: text("route_id").notNull().references(() => creatorRoutes.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_creator_sessions_token_hash").on(table.tokenHash)]);
