import { getEnv, type Platform } from "@/lib/server";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findStringField(value: unknown, key: string, depth = 0): string | null {
  if (depth > 5 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringField(item, key, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isJsonObject(value)) return null;
  if (typeof value[key] === "string") return value[key] as string;
  for (const nested of Object.values(value)) {
    const found = findStringField(nested, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function findRelationId(value: unknown, relationKey: string, depth = 0): string | null {
  if (depth > 5 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRelationId(item, relationKey, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isJsonObject(value)) return null;
  const relation = value[relationKey];
  if (typeof relation === "string") return relation;
  if (isJsonObject(relation)) {
    if (typeof relation.id === "string") return relation.id;
    const nestedId = findStringField(relation, "id", depth + 1);
    if (nestedId) return nestedId;
  }
  for (const nested of Object.values(value)) {
    const found = findRelationId(nested, relationKey, depth + 1);
    if (found) return found;
  }
  return null;
}

export type NormalizedPhylloAccount = {
  id: string | null;
  userId: string | null;
  workPlatformId: string | null;
  status: string;
};

export function normalizePhylloAccount(value: unknown, expectedAccountId?: string): NormalizedPhylloAccount {
  const outer = isJsonObject(value) ? value : {};
  const discoveredAccountId = findStringField(outer, "account_id") ?? findStringField(outer, "id");
  return {
    id: expectedAccountId && JSON.stringify(outer).includes(expectedAccountId) ? expectedAccountId : discoveredAccountId,
    userId: findStringField(outer, "user_id") ?? findRelationId(outer, "user"),
    workPlatformId: findStringField(outer, "work_platform_id") ?? findRelationId(outer, "work_platform"),
    status: findStringField(outer, "status") ?? "",
  };
}

export function phylloEnvironment(): "sandbox" | "staging" | "production" {
  const environment = getEnv("PHYLLO_ENVIRONMENT");
  if (environment === "production" || environment === "staging") return environment;
  return "sandbox";
}

function phylloBaseUrl(): string {
  const environment = phylloEnvironment();
  if (environment === "production") return "https://api.getphyllo.com";
  if (environment === "staging") return "https://api.staging.getphyllo.com";
  return "https://api.sandbox.getphyllo.com";
}

function phylloAuth(): string {
  const clientId = getEnv("PHYLLO_CLIENT_ID");
  const clientSecret = getEnv("PHYLLO_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Phyllo verification is awaiting provider credentials.");
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

export async function phylloRequest(path: string, init: RequestInit = {}): Promise<JsonObject> {
  const headers = new Headers(init.headers);
  headers.set("authorization", phylloAuth());
  headers.set("accept", "application/json");
  if (init.body) headers.set("content-type", "application/json");
  const response = await fetch(`${phylloBaseUrl()}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Phyllo request failed (${response.status}).`;
    throw new Error(message);
  }
  return payload;
}

export async function findPhylloWorkPlatform(platform: Platform): Promise<string> {
  const label = platform === "instagram" ? "Instagram Direct" : "TikTok";
  const payload = await phylloRequest(`/v1/work-platforms?limit=100&name=${encodeURIComponent(label)}`);
  const records = Array.isArray(payload.data) ? payload.data as JsonObject[] : [];
  const match = records.find((record) => String(record.name ?? "").toLowerCase() === label.toLowerCase())
    ?? records.find((record) => String(record.name ?? "").toLowerCase().includes(platform));
  if (!match || typeof match.id !== "string") throw new Error(`${label} is unavailable in the configured Phyllo environment.`);
  return match.id;
}

export type PhylloIdentity = {
  accountId: string;
  platformUserId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
};

export async function retrievePhylloIdentity(accountId: string, expectedUserId: string, expectedPlatformId: string): Promise<PhylloIdentity | null> {
  const accountPayload = await phylloRequest(`/v1/accounts/${encodeURIComponent(accountId)}`);
  let account = normalizePhylloAccount(accountPayload, accountId);
  if (account.id !== accountId || (account.userId && account.userId !== expectedUserId) || (account.workPlatformId && account.workPlatformId !== expectedPlatformId)) {
    const accountsPayload = await phylloRequest(`/v1/accounts?limit=100&user_id=${encodeURIComponent(expectedUserId)}&work_platform_id=${encodeURIComponent(expectedPlatformId)}`);
    const accounts = Array.isArray(accountsPayload.data) ? accountsPayload.data.map(normalizePhylloAccount) : [];
    account = accounts.find((candidate) => candidate.id === accountId) ?? account;
  }
  if (account.id !== accountId || (account.userId && account.userId !== expectedUserId) || (account.workPlatformId && account.workPlatformId !== expectedPlatformId)) {
    console.error(JSON.stringify({
      event: "phyllo_account_record_mismatch",
      accountIdMatches: account.id === accountId,
      userIdMatches: account.userId === expectedUserId,
      workPlatformIdMatches: account.workPlatformId === expectedPlatformId,
      accountIdPresent: Boolean(account.id),
      userIdPresent: Boolean(account.userId),
      workPlatformIdPresent: Boolean(account.workPlatformId),
    }));
    throw new Error("Phyllo returned an account record that did not match this verification session.");
  }
  const payload = await phylloRequest(`/v1/profiles?limit=10&account_id=${encodeURIComponent(accountId)}&user_id=${encodeURIComponent(expectedUserId)}&work_platform_id=${encodeURIComponent(expectedPlatformId)}`);
  const profiles = Array.isArray(payload.data) ? payload.data as JsonObject[] : [];
  const profile = profiles.find((item) => item.account_id === accountId) ?? profiles[0];
  if (!profile) return null;
  const username = typeof profile.platform_username === "string" ? profile.platform_username : typeof profile.username === "string" ? profile.username : null;
  const platformUserId = typeof profile.external_id === "string" ? profile.external_id : typeof profile.id === "string" ? profile.id : null;
  if (!username || !platformUserId) return null;
  return {
    accountId,
    platformUserId,
    username,
    displayName: typeof profile.full_name === "string" ? profile.full_name : typeof profile.platform_profile_name === "string" ? profile.platform_profile_name : undefined,
    avatarUrl: typeof profile.image_url === "string" ? profile.image_url : typeof profile.profile_pic_url === "string" ? profile.profile_pic_url : undefined,
  };
}
