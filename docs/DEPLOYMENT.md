# PONSPAY Deployment

Required hosted secrets and variables:

- `PUBLIC_APP_URL`
- `PHYLLO_CLIENT_ID`
- `PHYLLO_CLIENT_SECRET`
- `PHYLLO_ENVIRONMENT` (`sandbox` for mocked data, `staging` for live integration testing, or `production` for public creator verification)
- `INGEST_HMAC_SECRET`
- `OPERATOR_HMAC_SECRET` (shared only with the droplet operator)
- `CLAIM_ATTESTOR_PRIVATE_KEY`
- `FACTORY_ADDRESS`
- `VAULT_FACTORY_ADDRESS` (the deployed `CreatorFeeVaultFactory` used by the launch page)
- `ROBINHOOD_RPC_URL`
- `NEXT_PUBLIC_X_URL`
- `NEXT_PUBLIC_GITHUB_URL`

Configure Instagram and TikTok in the Phyllo dashboard. Never commit provider credentials or expose the Phyllo client secret to the browser.

The launcher's connected wallet creates the deterministic vault and pays that transaction's network fee. The droplet runs `operator/index.mjs` as `paypons-operator.service`; it polls the authenticated operator sync endpoint, provides recovery for older pending launch intents, checks the PONS fee escrow, collects new native fee lots, and posts confirmed `LotCreated` events back to the site. It binds its health endpoint to `127.0.0.1:8799`; no operator port is exposed publicly.
Private staging also supplies `PAYPONS_SITES_BYPASS_TOKEN` to the operator through its protected environment file. Remove it after the site is made public.
