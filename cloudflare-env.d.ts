declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INSTAGRAM_CLIENT_ID?: string;
    INSTAGRAM_CLIENT_SECRET?: string;
    TIKTOK_CLIENT_KEY?: string;
    TIKTOK_CLIENT_SECRET?: string;
    PHYLLO_CLIENT_ID?: string;
    PHYLLO_CLIENT_SECRET?: string;
    PHYLLO_ENVIRONMENT?: "sandbox" | "staging" | "production";
    PUBLIC_APP_URL?: string;
    INGEST_HMAC_SECRET?: string;
    OPERATOR_HMAC_SECRET?: string;
    CLAIM_ATTESTOR_PRIVATE_KEY?: string;
    CLAIM_ROUTER_ADDRESS?: string;
    FACTORY_ADDRESS?: string;
    VAULT_FACTORY_ADDRESS?: string;
    ROBINHOOD_RPC_URL?: string;
  }
}
