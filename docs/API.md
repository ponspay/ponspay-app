# PONSPAY API

## Public

- `GET /api/launches?q=` — creator-linked PONSPAY launches.
- `GET /api/routes/:platform/:handle` — public route, verification state, launch count, and vault.
- `POST /api/routes` — create or update a creator route and confirmed launch record.
- `GET /api/avatars/:routeId` — cached creator avatar.

## Creator session

- `GET /api/vault` — signed-in creator route and open balances.
- `POST /api/claims/prepare` — prepare claimable onchain fee lots.
- `POST /api/withdrawals/prepare` — validate and queue a vault withdrawal.

## Operator

- `POST /api/fees/ingest` — HMAC-authenticated `LotCreated` event ingestion.
- `POST /api/operator/sync` — HMAC-authenticated route provisioning and settlement synchronization for the droplet operator.

Creator verification starts at `POST /api/auth/phyllo/session` and completes at `POST /api/auth/phyllo/complete`. PONSPAY fetches the connected account and profile from Phyllo server-side before issuing a creator session.
