/**
 * henriz-auth-client —— 各后台接入中央认证的 server-only 复用模块。
 *
 * 使用方式：把本文件复制到每个 app（Edit Page / Licentra / Verbia）的 `lib/` 下，
 * 或用 git submodule / 私有 package 引用。它只依赖 `node:crypto` 和全局 `fetch`，
 * **禁止**被打进浏览器包：它持有 client secret。
 *
 * 用法见 auth-henriz-dev 仓库的 `docs/SSO_INTEGRATION.md`。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export type HenrizAuthMethod = "passkey" | "totp" | "bootstrap";

/** `/api/token` 返回的最小断言，字段由 `Henriz-Auth-Version: 1` 版本化。 */
export interface HenrizClaims {
  sub: string;
  auth_time: number;
  auth_method: HenrizAuthMethod;
  central_session_id: string;
  issued_at: number;
}

export interface HenrizAuthClientOptions {
  /** 中央认证服务 origin，例如 https://auth.henriz.dev */
  baseUrl: string;
  /** 该 app 专属的 client id */
  clientId: string;
  /** 仅存放在服务端环境变量中，绝不进浏览器 */
  clientSecret: string;
  /** 必须与 auth 端注册的 redirect URI 逐字符一致 */
  redirectUri: string;
  /** 一次登录事务 Cookie 名，默认 `__Host-<clientId>_oauth` */
  transactionCookieName?: string;
  /** 登录事务有效期（秒），默认 600 */
  transactionTtlSeconds?: number;
}

export interface AuthCookie {
  name: string;
  value: string;
  options: { httpOnly: true; secure: true; sameSite: "lax"; path: "/"; maxAge: number };
}

export type CompleteLoginResult =
  | { ok: true; claims: HenrizClaims; returnTo: string }
  | { ok: false; reason: "state_mismatch" | "exchange_failed" | "malformed_response" };

const STATE_PATTERN = /^[A-Za-z0-9._~-]{32,512}$/;
const METHODS: HenrizAuthMethod[] = ["passkey", "totp", "bootstrap"];

function sameString(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

/** 只接受站内相对路径，挡掉 `//evil.com`、反斜杠和控制字符。 */
export function sanitizeReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

export function createHenrizAuthClient(options: HenrizAuthClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const transactionCookieName = options.transactionCookieName ?? `__Host-${options.clientId}_oauth`;
  const transactionTtlSeconds = options.transactionTtlSeconds ?? 600;

  /** 第 1 步：生成 state + PKCE，返回要跳转的 authorize URL 和要落的事务 Cookie。 */
  function beginLogin(returnTo: string | null | undefined): { authorizeUrl: string; cookie: AuthCookie } {
    const verifier = randomBytes(64).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const authorizeUrl = new URL(`${baseUrl}/authorize`);
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    const transaction = Buffer.from(JSON.stringify({ state, verifier, returnTo: sanitizeReturnTo(returnTo) })).toString("base64url");
    return {
      authorizeUrl: authorizeUrl.toString(),
      cookie: { name: transactionCookieName, value: transaction, options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: transactionTtlSeconds } },
    };
  }

  /** 第 2 步：在校验过 state/事务 Cookie 之后，用 code 换 claims。失败一律不区分原因。 */
  async function completeLogin(input: { code: string | null; state: string | null; transaction: string | undefined }): Promise<CompleteLoginResult> {
    const { code, state, transaction } = input;
    if (!code || !state || !transaction || !STATE_PATTERN.test(state)) return { ok: false, reason: "state_mismatch" };
    let parsed: { state?: unknown; verifier?: unknown; returnTo?: unknown };
    try { parsed = JSON.parse(Buffer.from(transaction, "base64url").toString("utf8")); } catch { return { ok: false, reason: "state_mismatch" }; }
    if (typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || !sameString(parsed.state, state)) return { ok: false, reason: "state_mismatch" };
    try {
      const response = await fetch(`${baseUrl}/api/token`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: options.redirectUri, code_verifier: parsed.verifier }),
      });
      if (!response.ok) return { ok: false, reason: "exchange_failed" };
      const claims = (await response.json()) as Partial<HenrizClaims>;
      if (typeof claims.sub !== "string" || typeof claims.auth_time !== "number" || typeof claims.central_session_id !== "string" || !METHODS.includes(claims.auth_method as HenrizAuthMethod)) {
        return { ok: false, reason: "malformed_response" };
      }
      return { ok: true, claims: claims as HenrizClaims, returnTo: sanitizeReturnTo(typeof parsed.returnTo === "string" ? parsed.returnTo : null) };
    } catch { return { ok: false, reason: "exchange_failed" }; }
  }

  /** 回调结束后（无论成败）都要清掉事务 Cookie。 */
  function clearTransaction(): AuthCookie {
    return { name: transactionCookieName, value: "", options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 } };
  }

  return { transactionCookieName, beginLogin, completeLogin, clearTransaction, sanitizeReturnTo };
}

export type HenrizAuthClient = ReturnType<typeof createHenrizAuthClient>;
