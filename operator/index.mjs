import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  parseAbiParameters,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const appUrl = required("PAYPONS_APP_URL").replace(/\/$/, "");
const secret = required("PAYPONS_OPERATOR_HMAC_SECRET");
const sitesBypassToken = process.env.PAYPONS_SITES_BYPASS_TOKEN?.trim();
const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim() || "https://rpc.mainnet.chain.robinhood.com";
const chain = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: 15_000, retryCount: 3 }) });
const privateKey = process.env.PAYPONS_OPERATOR_PRIVATE_KEY?.trim();
const account = privateKey ? privateKeyToAccount(privateKey) : null;
const walletClient = account ? createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 3 }) }) : null;
const factoryAddress = process.env.PAYPONS_VAULT_FACTORY_ADDRESS ? getAddress(process.env.PAYPONS_VAULT_FACTORY_ADDRESS) : null;
const devKey = process.env.PAYPONS_DEV_BUYBACK_PRIVATE_KEY?.trim();
const devAccount = devKey ? privateKeyToAccount(devKey) : null;
const devWalletClient = devAccount ? createWalletClient({ account: devAccount, chain, transport: http(rpcUrl, { timeout: 20_000, retryCount: 3 }) }) : null;
const escrowAddress = getAddress(process.env.PONS_FEE_ESCROW || "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e");
const minCollectWei = BigInt(process.env.PAYPONS_MIN_COLLECT_WEI || "1");
const attestorKey = process.env.PAYPONS_CLAIM_ATTESTOR_PRIVATE_KEY?.trim();
const attestor = attestorKey ? privateKeyToAccount(attestorKey) : null;
const ponsToken = getAddress(process.env.PAYPONS_PONS_TOKEN || "0x39dBED3a2bd333467115dE45665cC57F813C4571");
const weth = getAddress(process.env.PAYPONS_WETH || "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const swapRouter = getAddress(process.env.PAYPONS_SWAP_ROUTER || "0xCaf681a66D020601342297493863E78C959E5cb2");
const quoter = getAddress(process.env.PAYPONS_QUOTER || "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7");
const ponsPoolFee = Number(process.env.PAYPONS_PONS_POOL_FEE || "10000");
const launchFactoryAddress = getAddress(process.env.PONS_LAUNCH_FACTORY || "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
const pollMs = Math.max(5_000, Number(process.env.PAYPONS_POLL_MS || 15_000));
const state = { startedAt: new Date().toISOString(), lastCycleAt: null, lastSuccessAt: null, lastError: null, mode: factoryAddress && walletClient && attestor ? "active" : "audit", vaults: 0, collected: 0, claims: 0, reconciled: 0, syncedLots: 0 };
const syncedVaults = new Set();

const factoryAbi = parseAbi([
  "function vaultOfLaunch(bytes32 launchKey) view returns(address)",
  "function createVault(bytes32 launchKey,bytes32 creatorRouteKey) returns(address vault)",
  "function buybackBurner() view returns(address)",
]);
const escrowAbi = parseAbi(["function balanceOf(address recipient) view returns(uint256)", "function claim() returns(uint256 amount)"]);
const vaultAbi = parseAbi([
  "function collectNative() returns(uint256 lotId,uint256 received)",
  "function claim(uint256[] lotIds,uint256[] minimumBurnTokensOut,bytes[] swapData,uint256 nonce,uint256 authorizationDeadline,bytes authorization)",
  "function withdraw(address asset,uint256 amount,address recipient,uint256 nonce,uint256 authorizationDeadline,bytes authorization)",
  "function expire(uint256[] lotIds,uint256[] minimumBurnTokensOut,bytes[] swapData)",
  "event LotCreated(uint256 indexed lotId,address indexed asset,uint256 amount,uint256 claimDeadline)",
  "function routesBuybackToTreasury() view returns(bool)",
]);
const launchFactoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "function launchToken(TokenParams params,uint256 launchConfigId,address pairToken) payable returns(address token,address curve)",
]);
const tokenLaunchedEvent = parseAbiItem("event TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold)");
const lotCreatedEvent = parseAbiItem("event LotCreated(uint256 indexed lotId,address indexed asset,uint256 amount,uint256 claimDeadline)");
const quoterAbi = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns(uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"]);
const routerAbi = parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns(uint256 amountOut)"]);

function signature(raw) {
  return createHmac("sha256", secret).update(raw).digest("hex");
}

async function signedPost(path, body) {
  const raw = JSON.stringify(body);
  const response = await fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pons-signature": `sha256=${signature(raw)}`,
      ...(sitesBypassToken ? { "OAI-Sites-Authorization": `Bearer ${sitesBypassToken}` } : {}),
    },
    body: raw,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${data.error || "request failed"}`);
  return data;
}

async function provision(intent) {
  if (!factoryAddress || !walletClient) return intent.vaultAddress || null;
  let vault = await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "vaultOfLaunch", args: [intent.launchKey] });
  let txHash = `0x${"0".repeat(64)}`;
  if (vault === zeroAddress) {
    const request = await publicClient.simulateContract({ account, address: factoryAddress, abi: factoryAbi, functionName: "createVault", args: [intent.launchKey, intent.creatorRouteKey] });
    txHash = await walletClient.writeContract(request.request);
    await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2, timeout: 120_000 });
    vault = await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "vaultOfLaunch", args: [intent.launchKey] });
  }
  if (!intent.vaultAddress) await signedPost("/api/operator/sync", { action: "vault_provisioned", intentId: intent.intentId, vaultAddress: vault, txHash });
  return getAddress(vault);
}

async function reconcileLaunches(intents) {
  const candidates = new Map(
    intents
      .filter((intent) => intent.vaultAddress && !intent.tokenAddress && intent.status !== "pending")
      .map((intent) => [intent.vaultAddress.toLowerCase(), intent]),
  );
  if (!candidates.size) return;
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 6_000n ? latest - 6_000n : 0n;
  const logs = await publicClient.getLogs({ address: launchFactoryAddress, event: tokenLaunchedEvent, fromBlock, toBlock: "latest" });
  for (const log of logs.reverse()) {
    if (!log.transactionHash || !log.args.token) continue;
    const transaction = await publicClient.getTransaction({ hash: log.transactionHash });
    let decoded;
    try { decoded = decodeFunctionData({ abi: launchFactoryAbi, data: transaction.input }); }
    catch { continue; }
    if (decoded.functionName !== "launchToken") continue;
    const params = decoded.args[0];
    const intent = candidates.get(params.creatorFeeRecipient.toLowerCase());
    if (!intent || Number(params.creatorTaxBps) !== 400) continue;
    await signedPost("/api/operator/sync", {
      action: "launch_reconciled",
      intentId: intent.intentId,
      tokenAddress: log.args.token,
      vaultAddress: params.creatorFeeRecipient,
      launcherAddress: transaction.from,
      launchTxHash: log.transactionHash,
      name: params.name,
      symbol: params.symbol,
      logoUrl: params.logo,
      description: params.description,
    });
    intent.tokenAddress = log.args.token;
    intent.launchLinkId = "reconciled";
    candidates.delete(params.creatorFeeRecipient.toLowerCase());
    state.reconciled += 1;
  }
}

async function syncVaultLots(intent, vaultAddress) {
  if (!vaultAddress || !intent.launchLinkId || !intent.tokenAddress || syncedVaults.has(vaultAddress.toLowerCase())) return;
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 6_000n ? latest - 6_000n : 0n;
  const logs = await publicClient.getLogs({ address: vaultAddress, event: lotCreatedEvent, fromBlock, toBlock: "latest" });
  for (const log of logs) {
    if (!log.transactionHash || log.logIndex === null || !log.args.lotId || !log.args.amount || !log.args.claimDeadline) continue;
    await signedPost("/api/fees/ingest", {
      routeId: intent.routeId,
      launchLinkId: intent.launchLinkId,
      tokenAddress: intent.tokenAddress,
      chainId: 4663,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      assetAddress: log.args.asset === zeroAddress ? "native" : log.args.asset,
      amountRaw: log.args.amount.toString(),
      onchainLotId: log.args.lotId.toString(),
      claimDeadlineUnix: log.args.claimDeadline.toString(),
    });
    state.syncedLots += 1;
  }
  syncedVaults.add(vaultAddress.toLowerCase());
}

async function collectNative(intent, vaultAddress) {
  if (!walletClient || !vaultAddress || !intent.launchLinkId || !intent.tokenAddress) return;
  const owed = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "balanceOf", args: [vaultAddress] });
  if (owed < minCollectWei) return;
  const request = await publicClient.simulateContract({ account, address: vaultAddress, abi: vaultAbi, functionName: "collectNative" });
  const hash = await walletClient.writeContract(request.request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== vaultAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "LotCreated") continue;
      await signedPost("/api/fees/ingest", {
        routeId: intent.routeId,
        launchLinkId: intent.launchLinkId,
        tokenAddress: intent.tokenAddress,
        chainId: 4663,
        txHash: hash,
        logIndex: log.logIndex,
        assetAddress: "native",
        amountRaw: decoded.args.amount.toString(),
        onchainLotId: decoded.args.lotId.toString(),
        claimDeadlineUnix: decoded.args.claimDeadline.toString(),
      });
      state.collected += 1;
    } catch {}
  }
}

async function processClaim(requestId, rows) {
  if (!walletClient || !attestor || !factoryAddress || !rows.length) return;
  const vault = getAddress(rows[0].vaultAddress);
  if (rows.some((row) => row.vaultAddress.toLowerCase() !== vault.toLowerCase() || row.assetAddress !== "native")) return;
  let treasuryMode = false;
  try { treasuryMode = await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "routesBuybackToTreasury" }); } catch {}
  const burner = treasuryMode ? null : getAddress(await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "buybackBurner" }));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const lotIds = [], minimumOut = [], swapData = [];
  for (const row of rows) {
    const amountIn = BigInt(row.amountRaw) * 2_000n / 10_000n;
    if (treasuryMode) { lotIds.push(BigInt(row.lotId)); minimumOut.push(0n); swapData.push("0x"); continue; }
    const quote = await publicClient.simulateContract({
      account,
      address: quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn: weth, tokenOut: ponsToken, amountIn, fee: ponsPoolFee, sqrtPriceLimitX96: 0n }],
    });
    const quoted = quote.result[0];
    const floor = quoted * 95n / 100n;
    lotIds.push(BigInt(row.lotId));
    minimumOut.push(floor);
    swapData.push(encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [{ tokenIn: weth, tokenOut: ponsToken, fee: ponsPoolFee, recipient: burner, amountIn, amountOutMinimum: floor, sqrtPriceLimitX96: 0n }],
    }));
  }
  const executionHash = keccak256(encodeAbiParameters(parseAbiParameters("uint256[], uint256[], bytes[]"), [lotIds, minimumOut, swapData]));
  const nonce = BigInt(`0x${randomBytes(12).toString("hex")}`);
  const authorization = await attestor.signTypedData({
    domain: { name: "PONSPAY", version: "1", chainId: 4663, verifyingContract: vault },
    types: { ClaimAuthorization: [
      { name: "vault", type: "address" }, { name: "executionHash", type: "bytes32" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "ClaimAuthorization",
    message: { vault, executionHash, nonce, deadline },
  });
  const request = await publicClient.simulateContract({ account, address: vault, abi: vaultAbi, functionName: "claim", args: [lotIds, minimumOut, swapData, nonce, deadline, authorization] });
  const hash = await walletClient.writeContract(request.request);
  await signedPost("/api/operator/sync", { action: "claim_submitted", requestId, txHash: hash });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  await signedPost("/api/operator/sync", { action: "claim_confirmed", requestId, batchIds: rows.map((row) => row.batchId), txHash: hash, ...(treasuryMode ? { buybackAmountRaw: rows.reduce((sum, row) => sum + BigInt(row.amountRaw) * 2_000n / 10_000n, 0n).toString() } : {}) });
  state.claims += 1;
}

async function processBuyback(job) {
  if (!devWalletClient || !devAccount) return;
  const amountIn = BigInt(job.amountRaw);
  const quote = await publicClient.simulateContract({ account: devAccount, address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: weth, tokenOut: ponsToken, amountIn, fee: ponsPoolFee, sqrtPriceLimitX96: 0n }] });
  const floor = quote.result[0] * 95n / 100n;
  const request = await publicClient.simulateContract({ account: devAccount, address: swapRouter, abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: weth, tokenOut: ponsToken, fee: ponsPoolFee, recipient: "0x000000000000000000000000000000000000dEaD", amountIn, amountOutMinimum: floor, sqrtPriceLimitX96: 0n }], value: amountIn });
  const hash = await devWalletClient.writeContract(request.request);
  await signedPost("/api/operator/sync", { action: "buyback_submitted", id: job.id, txHash: hash });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  await signedPost("/api/operator/sync", { action: "buyback_confirmed", id: job.id, txHash: hash });
}

async function collectOfficialFees() {
  if (!devWalletClient || !devAccount) return;
  const owed = await publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "balanceOf", args: [devAccount.address] });
  if (owed < minCollectWei) return;
  const request = await publicClient.simulateContract({ account: devAccount, address: escrowAddress, abi: escrowAbi, functionName: "claim" });
  const hash = await devWalletClient.writeContract(request.request);
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  const buybackAmount = owed * 500n / 10_000n;
  if (buybackAmount > 0n) await signedPost("/api/operator/sync", { action: "official_fees_collected", txHash: hash, buybackAmountRaw: buybackAmount.toString() });
}

async function processWithdrawal(row) {
  if (!walletClient || !attestor || !row.vaultAddress) return;
  const vault = getAddress(row.vaultAddress);
  const asset = row.assetAddress === "native" ? zeroAddress : getAddress(row.assetAddress);
  const recipient = getAddress(row.recipientAddress);
  const amount = BigInt(row.amountRaw);
  const nonce = BigInt(`0x${randomBytes(12).toString("hex")}`);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
  const authorization = await attestor.signTypedData({
    domain: { name: "PONSPAY", version: "1", chainId: 4663, verifyingContract: vault },
    types: { WithdrawAuthorization: [
      { name: "vault", type: "address" }, { name: "asset", type: "address" },
      { name: "amount", type: "uint256" }, { name: "recipient", type: "address" },
      { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
    ] },
    primaryType: "WithdrawAuthorization",
    message: { vault, asset, amount, recipient, nonce, deadline },
  });
  const request = await publicClient.simulateContract({ account, address: vault, abi: vaultAbi, functionName: "withdraw", args: [asset, amount, recipient, nonce, deadline, authorization] });
  const hash = await walletClient.writeContract(request.request);
  await signedPost("/api/operator/sync", { action: "withdrawal_submitted", id: row.id, txHash: hash });
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  await signedPost("/api/operator/sync", { action: "withdrawal_confirmed", id: row.id, txHash: hash });
}

async function processExpiry(rows) {
  if (!walletClient || !factoryAddress || !rows.length) return;
  const vault = getAddress(rows[0].vaultAddress);
  if (rows.some((row) => row.vaultAddress.toLowerCase() !== vault.toLowerCase() || row.assetAddress !== "native")) return;
  const burner = getAddress(await publicClient.readContract({ address: factoryAddress, abi: factoryAbi, functionName: "buybackBurner" }));
  const lotIds = [], minimumOut = [], swapData = [];
  for (const row of rows) {
    const amountIn = BigInt(row.amountRaw) * 5_000n / 10_000n;
    const quote = await publicClient.simulateContract({ account, address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: weth, tokenOut: ponsToken, amountIn, fee: ponsPoolFee, sqrtPriceLimitX96: 0n }] });
    const floor = quote.result[0] * 95n / 100n;
    lotIds.push(BigInt(row.lotId)); minimumOut.push(floor);
    swapData.push(encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: weth, tokenOut: ponsToken, fee: ponsPoolFee, recipient: burner, amountIn, amountOutMinimum: floor, sqrtPriceLimitX96: 0n }] }));
  }
  const request = await publicClient.simulateContract({ account, address: vault, abi: vaultAbi, functionName: "expire", args: [lotIds, minimumOut, swapData] });
  const hash = await walletClient.writeContract(request.request);
  await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 120_000 });
  await signedPost("/api/operator/sync", { action: "expiry_confirmed", batchIds: rows.map((row) => row.batchId), txHash: hash });
}

async function cycle() {
  state.lastCycleAt = new Date().toISOString();
  const snapshot = await signedPost("/api/operator/sync", { action: "state", timestamp: Date.now() });
  state.vaults = snapshot.intents?.length || 0;
  for (const intent of snapshot.intents || []) {
    const vault = await provision(intent);
    intent.vaultAddress = vault;
  }
  await collectOfficialFees();
  await reconcileLaunches(snapshot.intents || []);
  for (const intent of snapshot.intents || []) {
    const vault = intent.vaultAddress;
    await syncVaultLots(intent, vault);
    await collectNative(intent, vault);
  }
  const groupedClaims = new Map();
  for (const row of snapshot.claimBatches || []) {
    const rows = groupedClaims.get(row.requestId) || [];
    rows.push(row);
    groupedClaims.set(row.requestId, rows);
  }
  for (const [requestId, rows] of groupedClaims) {
    try { await processClaim(requestId, rows); }
    catch (error) { console.error(JSON.stringify({ event: "claim_execution_failed", requestId, error: String(error) })); }
  }
  for (const job of snapshot.buybacks || []) {
    try { await processBuyback(job); }
    catch (error) { console.error(JSON.stringify({ event: "buyback_execution_failed", id: job.id, error: String(error) })); }
  }
  for (const withdrawal of snapshot.withdrawals || []) {
    try { await processWithdrawal(withdrawal); }
    catch (error) { console.error(JSON.stringify({ event: "withdrawal_execution_failed", id: withdrawal.id, error: String(error) })); }
  }
  const groupedExpiries = new Map();
  for (const row of snapshot.expiredBatches || []) {
    const key = row.vaultAddress.toLowerCase(); const rows = groupedExpiries.get(key) || []; rows.push(row); groupedExpiries.set(key, rows);
  }
  for (const rows of groupedExpiries.values()) {
    try { await processExpiry(rows); }
    catch (error) { console.error(JSON.stringify({ event: "expiry_execution_failed", vaultAddress: rows[0]?.vaultAddress, error: String(error) })); }
  }
  state.lastSuccessAt = new Date().toISOString();
  state.lastError = null;
}

createServer((request, response) => {
  if (request.url !== "/health") { response.writeHead(404).end(); return; }
  response.writeHead(state.lastError ? 503 : 200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: !state.lastError, ...state, signer: account?.address || null, attestor: attestor?.address || null, factoryAddress, escrowAddress }));
}).listen(Number(process.env.PORT || 8799), "127.0.0.1");

for (;;) {
  try { await cycle(); }
  catch (error) { state.lastError = String(error); console.error(JSON.stringify({ event: "operator_cycle_failed", error: state.lastError })); }
  await new Promise((resolve) => setTimeout(resolve, pollMs));
}
