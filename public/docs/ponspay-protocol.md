# PONSPAY Protocol

PONSPAY is a creator-linked launch layer for pons on Robinhood Chain. A launcher connects an EVM wallet, creates a pons token, and selects an Instagram or TikTok profile as the creator fee recipient. The creator can verify the linked profile later, claim into a PONSPAY vault balance, and withdraw to any EVM wallet.

## Launch lifecycle

1. The launcher enters token metadata and the intended creator profile.
2. PONSPAY derives the profile route and creates a fresh deterministic vault for this launch.
3. The launcher reads live pons launch eligibility, enabled configuration, launch fee, and pinned economics directly from the pons v2 factory.
4. The launcher signs the `launchToken` transaction in their own wallet. PONSPAY never takes custody of launch funds.
5. The confirmed token, transaction, launcher, and creator route appear in discovery.
6. Creator fees accrue to the linked vault in the launch's quote asset.

## Creator lifecycle

1. The creator signs in with the Instagram or TikTok account linked at launch.
2. PONSPAY verifies the platform user ID and username through OAuth.
3. The profile name and profile picture are cached so expiring social-media image URLs do not break the route.
4. Claiming within 48 hours credits 80% to the creator's PONSPAY vault balance and uses 20% to buy and burn official PONS.
5. The creator supplies a wallet only when withdrawing their accumulated balance.

## Unclaimed batches

Each collected batch has its own 48-hour deadline. After expiry, anyone can settle it: 50% goes to the development treasury and 50% buys and burns official PONS.

## Onchain components

- `CreatorFeeVaultFactory`: access-controlled deterministic vault deployment per launch.
- `CreatorFeeVault`: fee lots, creator balance, signed withdrawals, and permissionless expiry.
- `PonsBuybackBurner`: constrained swaps into official PONS followed by an irreversible burn.
- pons v2 factory: creates the coin and its market from the launcher's wallet.
- pons fee escrow: source of creator fees routed into PONSPAY vaults.

## Network

- Robinhood Chain: `4663`
- Public RPC: `https://rpc.mainnet.chain.robinhood.com`
- pons v2 factory: `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`
- Explorer: `https://robinhoodchain.blockscout.com`

## Security model

The launcher signs the token launch. The creator's verified social identity authorizes claims. A PONSPAY attestor signs narrowly scoped EIP-712 claim and withdrawal authorizations. Nonces and deadlines prevent replay. Settlement and burn receipts remain public onchain.

Before public financial launch, deploy and verify the PONSPAY contracts, use multisig-controlled administration, configure production OAuth applications, operate the indexer and relayer with monitored keys, and complete an independent smart-contract review.
