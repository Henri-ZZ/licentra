/**
 * Bootstrap / rotate the dashboard TOTP (two-factor) secret.
 *
 * - No args: if a secret already exists, keep it and just re-print the QR
 *   (so you can re-scan into a new device). Otherwise generate + store one.
 * - `--rotate`: generate a fresh secret and replace the old one (all
 *   previously issued codes stop working).
 *
 * Outputs the otpauth URI, the base32 secret (manual entry fallback), and
 * saves a QR PNG to ./totp-setup-qr.png — scan it into your password
 * manager / authenticator, then DELETE the PNG (it contains the secret).
 *
 * Run: pnpm tsx scripts/bootstrap-2fa.ts
 */
import "./load-env"; // must be the FIRST import (loads .env.local before Prisma)

import path from "node:path";
import QRCode from "qrcode";

import { env } from "../src/lib/env";
import { prisma } from "../src/lib/prisma";
import {
  generateTotpSecret,
  getTotpSecret,
  setTotpSecret,
  totpUri,
} from "../src/lib/totp";

async function main() {
  const rotate = process.argv.includes("--rotate");

  let secret = await getTotpSecret();
  if (!secret || rotate) {
    secret = generateTotpSecret();
    await setTotpSecret(secret);
    console.log(
      rotate ? "✓ 已轮换并保存新的 TOTP 密钥" : "✓ 已生成并保存 TOTP 密钥"
    );
  } else {
    console.log(
      "ℹ 已存在 TOTP 密钥，保留原密钥并重新生成二维码（如需更换密钥请加 --rotate）"
    );
  }

  const uri = totpUri(secret, env.ADMIN_EMAIL);
  const qrPath = path.join(process.cwd(), "totp-setup-qr.png");
  await QRCode.toFile(qrPath, uri, {
    width: 300,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  console.log(`\notpauth URI: ${uri}`);
  console.log(`\nSecret（手动输入用）: ${secret}`);
  console.log(`\n二维码已保存: ${qrPath}`);
  console.log("→ 用密码管理器/身份验证器扫码后，请删除该 PNG（二维码内含密钥）");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
