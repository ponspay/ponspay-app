import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ganache from "ganache";
import solc from "solc";
import {
  createPublicClient, createWalletClient, custom, encodeAbiParameters, encodeFunctionData, encodePacked,
  getAddress, keccak256, parseAbiParameters, stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const root = new URL("../", import.meta.url);

function compile() {
  const sources = {};
  for (const file of ["CreatorFeeVaultFactory.sol", "CreatorFeeVault.sol", "PonsBuybackBurner.sol", "test/Mocks.sol"]) {
    sources[file] = { content: readFileSync(new URL(`../contracts/${file}`, import.meta.url), "utf8") };
  }
  const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "shanghai", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (path) => {
    for (const candidate of [new URL(`../contracts/${path}`, import.meta.url), new URL(`../node_modules/${path}`, import.meta.url)]) {
      try { return { contents: readFileSync(candidate, "utf8") }; } catch { /* next */ }
    }
    return { error: `Import not found: ${path}` };
  } }));
  const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
  assert.deepEqual(errors, [], errors.map((entry) => entry.formattedMessage).join("\n"));
  return output.contracts;
}

function artifact(contracts, file, name) {
  const value = contracts[file][name];
  return { abi: value.abi, bytecode: `0x${value.evm.bytecode.object}` };
}

test("creator claim retains 80%, routes 20% to buyback treasury, and expiry sends 50/50", async () => {
  const provider = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337 }, wallet: { totalAccounts: 7, defaultBalance: 1000 } });
  const initial = provider.getInitialAccounts();
  const accounts = Object.values(initial).map((value) => privateKeyToAccount(value.secretKey));
  const [owner, attestor, treasury, relayer, recipient] = accounts;
  const transport = custom(provider);
  const publicClient = createPublicClient({ transport });
  const ownerWallet = createWalletClient({ account: owner, transport });
  const relayerWallet = createWalletClient({ account: relayer, transport });
  const contracts = compile();

  async function deploy(file, name, args = []) {
    const value = artifact(contracts, file, name);
    const hash = await ownerWallet.deployContract({ ...value, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { address: receipt.contractAddress, abi: value.abi };
  }

  const official = await deploy("test/Mocks.sol", "MockERC20", ["Official PONS", "PONS"]);
  const pair = await deploy("test/Mocks.sol", "MockERC20", ["Pair", "PAIR"]);
  const escrow = await deploy("test/Mocks.sol", "MockFeeEscrow");
  const router = await deploy("test/Mocks.sol", "MockSwapRouter", [official.address]);
  const burner = await deploy("PonsBuybackBurner.sol", "PonsBuybackBurner", [official.address, router.address]);
  const factory = await deploy("CreatorFeeVaultFactory.sol", "CreatorFeeVaultFactory", [owner.address, escrow.address, attestor.address, owner.address, burner.address, treasury.address, owner.address]);
  const creatorRouteKey = keccak256(stringToBytes("instagram:creator"));
  const launchKey = keccak256(stringToBytes("launch:one"));
  const secondLaunchKey = keccak256(stringToBytes("launch:two"));
  const launcherSalt = keccak256(stringToBytes("launcher:salt"));
  const launcherLaunchKey = keccak256(encodePacked(
    ["string", "bytes32", "address", "bytes32"],
    ["PONSPAY_LAUNCH", creatorRouteKey, relayer.address, launcherSalt],
  ));
  await assert.rejects(relayerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVault", args: [launchKey, creatorRouteKey] }));
  await assert.rejects(relayerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVaultForLauncher", args: [launcherLaunchKey, creatorRouteKey, keccak256(stringToBytes("wrong:salt"))] }));
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVaultForLauncher", args: [launcherLaunchKey, creatorRouteKey, launcherSalt] }) });
  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVault", args: [launchKey, creatorRouteKey] }) });
  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVault", args: [secondLaunchKey, creatorRouteKey] }) });
  const vault = getAddress(await publicClient.readContract({ address: factory.address, abi: factory.abi, functionName: "vaultOfLaunch", args: [launchKey] }));
  const secondVault = getAddress(await publicClient.readContract({ address: factory.address, abi: factory.abi, functionName: "vaultOfLaunch", args: [secondLaunchKey] }));
  const launcherVault = getAddress(await publicClient.readContract({ address: factory.address, abi: factory.abi, functionName: "vaultOfLaunch", args: [launcherLaunchKey] }));
  assert.notEqual(vault, secondVault, "each launch must receive a separate vault");
  assert.notEqual(launcherVault, secondVault, "a user-paid launch must receive its own vault");
  assert.equal(await publicClient.readContract({ address: launcherVault, abi: artifact(contracts, "CreatorFeeVault.sol", "CreatorFeeVault").abi, functionName: "creatorRouteKey" }), creatorRouteKey);
  assert.equal(await publicClient.readContract({ address: secondVault, abi: artifact(contracts, "CreatorFeeVault.sol", "CreatorFeeVault").abi, functionName: "creatorRouteKey" }), creatorRouteKey);
  await assert.rejects(ownerWallet.writeContract({ address: factory.address, abi: factory.abi, functionName: "createVault", args: [launchKey, creatorRouteKey] }));
  const vaultAbi = artifact(contracts, "CreatorFeeVault.sol", "CreatorFeeVault").abi;

  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: official.address, abi: official.abi, functionName: "mint", args: [router.address, 10_000n] }) });
  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: pair.address, abi: pair.abi, functionName: "mint", args: [owner.address, 2_000n] }) });
  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: pair.address, abi: pair.abi, functionName: "approve", args: [escrow.address, 2_000n] }) });

  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: escrow.address, abi: escrow.abi, functionName: "fundToken", args: [vault, pair.address, 1_000n] }) });
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: vault, abi: vaultAbi, functionName: "collectToken", args: [pair.address] }) });
  const swap200 = encodeFunctionData({ abi: router.abi, functionName: "swapToken", args: [pair.address, 200n] });
  const executionHash = keccak256(encodeAbiParameters(parseAbiParameters("uint256[], uint256[], bytes[]"), [[1n], [200n], [swap200]]));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const claimSignature = await attestor.signTypedData({
    domain: { name: "PONSPAY", version: "1", chainId: 1337, verifyingContract: vault },
    types: { ClaimAuthorization: [{ name: "vault", type: "address" }, { name: "executionHash", type: "bytes32" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "ClaimAuthorization", message: { vault, executionHash, nonce: 1n, deadline },
  });
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: vault, abi: vaultAbi, functionName: "claim", args: [[1n], [200n], [swap200], 1n, deadline, claimSignature] }) });
  assert.equal(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "creatorBalances", args: [pair.address] }), 800n);
  assert.equal(await publicClient.readContract({ address: pair.address, abi: pair.abi, functionName: "balanceOf", args: [owner.address] }), 1_200n, "20% must reach the configured buyback treasury");

  const withdrawDeadline = deadline + 1n;
  const withdrawSignature = await attestor.signTypedData({
    domain: { name: "PONSPAY", version: "1", chainId: 1337, verifyingContract: vault },
    types: { WithdrawAuthorization: [{ name: "vault", type: "address" }, { name: "asset", type: "address" }, { name: "amount", type: "uint256" }, { name: "recipient", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "WithdrawAuthorization", message: { vault, asset: pair.address, amount: 300n, recipient: recipient.address, nonce: 2n, deadline: withdrawDeadline },
  });
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: vault, abi: vaultAbi, functionName: "withdraw", args: [pair.address, 300n, recipient.address, 2n, withdrawDeadline, withdrawSignature] }) });
  assert.equal(await publicClient.readContract({ address: pair.address, abi: pair.abi, functionName: "balanceOf", args: [recipient.address] }), 300n);
  assert.equal(await publicClient.readContract({ address: vault, abi: vaultAbi, functionName: "creatorBalances", args: [pair.address] }), 500n);

  await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: escrow.address, abi: escrow.abi, functionName: "fundToken", args: [vault, pair.address, 1_000n] }) });
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: vault, abi: vaultAbi, functionName: "collectToken", args: [pair.address] }) });
  await provider.request({ method: "evm_increaseTime", params: [48 * 3600 + 1] });
  await provider.request({ method: "evm_mine", params: [] });
  const swap500 = encodeFunctionData({ abi: router.abi, functionName: "swapToken", args: [pair.address, 500n] });
  await publicClient.waitForTransactionReceipt({ hash: await relayerWallet.writeContract({ address: vault, abi: vaultAbi, functionName: "expire", args: [[2n], [500n], [swap500]] }) });
  assert.equal(await publicClient.readContract({ address: pair.address, abi: pair.abi, functionName: "balanceOf", args: [treasury.address] }), 500n);
  assert.equal(await publicClient.readContract({ address: official.address, abi: official.abi, functionName: "balanceOf", args: [DEAD] }), 500n);
});
