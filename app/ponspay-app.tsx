"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPublicClient, createWalletClient, custom, decodeEventLog, formatEther, http, parseAbi, parseAbiItem, toHex, zeroAddress } from "viem";
import { ArrowRight, BadgeCheck, BarChart3, Camera, ChevronLeft, ChevronRight, CircleCheckBig, CircleDollarSign, CircleHelp, Coins, ExternalLink, Flame, House, ImagePlus, Link2, Rocket, Search, ShieldCheck, Wallet } from "lucide-react";

const FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e" as const;
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const X_URL = process.env.NEXT_PUBLIC_X_URL;
const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL;
const robinhood = { id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [RPC] } }, blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } } } as const;
const factoryAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "struct TokenParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }",
  "struct LaunchConfig { uint256 supply; uint256 curveFeeBps; uint256 phantomQuote; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; bool enabled; }",
  "function launchConfigCount() view returns (uint256)",
  "function getLaunchConfig(uint256 id) view returns (LaunchConfig)",
  "function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)",
  "function launchFee() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function canLaunch(address account) view returns (bool)",
  "function launchToken(TokenParams params, uint256 launchConfigId, address pairToken) payable returns (address token, address curve)",
]);
const vaultFactoryAbi = parseAbi([
  "function createVaultForLauncher(bytes32 launchKey, bytes32 creatorRouteKey, bytes32 launcherSalt) returns(address vault)",
  "function vaultOfLaunch(bytes32 launchKey) view returns(address)",
]);
const launchedEvent = parseAbiItem("event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)");

type RouteResult = { routeId: string; vaultKey?: string; vaultAddress?: `0x${string}` | null; platform: string; handle: string; displayName?: string | null; avatarUrl?: string | null; launches?: number; status?: string };
type LaunchIntent = RouteResult & { intentId: string; launchKey: `0x${string}`; creatorRouteKey: `0x${string}`; launchSalt: `0x${string}`; vaultFactoryAddress?: `0x${string}` | null; vaultTxHash?: string | null; expiresAt: string };
type CreatorVault = { signedIn: true; route: RouteResult; vaults: Array<{ launchId: string; tokenAddress: string; tokenName?: string | null; tokenSymbol?: string | null; vaultAddress: string; claimableRaw: number; openBatches: number; nativeBalanceRaw: string }> };
type Launch = { id: string; tokenAddress: string; vaultAddress?: string | null; vaultTxHash?: string | null; name?: string | null; symbol?: string | null; logoUrl?: string | null; description?: string | null; creatorHandle: string; creatorName?: string | null; creatorAvatar?: string | null; platform: string; creatorStatus: string; status: string };
type LaunchReceipt = { tokenAddress: `0x${string}`; vaultAddress: `0x${string}`; launchTxHash: `0x${string}`; vaultTxHash?: string | null };
type PaymentActivity = { id: string; eventType: "payment" | "fee_route"; amountRaw: string; assetAddress: string; txHash: string; eventAt?: string | null; creatorHandle: string; creatorName?: string | null; creatorAvatar?: string | null; platform: string; tokenName?: string | null; tokenSymbol?: string | null };
type AnalyticsData = { launches: number; verifiedCreators: number; confirmedPayments: number; feeBatches: Array<{ status: string; total: number }>; dailyLaunches: Array<{ day: string; total: number }> };
type EthereumProvider = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };
type PhylloConnectInstance = {
  on(event: "accountConnected", callback: (accountId: string, workPlatformId: string, userId: string) => void): void;
  on(event: "accountDisconnected", callback: (accountId: string, workPlatformId: string, userId: string) => void): void;
  on(event: "tokenExpired", callback: (userId: string) => void): void;
  on(event: "exit", callback: (reason: string, userId: string) => void): void;
  on(event: "connectionFailure", callback: (reason: string, workPlatformId: string, userId: string) => void): void;
  open(): void;
};
type PhylloConnectGlobal = { initialize(config: { clientDisplayName: string; environment: "sandbox" | "staging" | "production"; userId: string; token: string; workPlatformId: string; redirect?: boolean; redirectURL?: string; mobile?: boolean }): PhylloConnectInstance };

function platformFromProfileInput(value: string): "instagram" | "tiktok" | null {
  if (/\b(?:www\.)?instagram\.com(?:\/|$)/i.test(value)) return "instagram";
  if (/\b(?:www\.)?tiktok\.com(?:\/|$)/i.test(value)) return "tiktok";
  return null;
}

function normalizeCreatorHandleInput(value: string): string {
  const withoutPlatformUrl = value.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|tiktok\.com)\//i, "");
  const handle = withoutPlatformUrl.replace(/^@/, "").split(/[/?#]/)[0].toLowerCase();
  return /^[a-z0-9._]{2,30}$/.test(handle) ? handle : "";
}

function creatorProfileUrl(platform: "instagram" | "tiktok", handle: string): string {
  if (!handle) return "";
  return platform === "instagram" ? `https://www.instagram.com/${handle}/` : `https://www.tiktok.com/@${handle}`;
}

function linkedCreatorProfile(platform: string, handle: string): string {
  return platform.toLowerCase() === "tiktok"
    ? `https://www.tiktok.com/@${encodeURIComponent(handle)}`
    : `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

function CreatorAvatar({ avatar, platform, handle, className = "mini-avatar" }: { avatar?: string | null; platform: string; handle: string; className?: string }) {
  const [imageFailed, setImageFailed] = useState(false);
  return <div className={className}>{avatar && !imageFailed
    ? <img src={avatar} alt={`@${handle}`} loading="lazy" onError={()=>setImageFailed(true)}/>
    : platform.toLowerCase() === "instagram" ? <Camera size={15}/> : <b>♪</b>}</div>;
}

function isEmbeddedSocialBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Instagram|FBAN|FBAV|TikTok|BytedanceWebview|musical_ly/i.test(navigator.userAgent);
}

function normalizeTweetUrl(value: string): string {
  const candidate = value.trim();
  if (!candidate) return "";
  const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  let parsed: URL;
  try { parsed = new URL(withProtocol); }
  catch { throw new Error("Enter a valid X/Tweet link."); }
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if ((hostname !== "x.com" && hostname !== "twitter.com") || !/\/status\/\d+/i.test(parsed.pathname)) {
    throw new Error("Use a direct x.com or twitter.com post link.");
  }
  parsed.protocol = "https:";
  parsed.hash = "";
  return parsed.toString();
}

declare global { interface Window { ethereum?: EthereumProvider; PhylloConnect?: PhylloConnectGlobal } }

type AppView = "home" | "explore" | "payments" | "analytics" | "launch" | "flow" | "creator" | "docs";

export default function PonsPayApp({ view }: { view: AppView }) {
  const [platform, setPlatform] = useState<"instagram" | "tiktok">("tiktok");
  const [handle, setHandle] = useState("");
  const [coinName, setCoinName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [description, setDescription] = useState("");
  const [tweetUrl, setTweetUrl] = useState("");
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [creatorVault, setCreatorVault] = useState<CreatorVault | null>(null);
  const [creatorSessionStatus, setCreatorSessionStatus] = useState<"checking" | "signed-out" | "signed-in">("checking");
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [platformFilter, setPlatformFilter] = useState<"all" | "instagram" | "tiktok">("all");
  const [activity, setActivity] = useState<PaymentActivity[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData>({ launches: 0, verifiedCreators: 0, confirmedPayments: 0, feeBatches: [], dailyLaunches: [] });
  const [search, setSearch] = useState("");
  const [wallet, setWallet] = useState<`0x${string}` | null>(null);
  const [message, setMessage] = useState("");
  const [claimMessage, setClaimMessage] = useState("");
  const [launchReceipt, setLaunchReceipt] = useState<LaunchReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [withdrawTo, setWithdrawTo] = useState("");
  const [platformThemeReady, setPlatformThemeReady] = useState(false);
  const searchRef = useRef("");
  const verificationResumeRef = useRef(false);
  const verificationActiveRef = useRef(false);

  async function loadLaunches(query = "") {
    const response = await fetch(`/api/launches?q=${encodeURIComponent(query)}&fresh=${Date.now()}`, { cache: "no-store" });
    if (response.ok) setLaunches(((await response.json()) as { launches: Launch[] }).launches);
  }

  async function loadAnalytics() {
    const response = await fetch(`/api/analytics?fresh=${Date.now()}`, { cache: "no-store" });
    if (response.ok) setAnalytics(await response.json() as AnalyticsData);
  }

  useEffect(() => {
    setRailCollapsed(window.localStorage.getItem("ponspay-rail") === "collapsed");
    const savedPlatform = window.localStorage.getItem("ponspay-platform");
    if (savedPlatform === "instagram" || savedPlatform === "tiktok") setPlatform(savedPlatform);
    setPlatformThemeReady(true);
    const initialQuery = view === "explore" ? new URLSearchParams(window.location.search).get("q") ?? "" : "";
    if (initialQuery) setSearch(initialQuery);
    const needsLaunches = view === "home" || view === "explore";
    if (needsLaunches) loadLaunches(initialQuery).catch(() => null);
    const launchTimer = needsLaunches ? window.setInterval(() => { if (!document.hidden) loadLaunches(view === "explore" ? searchRef.current : "").catch(() => null); }, 20_000) : null;

    const loadActivity = () => {
      if (document.hidden) return;
      fetch(`/api/activity?fresh=${Date.now()}`, { cache: "no-store" }).then(async (response) => response.ok ? setActivity(((await response.json()) as { activity: PaymentActivity[] }).activity) : null).catch(() => null);
    };
    const needsActivity = view === "home" || view === "payments";
    if (needsActivity) loadActivity();
    const activityTimer = needsActivity ? window.setInterval(loadActivity, 30_000) : null;
    const onVisibility = () => { if (needsActivity && !document.hidden) loadActivity(); };
    document.addEventListener("visibilitychange", onVisibility);

    const needsAnalytics = view === "home" || view === "analytics";
    if (needsAnalytics) loadAnalytics().catch(() => null);
    const analyticsTimer = needsAnalytics ? window.setInterval(() => { if (!document.hidden) loadAnalytics().catch(() => null); }, 20_000) : null;
    if (view === "creator") {
      fetch("/api/vault", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) { setCreatorSessionStatus("signed-out"); return; }
        const vault = await response.json() as CreatorVault;
        setCreatorVault(vault);
        setCreatorSessionStatus("signed-in");
        setRoute(vault.route);
        setHandle(vault.route.handle);
        setPlatform(vault.route.platform === "tiktok" ? "tiktok" : "instagram");
      }).catch(() => setCreatorSessionStatus("signed-out"));
      resumePendingCreatorVerification().catch(() => null);
    }
    const onCreatorFocus = () => { if (view === "creator" && !document.hidden && !verificationActiveRef.current) resumePendingCreatorVerification().catch(() => null); };
    window.addEventListener("focus", onCreatorFocus);
    document.addEventListener("visibilitychange", onCreatorFocus);
    return () => {
      if (activityTimer) window.clearInterval(activityTimer);
      if (launchTimer) window.clearInterval(launchTimer);
      if (analyticsTimer) window.clearInterval(analyticsTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onCreatorFocus);
      document.removeEventListener("visibilitychange", onCreatorFocus);
    };
  }, []);

  useEffect(() => {
    if (platformThemeReady) window.localStorage.setItem("ponspay-platform", platform);
  }, [platform, platformThemeReady]);

  useEffect(() => { searchRef.current = search; }, [search]);

  const shortWallet = useMemo(() => wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : "Connect wallet", [wallet]);
  const visibleLaunches = useMemo(() => platformFilter === "all" ? launches : launches.filter((launch) => launch.platform.toLowerCase() === platformFilter), [launches, platformFilter]);
  const withdrawableVault = useMemo(() => creatorVault?.vaults.find((item) => BigInt(item.nativeBalanceRaw || "0") > 0n) ?? null, [creatorVault]);
  const displayedHandle = normalizeCreatorHandleInput(handle) || handle.trim().replace(/^@/, "");
  const fixedCreatorWebsite = creatorProfileUrl(platform, normalizeCreatorHandleInput(handle));

  async function connectWallet() {
    if (!window.ethereum) throw new Error("Install or open an EVM wallet first.");
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
    try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1237" }] }); }
    catch { await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x1237", chainName: robinhood.name, nativeCurrency: robinhood.nativeCurrency, rpcUrls: [RPC], blockExplorerUrls: [robinhood.blockExplorers.default.url] }] }); }
    setWallet(accounts[0].toLowerCase() as `0x${string}`);
    return accounts[0].toLowerCase() as `0x${string}`;
  }

  async function resumePendingCreatorVerification(explicitState?: string) {
    const state = explicitState || window.sessionStorage.getItem("ponspay-phyllo-state") || "";
    if (verificationResumeRef.current) return;
    verificationResumeRef.current = true;
    setBusy(true);
    setMessage("Completing your secure sign-in…");
    let lastError = "The social connection did not finish. Tap Verify again to continue.";
    try {
      const redirectParams = new URLSearchParams(window.location.search);
      const redirectUserId = redirectParams.get("phyllo_user_id") || "";
      const redirectExitReason = redirectParams.get("phyllo_exit_reason") || "";
      let redirectAccount: { account_id?: unknown; work_platform_id?: unknown } | undefined;
      try {
        const connectedAccounts = JSON.parse(redirectParams.get("phyllo_accounts_connected") || "[]") as unknown;
        if (Array.isArray(connectedAccounts)) redirectAccount = connectedAccounts[0] as { account_id?: unknown; work_platform_id?: unknown } | undefined;
      } catch {
        redirectAccount = undefined;
      }
      const redirectAccountId = typeof redirectAccount?.account_id === "string" ? redirectAccount.account_id : "";
      const redirectWorkPlatformId = typeof redirectAccount?.work_platform_id === "string" ? redirectAccount.work_platform_id : "";
      const hasConfirmedRedirect = redirectExitReason === "DONE_CLICKED" && Boolean(redirectUserId && redirectAccountId && redirectWorkPlatformId);

      if (hasConfirmedRedirect) {
        setMessage("TikTok connected. Confirming your profile and opening rewards…");
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const completeResponse = await fetch("/api/auth/phyllo/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...(state ? { state } : {}), accountId: redirectAccountId, workPlatformId: redirectWorkPlatformId, userId: redirectUserId }),
          });
          const completed = await completeResponse.json() as { ok?: boolean; error?: string; retryable?: boolean; returnTo?: string };
          if (completeResponse.ok && completed.ok) {
            window.sessionStorage.removeItem("ponspay-phyllo-state");
            window.location.assign(completed.returnTo || "/creator");
            return;
          }
          lastError = completed.error || "Your verified profile is still syncing.";
          if (!completed.retryable) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1250));
        }
        setMessage(lastError);
        return;
      }

      for (let attempt = 0; attempt < 24; attempt += 1) {
        const response = await fetch("/api/auth/phyllo/status", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ state }),
        });
        const result = await response.json() as { ok?: boolean; idle?: boolean; pending?: boolean; phase?: "connection" | "profile"; error?: string; returnTo?: string };
        if (result.idle) { setMessage(""); return; }
        if (response.ok && result.ok) {
          window.sessionStorage.removeItem("ponspay-phyllo-state");
          window.location.assign(result.returnTo || "/creator");
          return;
        }
        if (response.status === 410 || response.status === 400) {
          window.sessionStorage.removeItem("ponspay-phyllo-state");
          lastError = result.error || "This verification session expired. Start again.";
          break;
        }
        if (!result.pending && response.status !== 502) {
          lastError = result.error || "Creator verification could not be completed.";
          break;
        }
        if (result.phase === "profile") setMessage("Profile confirmed. Opening your rewards…");
        if (result.phase === "connection" && attempt >= 7) {
          window.sessionStorage.removeItem("ponspay-phyllo-state");
          await fetch("/api/auth/phyllo/status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(state ? { state } : {}), cancel: true }) }).catch(() => null);
          lastError = "The social connection did not finish. Tap Verify again to continue.";
          break;
        }
        if (result.error) lastError = result.error;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      setMessage(lastError);
    } finally {
      verificationResumeRef.current = false;
      setBusy(false);
    }
  }

  async function verifyCreator(selectedPlatform: "instagram" | "tiktok") {
    setBusy(true);
    setPlatform(selectedPlatform);
    setMessage(`Opening secure ${selectedPlatform === "instagram" ? "Instagram" : "TikTok"} verification…`);
    try {
      if (isEmbeddedSocialBrowser()) {
        throw new Error("Open PONSPAY in Safari or Chrome to verify securely. Instagram and TikTok can block sign-in inside their in-app browsers.");
      }
      const suppliedHandle = handle.trim();
      const normalizedHandle = normalizeCreatorHandleInput(handle);
      if (suppliedHandle && !normalizedHandle) throw new Error("Enter a valid profile handle or clear the field to verify by signing in.");
      if (normalizedHandle) setHandle(normalizedHandle);
      const response = await fetch("/api/auth/phyllo/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: selectedPlatform, ...(normalizedHandle ? { handle: normalizedHandle } : {}), returnTo: "/creator" }),
      });
      const session = await response.json() as { error?: string; state?: string; userId?: string; token?: string; environment?: "sandbox" | "staging" | "production"; workPlatformId?: string };
      if (!response.ok || !session.state || !session.userId || !session.token || !session.environment || !session.workPlatformId) {
        throw new Error(session.error || "Creator verification could not start.");
      }
      window.sessionStorage.setItem("ponspay-phyllo-state", session.state);
      if (!window.PhylloConnect) throw new Error("The secure verification window is still loading. Please try again in a moment.");
      const useMobileRedirect = /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
      const connector = window.PhylloConnect.initialize({
        clientDisplayName: "PONSPAY",
        environment: session.environment,
        userId: session.userId,
        token: session.token,
        workPlatformId: session.workPlatformId,
        ...(useMobileRedirect ? { redirect: true, redirectURL: `${window.location.origin}/creator`, mobile: true } : {}),
      });
      let completed = false;
      verificationActiveRef.current = true;
      connector.on("accountConnected", async (accountId, workPlatformId, userId) => {
        if (completed) return;
        completed = true;
        verificationActiveRef.current = false;
        setMessage("Profile connected. Confirming the verified identity…");
        let lastError = "Profile confirmed. Opening your rewards…";
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const completeResponse = await fetch("/api/auth/phyllo/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state: session.state, accountId, workPlatformId, userId }),
          });
          const result = await completeResponse.json() as { ok?: boolean; error?: string; retryable?: boolean; returnTo?: string };
          if (completeResponse.ok && result.ok) {
            window.sessionStorage.removeItem("ponspay-phyllo-state");
            window.location.assign(result.returnTo || "/creator");
            return;
          }
          lastError = result.error || "Creator verification could not be completed.";
          if (!result.retryable) break;
          await new Promise((resolve) => window.setTimeout(resolve, 1250));
        }
        setBusy(false);
        setMessage(lastError);
        resumePendingCreatorVerification(session.state).catch(() => null);
      });
      connector.on("accountDisconnected", (_accountId, _workPlatformId, _userId) => { verificationActiveRef.current = false; setBusy(false); setMessage("The social account was disconnected. Verify it again to reopen linked vaults."); });
      connector.on("tokenExpired", (_userId) => { verificationActiveRef.current = false; setBusy(false); setMessage("The verification window expired. Please start again."); });
      connector.on("exit", (_reason, _userId) => { verificationActiveRef.current = false; if (!completed) { setBusy(false); resumePendingCreatorVerification(session.state).catch(() => null); } });
      connector.on("connectionFailure", (reason, _workPlatformId, _userId) => { verificationActiveRef.current = false; setBusy(false); setMessage(reason || "The social profile could not be connected."); });
      connector.open();
    } catch (error) {
      verificationActiveRef.current = false;
      setBusy(false);
      setMessage(error instanceof Error ? error.message : "Creator verification could not start.");
    }
  }

  async function launchCoin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setLaunchReceipt(null);
    try {
      const normalizedHandle = normalizeCreatorHandleInput(handle);
      if (!normalizedHandle) throw new Error("Enter a valid Instagram or TikTok handle or profile link.");
      setHandle(normalizedHandle);
      const fixedWebsite = creatorProfileUrl(platform, normalizedHandle);
      const normalizedTweetUrl = normalizeTweetUrl(tweetUrl);
      const account = wallet ?? await connectWallet();
      if (!window.ethereum) throw new Error("Wallet unavailable.");
      const publicClient = createPublicClient({ chain: robinhood, transport: http(RPC) });
      const walletClient = createWalletClient({ account, chain: robinhood, transport: custom(window.ethereum) });
      const launchSalt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const routeResponse = await fetch("/api/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform, handle: normalizedHandle, chainId: 4663, launchSalt, launcherAddress: account }) });
      let launchIntent = await routeResponse.json() as LaunchIntent & { error?: string };
      if (!routeResponse.ok) throw new Error(launchIntent.error ?? "Launch vault could not be created.");
      setRoute(launchIntent);
      let submittedVaultTxHash: `0x${string}` | null = null;
      if (!launchIntent.vaultAddress) {
        if (!launchIntent.vaultFactoryAddress) throw new Error("The vault factory is not configured for launches yet.");
        setMessage("Confirm both wallet requests to launch your linked coin…");
        const vaultRequest = await publicClient.simulateContract({ account, address: launchIntent.vaultFactoryAddress, abi: vaultFactoryAbi, functionName: "createVaultForLauncher", args: [launchIntent.launchKey, launchIntent.creatorRouteKey, launchIntent.launchSalt] });
        submittedVaultTxHash = await walletClient.writeContract(vaultRequest.request);
        launchIntent = { ...launchIntent, vaultAddress: vaultRequest.result, vaultTxHash: submittedVaultTxHash };
        setRoute(launchIntent);
      }
      if (!launchIntent.vaultAddress) throw new Error("This launch was saved, but its fresh onchain vault is still being prepared. Please retry in a moment.");
      const [allowed, maxTax, configCount, launchFee] = await Promise.all([
        publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "canLaunch", args: [account] }),
        publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "maxCreatorTaxBps" }),
        publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "launchConfigCount" }),
        publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "launchFee" }),
      ]);
      if (!allowed) throw new Error("The connected wallet is not currently allowed by the PONS launch factory.");
      if (maxTax < BigInt(400)) throw new Error("The PONS factory currently caps creator tax below PONSPAY's fixed 4% route.");
      let configId: bigint | null = null;
      for (let id = BigInt(0); id < configCount; id++) {
        const config = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getLaunchConfig", args: [id] });
        if (config.enabled) { configId = id; break; }
      }
      if (configId === null) throw new Error("No PONS launch configuration is open.");
      if (!logoFile) throw new Error("Add a coin image before launching.");
      const upload = new FormData(); upload.set("image", logoFile);
      const uploadResponse = await fetch("/api/uploads/image", { method: "POST", body: upload });
      const uploadBody = await uploadResponse.json() as { url?: string; error?: string };
      if (!uploadResponse.ok || !uploadBody.url) throw new Error(uploadBody.error ?? "The coin image could not be uploaded.");
      const finalLogoUrl = uploadBody.url;
      const expectedEconomics = await publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "previewLaunchEconomics", args: [configId, zeroAddress] });
      const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
      const hash = await walletClient.writeContract({ address: FACTORY, abi: factoryAbi, functionName: "launchToken", args: [{ name: coinName.trim(), symbol: symbol.trim().toUpperCase(), logo: finalLogoUrl, description: description.trim(), socials: { twitter: normalizedTweetUrl, telegram: "", discord: "", website: fixedWebsite, farcaster: "" }, creatorFeeRecipient: launchIntent.vaultAddress, creatorTaxBps: 400, buybackEnabled: false, expectedEconomics, salt }, configId, zeroAddress], value: launchFee });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      let tokenAddress: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try { const decoded = decodeEventLog({ abi: [launchedEvent], data: log.data, topics: log.topics }); tokenAddress = decoded.args.token; break; } catch { /* unrelated log */ }
      }
      if (!tokenAddress) throw new Error("Launch confirmed, but the token address could not be read from the receipt.");
      if (submittedVaultTxHash) {
        const confirmationResponse = await fetch(`/api/routes/intents/${encodeURIComponent(launchIntent.intentId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: submittedVaultTxHash }) });
        const confirmedIntent = await confirmationResponse.json() as LaunchIntent & { error?: string };
        if (!confirmationResponse.ok) throw new Error(confirmedIntent.error ?? "The coin launched, but its creator vault receipt could not be recorded.");
        launchIntent = { ...launchIntent, ...confirmedIntent };
        setRoute(launchIntent);
      }
      const finalizeResponse = await fetch("/api/routes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform, handle: normalizedHandle, chainId: 4663, intentId: launchIntent.intentId, tokenAddress, name: coinName, symbol, logoUrl: finalLogoUrl, description, launcherAddress: account, launchTxHash: hash }) });
      if (!finalizeResponse.ok) throw new Error("The coin launched, but its public PONSPAY record could not be finalized. Contact support with the launch transaction.");
      setLaunchReceipt({ tokenAddress, vaultAddress: launchIntent.vaultAddress, launchTxHash: hash, vaultTxHash: launchIntent.vaultTxHash });
      setMessage(`${symbol.toUpperCase()} launched and linked to @${normalizedHandle}.`);
      await loadLaunches();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Launch failed."); }
    finally { setBusy(false); }
  }

  async function findFees(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const normalizedHandle = normalizeCreatorHandleInput(handle);
      if (!normalizedHandle) throw new Error("Enter a valid Instagram or TikTok handle or profile link.");
      setHandle(normalizedHandle);
      const response = await fetch(`/api/routes/${platform}/${encodeURIComponent(normalizedHandle)}`);
      const body = await response.json() as RouteResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No linked fees found.");
      setRoute(body); setMessage(`Found ${body.launches ?? 0} linked launch${body.launches === 1 ? "" : "es"}. Verify the profile to open its PONSPAY vault.`);
    } catch (error) { setRoute(null); setMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function claimToVault() {
    setBusy(true); setClaimMessage("");
    try {
      const response = await fetch("/api/claims/prepare", { method: "POST" });
      const body = await response.json() as { error?: string; ready?: boolean; next?: string; batches?: unknown[] };
      if (!response.ok) throw new Error(body.error ?? "Claim could not be prepared.");
      if (!body.ready) {
        setClaimMessage(body.next === "wait-for-fees" ? "Your vault is ready. No rewards have arrived yet." : "Your verified profile is ready; the live vault deployment is still pending.");
        return;
      }
      setClaimMessage(`Claim submitted for ${body.batches?.length ?? 0} fee batch${body.batches?.length === 1 ? "" : "es"}. Confirming onchain…`);
      for (let attempt = 0; attempt < 30; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const refreshed = await fetch(`/api/vault?fresh=${Date.now()}`, { cache: "no-store" });
        if (!refreshed.ok) continue;
        const nextVault = await refreshed.json() as CreatorVault;
        setCreatorVault(nextVault);
        const ready = nextVault.vaults.some((item) => BigInt(item.nativeBalanceRaw || "0") > 0n);
        if (ready) { setClaimMessage("Rewards claimed. Enter your wallet address below to withdraw them."); return; }
      }
      setClaimMessage("Your claim is still confirming onchain. You can leave this page and return shortly.");
    } catch (error) { setClaimMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function withdrawCreatorBalance() {
    setBusy(true); setMessage("");
    try {
      const vault = creatorVault?.vaults.find((item) => BigInt(item.nativeBalanceRaw || "0") > 0n);
      if (!vault) throw new Error("No claimed creator balance is ready to withdraw.");
      const response = await fetch("/api/withdrawals/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launchId: vault.launchId, assetAddress: "native", amountRaw: vault.nativeBalanceRaw, recipientAddress: withdrawTo }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Withdrawal could not be prepared.");
      setMessage("Withdrawal queued. PONSPAY will verify and send it to your wallet onchain.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  return <div className={`app-shell platform-theme-${platform}${railCollapsed ? " rail-collapsed" : ""}`}>
    <aside className="rail" aria-label="Primary navigation"><a className="brand-mark" href="/"><img src="/brand/ponspay-mark.svg" alt="PONSPAY"/><b>PONS<span>PAY</span></b></a><button type="button" className="rail-toggle" aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"} title={railCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={()=>setRailCollapsed((current)=>{const next=!current;window.localStorage.setItem("ponspay-rail",next?"collapsed":"expanded");return next})}>{railCollapsed ? <ChevronRight/> : <ChevronLeft/>}</button><nav><a className={view==="home"?"active":""} href="/"><House/><small>Home</small></a><a className={view==="explore"?"active":""} href="/explore"><Coins/><small>Explore</small></a><a className={view==="payments"?"active":""} href="/payments"><CircleDollarSign/><small>Payments</small></a><a className={view==="analytics"?"active":""} href="/analytics"><BarChart3/><small>Analytics</small></a><a className={view==="launch"?"active":""} href="/launch"><Rocket/><small>Launch</small></a><a className={view==="flow"?"active":""} href="/capital-flow"><Link2/><small>Capital flow</small></a><a className={view==="creator"?"active":""} href="/creator"><Camera/><small>Creator vault</small></a></nav><a className={`rail-docs${view==="docs"?" active":""}`} href="/docs"><CircleHelp size={24} strokeWidth={1.7}/><small>Docs</small></a></aside>
    <div className="workspace">
    <header className="topbar">
      <a className="wordmark" href="/"><img src="/brand/ponspay-mark.svg" alt="PONSPAY"/><b>PONS<span>PAY</span></b></a>
      <form className="top-search" onSubmit={(event)=>{event.preventDefault();if(view==="explore")loadLaunches(search);else window.location.assign(`/explore?q=${encodeURIComponent(search)}`)}}><Search size={16}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search launches, contracts or creators"/></form>
      <div className="top-actions"><a className="top-launch" href="/launch">Launch</a><button type="button" className="profile-button" aria-label={wallet ? `Connected wallet ${shortWallet}` : "Connect wallet"} onClick={()=>connectWallet().catch((error)=>setMessage(error.message))}><span className="profile-dot"><Wallet size={15}/></span><span className="wallet-label">{shortWallet}</span></button></div>
    </header>
    <main id="home" className={`view-${view}`}>

    {view === "home" && <section className="home-dashboard" id="top">
      <div className="home-hero">
        <svg className="liquid-gradient-layer" viewBox="0 0 1200 520" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="ponspay-platform-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#9b51d2"/>
              <stop offset="17%" stopColor="#e13b88"/>
              <stop offset="31%" stopColor="#ff805b"/>
              <stop offset="45%" stopColor="#25f4ee"/>
              <stop offset="52%" stopColor="#f4f5f2"/>
              <stop offset="62%" stopColor="#fe476f"/>
              <stop offset="78%" stopColor="#00aff0"/>
              <stop offset="100%" stopColor="#78d8ff"/>
            </linearGradient>
            <filter id="ponspay-liquid" x="-120" y="-100" width="1440" height="720" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="0.003 0.008" numOctaves="1" seed="8" result="noise"/>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="118" xChannelSelector="R" yChannelSelector="B"/>
            </filter>
            <filter id="ponspay-wave-soften" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="30"/></filter>
          </defs>
          <rect x="-80" y="-70" width="1360" height="660" fill="url(#ponspay-platform-gradient)" filter="url(#ponspay-liquid)" opacity=".72"/>
          <path d="M240 -100 C520 40 180 190 470 320 C680 430 360 560 600 680 L850 680 C610 520 900 410 650 280 C430 160 760 30 500 -100 Z" fill="#25f4ee" opacity=".28" filter="url(#ponspay-wave-soften)"/>
          <path d="M980 -100 C760 60 1110 210 820 330 C620 450 970 560 720 680 L1040 680 C1190 520 890 390 1120 260 C1280 140 1020 10 1230 -100 Z" fill="#fe476f" opacity=".22" filter="url(#ponspay-wave-soften)"/>
        </svg>
        {activity[0] ? <a className="home-live-receipt" href={linkedCreatorProfile(activity[0].platform, activity[0].creatorHandle)} target="_blank" rel="noreferrer" title={`Open @${activity[0].creatorHandle} on ${activity[0].platform}`}><CircleDollarSign/><b>{activity[0].eventType === "fee_route" ? "Fees routed" : "Creator paid"}</b><span>to</span><CreatorAvatar avatar={activity[0].creatorAvatar} platform={activity[0].platform} handle={activity[0].creatorHandle}/><strong>@{activity[0].creatorHandle}</strong><ExternalLink size={12}/><i/></a> : <div className="home-live-receipt waiting"><i/><b>Live PONSPAY activity</b><span>waiting for the first onchain route</span></div>}
        <h1>Launch a coin.<br/>Pay the creator.</h1>
        <p>Link any PONS launch to an Instagram or TikTok creator. Their fees collect in one place, ready to claim.</p>
        <div className="hero-actions"><a className="button light" href="/launch"><span>Launch a token</span></a><a className="button quiet" href="/creator"><span>Find my fees</span></a></div>
      </div>
      <div className="home-panels">
        <a className="home-panel explore-panel" href="/explore"><div className="panel-head"><b>Explore</b><span>Open <ArrowRight/></span></div><div className="home-coin-grid">{launches.slice(0,4).map((launch)=><div key={launch.id}>{launch.logoUrl ? <img src={launch.logoUrl} alt=""/> : <strong>{launch.symbol?.slice(0,1) ?? "P"}</strong>}<span><b>{launch.name || launch.symbol}</b><small>@{launch.creatorHandle}</small></span></div>)}{!launches.length && <p>New creator-linked launches will appear here.</p>}</div></a>
        <a className="home-panel activity-panel" href="/payments"><div className="panel-head"><b>Live activity</b><span>Open <ArrowRight/></span></div><div className="home-activity-list">{activity.slice(0,4).map((item)=><div key={`${item.eventType}-${item.id}`}><div className="mini-avatar">{item.creatorAvatar ? <img src={item.creatorAvatar} alt=""/> : "@"}</div><span><b>{item.eventType === "fee_route" ? "Fees routed" : "Creator paid"}</b><small>@{item.creatorHandle}{item.tokenSymbol ? ` · $${item.tokenSymbol}` : ""}</small></span><i/></div>)}{!activity.length && <p>Verified onchain routes will appear here automatically.</p>}</div></a>
      </div>
      <div className="home-metrics"><span><small>LIVE LAUNCHES</small><b>{analytics.launches.toLocaleString()}</b></span><span><small>VERIFIED CREATORS</small><b>{analytics.verifiedCreators.toLocaleString()}</b></span><span><small>CONFIRMED PAYMENTS</small><b>{analytics.confirmedPayments.toLocaleString()}</b></span></div>
    </section>}

    {view === "flow" &&
    <section className="route-map" id="flow"><div className="map-heading"><span className="eyebrow">CAPITAL FLOW</span><h2>How fees move.</h2><p>Every launch sends a 4% creator fee to its PONSPAY vault. The verified creator claims onchain.</p></div><div className="map-canvas"><svg className="flow-lines" viewBox="0 0 1000 420" preserveAspectRatio="none" aria-hidden="true"><path d="M155 210 H355"/><path d="M455 210 C540 210 505 105 600 105 H725"/><path d="M455 210 C540 210 505 315 600 315 H725"/><circle r="7"><animateMotion dur="4s" repeatCount="indefinite" path="M155 210 H355 C540 210 505 105 600 105 H725"/></circle><circle r="7"><animateMotion begin="-2s" dur="4s" repeatCount="indefinite" path="M155 210 H355 C540 210 505 315 600 315 H725"/></circle></svg><article className="map-node map-source"><i><Rocket/></i><small>PONS LAUNCH</small><b>Coin trades</b><span>Fees begin collecting</span></article><article className="map-node map-fees"><i><CircleDollarSign/></i><small>4% FEE</small><b>Creator vault</b><span>Linked to their profile</span></article><article className="map-node map-creator"><i className="creator-photo"><img src="/creators/kylie-jenner.png" alt="Kylie Jenner"/></i><small>80% · EXAMPLE</small><b>@kyliejenner</b><span>Creator share</span></article><article className="map-node map-paid"><i className="success-icon"><CircleCheckBig/></i><small>✓ SUCCESSFUL</small><b>Creator gets paid</b><span>To their wallet</span></article><article className="map-node map-burn"><i><Flame/></i><small>20% · ON CLAIM</small><b>PONS buyback & burn</b><span>Recorded onchain</span></article></div><p className="map-disclaimer">Kylie Jenner / @kyliejenner is shown as a hypothetical interface example only. No launch, partnership, or endorsement is implied.</p></section>
    }

    {view === "payments" &&
    <section className="workspace-section payments" id="payments"><div className="section-heading"><div><span className="eyebrow">LIVE ACTIVITY</span><h2>Creator payments, onchain.</h2><p>Follow every fee route and claim from launch to wallet.</p></div><span className="activity-live"><i/> LIVE</span></div><div className="activity-list">{activity.length ? activity.map((item)=><article className="activity-row" key={`${item.eventType}-${item.id}`}><a className="creator-profile-link" href={linkedCreatorProfile(item.platform, item.creatorHandle)} target="_blank" rel="noreferrer" title={`Open @${item.creatorHandle} on ${item.platform}`}><CreatorAvatar avatar={item.creatorAvatar} platform={item.platform} handle={item.creatorHandle}/><div className="activity-person"><b>{item.creatorName || `@${item.creatorHandle}`}</b><span>@{item.creatorHandle} · {item.platform}{item.tokenSymbol ? ` · $${item.tokenSymbol}` : ""}</span></div><ExternalLink size={12}/></a><div className="activity-status"><strong>{item.eventType === "fee_route" ? "Fees routed" : "Creator paid"}</strong><span>{item.eventAt ? new Date(item.eventAt).toLocaleString() : "Confirmed onchain"}</span></div><a href={`https://robinhoodchain.blockscout.com/tx/${item.txHash}`} target="_blank" rel="noreferrer">Receipt <ExternalLink size={14}/></a></article>) : <div className="empty-activity"><CircleDollarSign/><div><b>No activity yet.</b><span>New routes and payments will appear here.</span></div></div>}</div></section>
    }

    {view === "analytics" && <section className="workspace-section analytics-page"><div className="analytics-head"><span className="eyebrow">ANALYTICS</span><h2>PONSPAY activity</h2><p>Launches, verified creators, and confirmed payments.</p></div><div className="metric-grid"><article><small>LIVE LAUNCHES</small><b>{analytics.launches.toLocaleString()}</b><span>Active routes</span></article><article><small>VERIFIED CREATORS</small><b>{analytics.verifiedCreators.toLocaleString()}</b><span>Instagram and TikTok</span></article><article><small>CONFIRMED PAYMENTS</small><b>{analytics.confirmedPayments.toLocaleString()}</b><span>Onchain receipts</span></article></div><div className="analytics-grid"><article className="chart-card"><div><b>Launch activity</b><span>Last 14 days</span></div><div className="bar-chart">{Array.from({length:14},(_,index)=>{const height=analytics.dailyLaunches[index]?.total??0;const max=Math.max(1,...analytics.dailyLaunches.map((item)=>Number(item.total)));return <i key={index} style={{height:`${Math.max(4,(Number(height)/max)*100)}%`}} title={`${height} launches`}/>})}</div></article><article className="status-card"><div><b>Fee batches</b><span>Current state</span></div>{["claimable","settling","claimed","expired"].map((status)=><div className="status-line" key={status}><span>{status}</span><b>{analytics.feeBatches.find((item)=>item.status===status)?.total??0}</b></div>)}</article></div></section>}

    {view === "docs" && <section className="docs-page">
      <header><span>Docs</span><h1>How PONSPAY works</h1><p>PONSPAY links a PONS launch to an Instagram or TikTok creator. Trading fees collect in that creator’s vault, and the verified creator can claim them to a wallet.</p></header>
      <nav className="docs-contents" aria-label="Documentation contents"><small>CONTENTS</small><div><a href="#overview"><b>1</b>Overview</a><a href="#launch"><b>2</b>Launching a token</a><a href="#route"><b>3</b>Linking a creator</a><a href="#fees"><b>4</b>How fees collect</a><a href="#claim"><b>5</b>How creators claim</a><a href="#split"><b>6</b>The 80/20 split</a><a href="#unclaimed"><b>7</b>Unclaimed batches</a><a href="#proof"><b>8</b>Public proof</a><a href="#security"><b>9</b>Security model</a><a href="#network"><b>10</b>Network details</a></div></nav>
      <div className="docs-body">
        <article id="overview"><i>1</i><div><h2>Overview</h2><p>Any wallet can launch a token through PONS and choose the Instagram or TikTok profile that should receive its creator fees. PONSPAY creates a public route for that profile before the launch transaction is signed.</p><p>The creator does not need to register first. Their fees remain linked to the selected social identity until that creator verifies the same profile.</p></div></article>
        <article id="launch"><i>2</i><div><h2>Launching a token</h2><p>The launcher adds the token name, ticker, image and creator handle, then reviews the route. The PONS factory creates the token from the launcher’s connected wallet; PONSPAY does not take custody of the launch funds.</p></div></article>
        <article id="route"><i>3</i><div><h2>Linking a creator</h2><p>Every coin receives a fresh onchain vault. Instagram or TikTok verification gives the creator access to every separate launch vault assigned to that same identity.</p></div></article>
        <article id="fees"><i>4</i><div><h2>How fees collect</h2><p>The launch uses a fixed 4% creator-fee route. Each collected batch is recorded with its token, transaction, amount, recipient profile and claim deadline. New routing events appear in Live Activity automatically.</p></div></article>
        <article id="claim"><i>5</i><div><h2>How creators claim</h2><p>The creator verifies the linked Instagram or TikTok account through secure Phyllo Connect sign-in. Once the platform identity matches, the creator can claim the available batches into a PONSPAY balance and withdraw to an EVM wallet they choose.</p></div></article>
        <article id="split"><i>6</i><div><h2>The 80/20 split</h2><p>When a creator claims within the 48-hour window, 80% credits the creator and 20% buys and burns official PONS. The settlement receipts remain visible onchain.</p></div></article>
        <article id="unclaimed"><i>7</i><div><h2>Unclaimed batches</h2><p>Each batch has its own 48-hour deadline. After expiry, 50% goes to development and 50% buys and burns official PONS. This rule applies per batch rather than per creator account.</p></div></article>
        <article id="proof"><i>8</i><div><h2>Public proof</h2><p>Explore shows linked launches and creator identities. Live Activity shows fee routes and confirmed claims, with each row linking to the corresponding blockchain transaction.</p></div></article>
        <article id="security"><i>9</i><div><h2>Security model</h2><p>The launcher signs the token deployment. Social verification authorizes creator claims. Scoped authorizations, nonces and deadlines prevent replay, while settlement and burn receipts remain public.</p></div></article>
        <article id="network"><i>10</i><div><h2>Network details</h2><p>PONSPAY runs on Robinhood Chain (chain ID 4663) and launches through the PONS V2 factory. Network transactions can be inspected through Blockscout.</p><a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Open Robinhood Chain explorer <ExternalLink/></a></div></article>
      </div>
    </section>}

    {view === "explore" &&
    <section className="workspace-section discovery" id="discover">
      <div className="explore-hero"><div><span className="eyebrow">EXPLORE</span><h2>Creator coins</h2><p>Discover PONS launches linked to Instagram and TikTok creators.</p></div><a className="top-launch" href="/launch">Launch a coin</a></div>
      {visibleLaunches.length > 0 && <div className="trending-block"><div className="list-title"><b>Trending</b><span>Latest creator-linked routes</span></div><div className="trending-strip">{visibleLaunches.slice(0,5).map((launch)=><a href={`https://www.ponsfamily.com/launchpad/${launch.tokenAddress}`} target="_blank" rel="noreferrer" key={`trend-${launch.id}`}><div className="trend-logo">{launch.logoUrl ? <img src={launch.logoUrl} alt=""/> : launch.symbol?.slice(0,1)}</div><span><b>{launch.name || "PONS launch"}</b><small>${launch.symbol || "TOKEN"}</small></span><em>@{launch.creatorHandle}</em></a>)}</div></div>}
      <div className="all-launches-head"><div className="list-title"><b>{platformFilter === "all" ? "All launches" : `${platformFilter === "instagram" ? "Instagram" : "TikTok"} launches`}</b><span>{visibleLaunches.length} listed</span></div><div className="launch-toolbar"><button type="button" aria-pressed={platformFilter === "all"} className={`source-pill${platformFilter === "all" ? " filter-active" : ""}`} onClick={()=>{setPlatformFilter("all");setPlatform("tiktok")}}><span className="source-pill-logo"><img src="/brand/ponspay-mark.svg" alt=""/></span><b>All</b></button><button type="button" aria-pressed={platformFilter === "instagram"} className={`source-pill social-source-pill source-instagram${platformFilter === "instagram" ? " filter-active" : ""}`} onClick={()=>{setPlatformFilter("instagram");setPlatform("instagram")}}>Instagram</button><button type="button" aria-pressed={platformFilter === "tiktok"} className={`source-pill social-source-pill source-tiktok${platformFilter === "tiktok" ? " filter-active" : ""}`} onClick={()=>{setPlatformFilter("tiktok");setPlatform("tiktok")}}>TikTok</button><button type="button" className="source-pill social-source-pill source-onlyfans" disabled><OnlyFansMark/>OnlyFans <small>SOON</small></button><button type="button" className="source-pill social-source-pill source-reddit" disabled><RedditMark/>Reddit <small>SOON</small></button><form className="discovery-search" onSubmit={(e)=>{e.preventDefault();loadLaunches(search)}}><Search size={17}/><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search coin, contract or creator"/><button>Search</button></form></div></div>
      <div className="launch-grid">{visibleLaunches.length ? visibleLaunches.map((launch)=><article className="launch-tile" key={launch.id}><div className="coin-media">{launch.logoUrl ? <img src={launch.logoUrl} alt={`${launch.name || launch.symbol} coin`}/> : <strong>{launch.symbol?.slice(0,1) ?? "P"}</strong>}<span className="live-dot">LIVE</span><a className="creator-chip" href={linkedCreatorProfile(launch.platform, launch.creatorHandle)} target="_blank" rel="noreferrer" title={`Open @${launch.creatorHandle} on ${launch.platform}`}><CreatorAvatar avatar={launch.creatorAvatar} platform={launch.platform} handle={launch.creatorHandle}/><b>@{launch.creatorHandle}</b>{launch.creatorStatus === "verified" && <BadgeCheck size={15}/>}<ExternalLink size={11}/></a></div><div className="coin-details"><div className="coin-title"><div><h3>{launch.name || "PONS launch"}</h3><b>${launch.symbol || "TOKEN"}</b></div><span>{launch.platform}</span></div><p>{launch.description || "Creator-linked PONS launch."}</p><div className="contract-line"><small>COIN</small><code title={launch.tokenAddress}>{launch.tokenAddress.slice(0,8)}…{launch.tokenAddress.slice(-6)}</code></div>{launch.vaultAddress && <a className="vault-line" href={`https://robinhoodchain.blockscout.com/address/${launch.vaultAddress}`} target="_blank" rel="noreferrer" title={launch.vaultAddress}><small>CREATOR FEE VAULT</small><code>{launch.vaultAddress.slice(0,8)}…{launch.vaultAddress.slice(-6)}</code><ExternalLink size={12}/></a>}<a href={`https://www.ponsfamily.com/launchpad/${launch.tokenAddress}`} target="_blank" rel="noreferrer">Open market <ExternalLink size={14}/></a></div></article>) : <div className="empty-launches"><Rocket/><h3>{platformFilter === "all" ? "The first PONSPAY launch will appear here." : `No ${platformFilter === "instagram" ? "Instagram" : "TikTok"} launches yet.`}</h3><p>Connect a wallet, launch a coin, and route its creator fee to Instagram or TikTok.</p><a className="button primary" href="/launch">Launch the first coin</a></div>}</div>
    </section>
    }

    {view === "launch" &&
    <section className="launch-section" id="launch">
      <div className="launch-page-head"><span className="eyebrow">LAUNCH ON PONS</span><h2>Launch a coin for any creator.</h2><p>Choose an Instagram or TikTok profile. The 4% creator fee goes to their vault.</p></div>
      <div className="launch-workspace"><form className="control-card launch-card" onSubmit={launchCoin}><div className="step"><span>LAUNCH TOKEN</span><b>LIVE ROUTE</b></div><label>Creator profile · enter @handle or paste profile URL</label><PlatformSwitch value={platform} onChange={setPlatform}/><div className="input-wrap creator-input"><span>@</span><input value={handle} onChange={(e)=>{const value=e.target.value;setHandle(value);const detected=platformFromProfileInput(value);if(detected)setPlatform(detected)}} onBlur={()=>{const normalized=normalizeCreatorHandleInput(handle);if(normalized)setHandle(normalized)}} placeholder="@creator or https://instagram.com/creator" required/></div><div className="form-pair"><div><label>Coin name</label><input className="plain-input" value={coinName} onChange={(e)=>setCoinName(e.target.value)} placeholder="Creator Coin" required/></div><div><label>Ticker</label><input className="plain-input" value={symbol} onChange={(e)=>setSymbol(e.target.value.toUpperCase())} placeholder="CREATOR" maxLength={12} required/></div></div><label>Coin image</label><label className="image-upload"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e)=>{const file=e.target.files?.[0]??null;setLogoFile(file);setLogoPreview(file?URL.createObjectURL(file):"")}}/>{logoPreview ? <img src={logoPreview} alt="Coin preview"/> : <i><ImagePlus/><span>Upload PNG, JPG, WebP or GIF</span><small>Maximum 2 MB</small></i>}<b>{logoFile ? "Change image" : "Choose image"}</b></label><label>Website · fixed to creator profile</label><div className="fixed-profile-link"><Link2 size={16}/><span>{fixedCreatorWebsite || "Enter a creator profile above"}</span><small>FIXED</small></div><label>X / Tweet link <small>(optional)</small></label><input className="plain-input" type="url" inputMode="url" value={tweetUrl} onChange={(e)=>setTweetUrl(e.target.value)} placeholder="https://x.com/creator/status/…"/><label>Description</label><textarea className="plain-input launch-description" value={description} onChange={(e)=>setDescription(e.target.value)} placeholder="What is this launch about?" maxLength={500}/><div className="fixed-rule"><b>Review before signing</b><span>The coin and its creator fee vault are created automatically. Network fees are paid from your connected wallet.</span></div><button type="button" className="button quiet full" onClick={()=>connectWallet().catch((error)=>setMessage(error.message))}><Wallet size={17}/>{shortWallet}</button><button className={`button primary full launch-submit launch-submit-${platform}`} disabled={busy}>{busy ? "Launching coin…" : "Review and launch"}<ArrowRight size={17}/></button>{message && <output className="notice launch-notice">{message}</output>}{launchReceipt && <div className="launch-success"><CircleCheckBig/><div><b>Coin launched · vault created</b><span>Creator fees are linked to this public vault.</span></div><a href={`https://robinhoodchain.blockscout.com/address/${launchReceipt.vaultAddress}`} target="_blank" rel="noreferrer"><small>VAULT ADDRESS</small><code>{launchReceipt.vaultAddress}</code><ExternalLink size={14}/></a><a href={`https://robinhoodchain.blockscout.com/tx/${launchReceipt.launchTxHash}`} target="_blank" rel="noreferrer"><small>LAUNCH RECEIPT</small><code>{launchReceipt.launchTxHash.slice(0,10)}…{launchReceipt.launchTxHash.slice(-8)}</code><ExternalLink size={14}/></a></div>}</form><aside className="launch-preview"><div className="route-toast"><CircleDollarSign/><span><b>Creator route ready</b><small>{displayedHandle ? `Fees will route to @${displayedHandle}` : "Choose an Instagram or TikTok creator"}</small></span><i/></div><div className="preview-card"><div className="preview-media">{logoPreview ? <img src={logoPreview} alt="Token preview"/> : <span>+</span>}</div><div className="preview-meta"><div><h3>{coinName || "Token name"}</h3><b>${symbol || "TICKER"}</b></div><span>4% creator route</span></div><p>{description || "Your token description and linked creator will appear here before you sign."}</p><div className="preview-creator"><div className="mini-avatar">@</div><span><small>FEES ROUTED TO</small><b>{displayedHandle ? `@${displayedHandle}` : "Creator not selected"}</b></span><em>{platform}</em></div></div><div className="preview-rules"><span><ShieldCheck/><b>Website fixed to the creator profile</b></span><span><BadgeCheck/><b>Public route and payout receipts</b></span></div></aside></div>
    </section>
    }

    {view === "creator" && <>
    <section className="workspace-section" id="find"><div className="section-heading"><div><span className="eyebrow">CREATOR VAULT</span><h2>Claim your creator fees.</h2><p>Verify your social profile to sign in and open every coin and vault linked to you.</p></div></div><div className={`creator-session-banner ${creatorSessionStatus}`}>{creatorSessionStatus === "checking" ? <><span className="session-dot"/><div><b>Checking your creator sign-in…</b><small>Confirming your secure PONSPAY session.</small></div></> : creatorVault ? <><BadgeCheck/><div><b>Connected to PONSPAY as @{creatorVault.route.handle}</b><small>Your verified {creatorVault.route.platform} identity is signed in.</small></div><a href="#creator-rewards">View my rewards <ArrowRight size={15}/></a></> : <><ShieldCheck/><div><b>You are not signed in yet</b><small>Searching a handle is public lookup only. Use Verify Instagram or Verify TikTok to connect and unlock rewards.</small></div></>}</div><div className="console-grid"><form className="control-card" onSubmit={findFees}><div className="card-title"><BadgeCheck size={19}/><span><b>Verify and open my vaults</b><small>No profile URL required</small></span></div><div className="oauth-row creator-signin-row"><button type="button" disabled={busy} onClick={()=>verifyCreator("instagram")}><Camera size={16}/> Verify Instagram</button><button type="button" disabled={busy} onClick={()=>verifyCreator("tiktok")}><b>♪</b> Verify TikTok</button></div><small className="verification-note">Sign in securely through Phyllo. PONSPAY never sees your social password.</small><small className="mobile-verification-note">On phone, continue in the provider sign-in screen. If PONSPAY is open inside Instagram or TikTok, reopen it in Safari or Chrome first.</small>{message && <output className="notice creator-auth-notice" role="status" aria-live="polite">{message}</output>}<div className="or-line creator-search-divider"><span>or search without signing in</span></div><PlatformSwitch value={platform} onChange={setPlatform}/><label>Profile handle or URL</label><div className="input-wrap"><span>@</span><input value={handle} onChange={(e)=>{const value=e.target.value;setHandle(value);const detected=platformFromProfileInput(value);if(detected)setPlatform(detected)}} onBlur={()=>{const normalized=normalizeCreatorHandleInput(handle);if(normalized)setHandle(normalized)}} placeholder="creator or profile URL" required/></div><button className="button primary full" disabled={busy}>{busy ? "Checking…" : "Find linked coins"}<ArrowRight size={17}/></button></form><div className="result-card"><span className="eyebrow">PUBLIC LOOKUP</span>{route ? <><div className="route-identity"><div className="avatar">{route.avatarUrl ? <img src={route.avatarUrl} alt=""/> : "@"}</div><div><h3>{route.displayName || `@${route.handle ?? displayedHandle}`}</h3><p>@{route.handle ?? displayedHandle} · {route.platform ?? platform}</p></div></div><div className={`public-route-state ${route.status === "verified" ? "verified" : "pending"}`}><ShieldCheck size={17}/><span><b>{route.status === "verified" ? "Verified creator route" : "Owner verification pending"}</b><small>{route.status === "verified" ? "This public profile has been verified by its creator." : "This lookup does not sign you in. Verify the profile above to open its rewards."}</small></span></div><div className="result-metrics"><span><small>Linked launches</small><b>{route.launches ?? "Ready"}</b></span><span><small>Public route status</small><b>{route.status ?? "Created"}</b></span></div><div className="route-key"><small>ROUTE</small><code>{route.vaultAddress || route.vaultKey}</code></div></> : <div className="empty-result"><div className="radar"><span/></div><h3>Verify your profile</h3><p>After secure sign-in, your linked coins and vaults open automatically.</p></div>}</div></div></section>

    {creatorVault && <section className="workspace-section creator-vault-section" id="creator-rewards"><div className="section-heading"><div><span className="eyebrow">MY REWARDS</span><h2>Your creator rewards.</h2><p>Claim available fee batches, then send the claimed balance to your EVM wallet.</p></div></div><div className="result-card"><div className="connected-kicker"><BadgeCheck/> Connected to PONSPAY</div><div className="route-identity"><div className="avatar">{creatorVault.route.avatarUrl ? <img src={creatorVault.route.avatarUrl} alt=""/> : "@"}</div><div><h3>{creatorVault.route.displayName || `@${creatorVault.route.handle}`}</h3><p>@{creatorVault.route.handle} · verified {creatorVault.route.platform}</p></div><BadgeCheck className="lime"/></div><div className="result-metrics"><span><small>Linked vaults</small><b>{creatorVault.vaults.length}</b></span><span><small>Open fee batches</small><b>{creatorVault.vaults.reduce((total, vault)=>total+Number(vault.openBatches),0)}</b></span><span><small>Ready to withdraw</small><b>{withdrawableVault ? `${Number(formatEther(BigInt(withdrawableVault.nativeBalanceRaw))).toFixed(6)} ETH` : "0 ETH"}</b></span></div><button type="button" className="button primary full" disabled={busy} onClick={claimToVault}>{busy ? "Claiming onchain…" : "Claim my rewards"}<ArrowRight size={17}/></button>{claimMessage && <output className="notice claim-notice" role="status" aria-live="polite">{claimMessage}</output>}{withdrawableVault && <><label>Send claimed balance to your wallet</label><small className="withdraw-help">Enter the EVM wallet address that should receive your claimed rewards.</small><input className="plain-input" value={withdrawTo} onChange={(event)=>setWithdrawTo(event.target.value)} placeholder="0x wallet address"/><button type="button" className="button quiet full" disabled={busy || !withdrawTo} onClick={withdrawCreatorBalance}>Withdraw full balance <ArrowRight size={17}/></button></>}</div></section>}
    </>}

    <footer className="site-footer"><div className="footer-brand"><div className="footer-wordmark">PONS<span>PAY</span></div><i aria-hidden="true"/><p>Launch coins. Pay creators.</p></div><nav className="footer-links" aria-label="Footer navigation">{X_URL ? <a href={X_URL} target="_blank" rel="noreferrer">X <small>↗</small></a> : <span title="Add the PONSPAY X URL before public launch">X <small>SOON</small></span>}<a href="/docs">Docs <small>↗</small></a>{GITHUB_URL ? <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub <small>↗</small></a> : <span title="Repository link will be added when published">GitHub <small>SOON</small></span>}<a href="https://www.ponsfamily.com/" target="_blank" rel="noreferrer">PONS <small>↗</small></a><a href="https://robinhoodchain.blockscout.com/" target="_blank" rel="noreferrer">Explorer <small>↗</small></a></nav></footer>
    </main>
    </div>
  </div>;
}

function OnlyFansMark() { return <span className="platform-mark onlyfans-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="5"/><circle cx="9" cy="12" r="2"/><path d="M13 8l8-3-5 6 4 1-8 5z"/></svg></span>; }
function RedditMark() { return <span className="platform-mark reddit-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M17.7 10.1c1.8.2 3.1 1.3 3.1 2.7 0 .8-.5 1.6-1.3 2.1.1.4.1.7.1 1.1 0 3-3.4 5.4-7.6 5.4S4.4 19 4.4 16c0-.4 0-.8.1-1.1-.8-.5-1.3-1.3-1.3-2.1 0-1.5 1.4-2.6 3.2-2.7A9.6 9.6 0 0 1 12 8.4c2.1 0 4 .6 5.7 1.7Z"/><circle cx="8.8" cy="14.2" r="1"/><circle cx="15.2" cy="14.2" r="1"/><path d="M8.6 17.1c1 .8 2.1 1.1 3.4 1.1s2.5-.3 3.4-1.1M13.5 8.5l1-4 3.2.7"/><circle cx="18.8" cy="5.5" r="1.4"/></svg></span>; }
function PlatformSwitch({value,onChange}:{value:"instagram"|"tiktok";onChange:(value:"instagram"|"tiktok")=>void}) {
  const row = useRef<HTMLDivElement>(null);
  const move = (direction: -1 | 1) => row.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  return <div className="platform-switch-shell"><button type="button" className="platform-scroll platform-scroll-prev" aria-label="Show previous platforms" onClick={()=>move(-1)}><ChevronLeft/></button><div className="platform-switch" ref={row}><button type="button" className={`platform-instagram${value==="instagram"?" active":""}`} onClick={()=>onChange("instagram")}><Camera size={16}/>Instagram</button><button type="button" className={`platform-tiktok${value==="tiktok"?" active":""}`} onClick={()=>onChange("tiktok")}><b>♪</b>TikTok</button><button type="button" className="soon-platform platform-onlyfans" disabled><OnlyFansMark/>OnlyFans <small>SOON</small></button><button type="button" className="soon-platform platform-reddit" disabled><RedditMark/>Reddit <small>SOON</small></button></div><button type="button" className="platform-scroll platform-scroll-next" aria-label="Show more platforms" onClick={()=>move(1)}><ChevronRight/></button></div>;
}
