import { db, getEnv, json, normalizeHash } from "@/lib/server";
import { createPublicClient, getAddress, http, parseAbi, zeroAddress } from "viem";

const vaultFactoryAbi = parseAbi(["function vaultOfLaunch(bytes32 launchKey) view returns(address)"]);

export async function GET(_request: Request, context: { params: Promise<{ intentId: string }> }) {
  const { intentId } = await context.params;
  const intent = await db().prepare(
    `SELECT i.id AS intentId, i.route_id AS routeId, i.chain_id AS chainId, i.launch_key AS launchKey,
      i.vault_address AS vaultAddress, i.vault_tx_hash AS vaultTxHash, i.status, i.expires_at AS expiresAt,
      r.platform, r.normalized_handle AS handle
     FROM launch_intents i JOIN creator_routes r ON r.id = i.route_id WHERE i.id = ? LIMIT 1`
  ).bind(intentId).first();
  return intent ? json(intent) : json({ error: "Launch intent not found." }, { status: 404 });
}

export async function POST(request: Request, context: { params: Promise<{ intentId: string }> }) {
  try {
    const { intentId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const txHash = normalizeHash(body.txHash);
    if (!txHash) return json({ error: "A valid vault transaction is required." }, { status: 400 });
    const intent = await db().prepare(
      `SELECT id AS intentId, launch_key AS launchKey, status, expires_at AS expiresAt
       FROM launch_intents WHERE id = ? LIMIT 1`
    ).bind(intentId).first<{ intentId: string; launchKey: `0x${string}`; status: string; expiresAt: string }>();
    if (!intent) return json({ error: "Launch intent not found." }, { status: 404 });
    if (new Date(intent.expiresAt).getTime() <= Date.now()) return json({ error: "The launch intent expired. Start again." }, { status: 410 });
    const configuredFactory = getEnv("VAULT_FACTORY_ADDRESS");
    if (!configuredFactory) return json({ error: "Vault factory is not configured." }, { status: 503 });
    const factory = getAddress(configuredFactory);
    const rpc = getEnv("ROBINHOOD_RPC_URL") ?? "https://rpc.mainnet.chain.robinhood.com";
    const client = createPublicClient({ transport: http(rpc, { timeout: 12_000, retryCount: 2 }) });
    const [receipt, vaultAddress] = await Promise.all([
      client.getTransactionReceipt({ hash: txHash }),
      client.readContract({ address: factory, abi: vaultFactoryAbi, functionName: "vaultOfLaunch", args: [intent.launchKey] }),
    ]);
    if (receipt.status !== "success" || !receipt.logs.some((log) => log.address.toLowerCase() === factory.toLowerCase()) || vaultAddress === zeroAddress) {
      return json({ error: "The vault transaction is not confirmed." }, { status: 409 });
    }
    await db().prepare(
      `UPDATE launch_intents SET vault_address = ?, vault_tx_hash = ?, status = 'vault_ready'
       WHERE id = ? AND status IN ('pending','vault_ready')`
    ).bind(vaultAddress.toLowerCase(), txHash, intentId).run();
    return json({ intentId, launchKey: intent.launchKey, vaultAddress, vaultTxHash: txHash, status: "vault_ready" });
  } catch (error) {
    console.error(JSON.stringify({ event: "launcher_vault_confirmation_failed", error: String(error) }));
    return json({ error: "The vault transaction could not be confirmed." }, { status: 400 });
  }
}
