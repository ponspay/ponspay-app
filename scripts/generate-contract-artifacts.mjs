import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import solc from "solc";

const root = new URL("../", import.meta.url).pathname;
const files = ["CreatorFeeVaultFactory.sol", "CreatorFeeVault.sol", "PonsBuybackBurner.sol"];
const sources = Object.fromEntries(files.map((file) => [file, {
  content: readFileSync(path.join(root, "contracts", file), "utf8"),
}]));
const output = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
}), { import: (requested) => {
  for (const candidate of [path.join(root, "contracts", requested), path.join(root, "node_modules", requested)]) {
    try { return { contents: readFileSync(candidate, "utf8") }; } catch {}
  }
  return { error: `Import not found: ${requested}` };
} }));

const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length) throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
const artifact = (file, name) => ({
  abi: output.contracts[file][name].abi,
  bytecode: `0x${output.contracts[file][name].evm.bytecode.object}`,
});
writeFileSync(process.argv[2] ?? "/private/tmp/ponspay-contracts.json", JSON.stringify({
  burner: artifact("PonsBuybackBurner.sol", "PonsBuybackBurner"),
  factory: artifact("CreatorFeeVaultFactory.sol", "CreatorFeeVaultFactory"),
}));
