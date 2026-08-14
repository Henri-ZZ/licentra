# Licentra

License key 销售与激活管理平台：售卖侧接 Paddle、签发 Key 并邮件投递；使用侧提供本地可验签的 License API；管理侧是一个 Dashboard。

---

## 1. 系统定位

Licentra 是一个 **License key 服务端**（不是客户的桌面应用本体）。它做三件事：

1. **卖 Key** — 客户在 Paddle 付款，Licentra 收到 webhook，签发一个 Key，通过邮件（Resend）一次性投递。
2. **用 Key** — 客户的桌面/移动应用调用 Licentra 的 License API（activate / check-in），Licentra 返回一段**用产品 ECDSA 私钥签名的 payload**。客户应用**离线本地验签**（公钥嵌入客户自己的代码里），不必每次都打网络。
3. **管 Key** — 运营者登录 Dashboard：创建产品、生成每产品的密钥对、查看 License、吊销、重发邮件、查订单流水。

---

## 2. 关键设计决策

### 2.1 原始 Key 不入库

客户收到的原始 key（如 `K3PQ-W7HN-8YJZ-V9D2`）只在内存中存在；入库只存 SHA-256 hash。原始 key 通过邮件一次性送达。

**后果**：

- DB 泄漏不会泄漏可用的 key
- 邮件发送失败 → 原始 key 丢失 → 需要重发时**换发新 Key**（见 §5.4：在**同一行**上轮换 key hash，License 身份与设备激活保持不变，不新建 License）
- License Key 本身即凭证，不需要额外的 API key 鉴权；安全靠 16 字符随机（≈95 bit 熵）+ HTTPS + 邮件投递渠道安全

**身份 vs 凭据**（详见 [licentra-offline-migration-spec.md](licentra-offline-migration-spec.md)）：

```text
License Key     = 凭据（只存 hash，可轮换）
License ID      = License.id，永久身份，永远不变
Signed Certificate = Ed25519 签名的可移植证明（离线可验）
```

### 2.2 离线验签 + 强制在线 check-in

客户端拿到 `{payload, signature}` 后**纯本地验签**——不需要每次访问 API。但本地验签**只能证明"服务端在签名那一刻认为这个 key 有效"**，**不能反映运行时变化**：

- 设备被新设备挤掉名额（FIFO 踢出）
- 用户退款
- License 被吊销
- 产品下线

所以客户端必须**每 24 小时调一次** `/api/license/check-in`（v1 固定 24h），让服务端把当前最新签名回传。如果服务端发现该 fingerprint 已被踢出 / license 已被吊销 / 已退款，就返回 `valid: false` + `reason`，客户端清缓存。

### 2.3 每产品独立密钥对 + Licentra 级签名键

不同产品用不同的 ECDSA P-256 密钥对。客户应用按 `payload.product` 字段在本地公钥表里挑公钥验签：

```
PUBLIC_KEYS = {
  "stealth-browser-assistant": `<PEM>`,
  "other-product": `<PEM>`,
}
```

每产品的私钥用 `LICENSE_MASTER_KEY`（AES-256-GCM）加密后存在 `Product.privateKeyEncrypted`。**主密钥泄漏则所有产品私钥泄漏**——必须严格保管。

**另外**，Licentra 维护一把**全局 Ed25519 签名键**（`SigningKey` 表，私钥同样用 `LICENSE_MASTER_KEY` 加密），用于签发：

- **Signed License Certificate**：每次 activate/check-in 成功都随响应下发，客户端本地保存，离线可验，是迁移的"便携证明"；
- **签名批量导出**：`POST /api/v1/migration/export` 导出的整包文档。

这把键与每产品的 ECDSA 键完全独立；`kid` 标识（如 `licentra-2026-08`），轮换时旧公钥保留在 `GET /api/v1/well-known/licentra-keys` 供旧证书验证。

### 2.4 FIFO 踢出

每个 Product 配置 `maxActivations`（默认 3）。`/api/license/activate` 时：

1. 同 fingerprint 已绑定 → 仅刷新 `lastCheckedAt`（幂等）
2. 新 fingerprint + 未满 → 直接注册
3. 新 fingerprint + 已满 → 删除**最早**一条 Activation（按 `createdAt asc`），再注册新的

整个流程在 `prisma.$transaction` 里跑，保证踢出和注册的原子性。

### 2.5 Paddle webhook 是主渠道，Dashboard 可手动创建

正常售卖：License 由 Paddle 付款事件触发签发，避免"签发了 Key 但没收到钱"的不一致。webhook 幂等靠 `Order.paddleTransactionId` 唯一约束 + handler 幂等（无 WebhookEvent 表，Paddle 后台保存投递记录）。

**手动创建**（`POST /api/licenses`，admin）：线下 / 赠送 / 客服补偿等无 Paddle 交易的场景。只填邮箱即可（产品从下拉选），成功弹窗一次性展示 License Key——明文 key 依旧不入库。手创 License **没有 Order 关联**：Paddle 退款 webhook 不会自动吊销它，需要时在 dashboard 手动 Revoke。该端点仅 admin 会话可调。

### 2.6 单用户鉴权

v1 没有 User 表，`ADMIN_EMAIL` / `ADMIN_PASSWORD` 写死（常量时间比较），登录后下发 HS256 JWT cookie。`proxy.ts`（Next.js 16 重命名自 `middleware.ts`）保护 `/dashboard/*`。**后续接多用户只需把 `verifyCredentials` 换成 Prisma lookup**。

### 2.7 离线迁移架构（v1 落地范围）

完整协议见 [licentra-offline-migration-spec.md](licentra-offline-migration-spec.md)。核心：**迁移不依赖 Licentra API 保持在线**。

```text
正常运营期：
  activate / check-in 成功
        ↓
  返回 ECDSA payload + Signed License Certificate（Ed25519）
        ↓
  客户端本地保存 Key + Certificate

下线迁移期：
  数据库层面：POST /api/v1/migration/export → 签名整包导出 → 目标系统用 Licentra 公钥离线验证 → 建目标 License（1000 个 license 全量导入，不需要用户在线）
  客户端层面：已有证书的客户端 → 目标系统离线验证书 → 换发目标凭据（不再依赖 Licentra API）
```

v1 已实现：稳定 `license_id`（= `License.id`，轮换/迁移不变）、key 只存 hash、License 自包含客户信息（`customerId`/`email`）、`SigningKey`（Ed25519 + `kid` + 轮换保留旧键）、公钥发现端点、证书签发（内置在 activate/check-in）、签名批量导出、审计事件（key_rotated / status_changed / migration_exported）。**暂缓**：迁移导入 UI / 批量导入 / 迁移 dashboard（导入是目标系统侧职责）。

---

## 3. 数据模型

```
Product ─┬─< License ─< Activation
         └─< Order ─< License
SigningKey  (Licentra 级 Ed25519 签名键，独立)
AuditEvent  (生命周期 / 迁移审计，独立)
```

| 表             | 关键字段                                                                                                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Product`      | `slug` (unique), `paddleProductId` (unique), `privateKeyEncrypted`, `publicKey`, `publicKeyFingerprint` (unique), `maxActivations`, `signatureTtlSeconds`, `supportEmail`             |
| `License`      | `id` (**永久 License 身份**), `keyHash` (unique, **SHA-256(原始 key)，可轮换**), `productId`, `orderId`, `tierId`/`plan`/`expiresAt` (快照), `maxActivations`, `revoked`/`revokedAt`/`revokedReason`, `customerId`/`email`, `emailedAt`/`emailError`/`emailAttempts` |
| `Activation`   | `licenseId`, `fingerprint` (**SHA-256(原始设备指纹)**, 不是原始值), `label`, `ipAddress`, `browser` (**精简 UA：如 `Chrome 126 · macOS`**), `lastCheckedAt`, 唯一 `(licenseId, fingerprint)` |
| `Order`        | `paddleTransactionId` (unique), `paddleEmail`, `productId`, `amount`(分), `currency`, `status`, `locale`                                                                                 |
| `SigningKey`   | `kid` (unique, 如 `licentra-2026-08`), `algorithm`(Ed25519), `privateKeyEncrypted`, `publicKey`, `active`, `retiredAt` — 轮换保留旧键 |
| `AuditEvent`   | `eventType`(`license.key_rotated` / `license.status_changed` / `license.migration_exported`), `licenseId`, `sourceSystem`/`sourceLicenseId`/`destinationSystem`/`migrationId`, `actor`, `metadata` |

> 无 WebhookEvent 表：Paddle 后台保存权威投递记录（含重试与 payload）；幂等靠 `Order.paddleTransactionId` 唯一 + handler 本身幂等。物理表名仍为 `LicenseKey`（`@@map` 保留）。

> 物理表名仍为 `LicenseKey`（`@@map` 保留，`db push` 不会重建表丢数据）；代码模型名已改为 `License`，语义上区分"身份"与"凭据"。

完整定义见 [prisma/schema.prisma](prisma/schema.prisma)。

---

## 4. 关键流程

### 4.1 售卖流程（一次完整交易）

```
客户付款 → Paddle → POST /api/webhook/paddle (transaction.completed)
  │
  ├─ 验签 (HMAC-SHA256 over `${ts}.${rawBody}`, ±5min 时窗)
  ├─ 解析 custom_data.productId → 找 Product (要求 privateKeyEncrypted 已就绪)
  │
  ├─ 已有 Order.paddleTransactionId 记录?
  │   ├─ 是 → 复用, 检查 emailedAt, 没发就重试（幂等）
  │   └─ 否 → 继续（并发重复投递撞唯一约束 → P2002 → 视为已处理跳过）
  │
  ├─ prisma.order.create({ paddleTransactionId, paddleEmail, productId, amount, currency, status, locale })
  │    ※ 不存完整 Paddle 事件 JSON（Paddle 后台保留投递记录）
  ├─ rawKey = generateLicenseKey()    // K3PQ-W7HN-8YJZ-V9D2
  ├─ prisma.license.create({ keyHash: sha256(rawKey), productId, orderId, tierId/plan/expiresAt, maxActivations, customerId, email })
  │
  ├─ 邮件 (Resend 或 stub):
  │   渲染 ProductEmailTemplate.subject / bodyHtml
  │   占位符 {{key}} {{productName}} {{plan}} {{orderId}} {{email}} {{maxActivations}} {{supportEmail}}
  │   发到 paddleEmail
  │   成功 → emailedAt = now
  │   失败 → emailError, emailAttempts++, throw → webhook 返回 500 → Paddle 重试
  │
  └─ 200
```

**重试策略**（无 WebhookEvent 表，幂等靠 Order 唯一 + handler 幂等）：

- 同 `paddleTransactionId` 重发（Paddle 会重发整个 transaction 或同一事件重试）：
  - Order 已存在且 `emailedAt != null` → 直接 200
  - Order 已存在且 `emailedAt == null` → 重发邮件（**此时原始 key 已丢**——v1 行为：写 `emailError: "raw key not retained across retries"`，要求 admin 在 dashboard 重发）
  - 两个并发首投 → 一个成功，另一个撞 `paddleTransactionId` 唯一约束被捕获为 P2002 → 跳过

### 4.2 退款流程

Paddle `transaction.updated` + status ∈ {refunded, partially_refunded, canceled, cancelled}：

```
handleTransactionUpdated
  ├─ 找 Order (by paddleTransactionId)
  ├─ 只取尚未 revoked 的 License（幂等：同一退款多次投递不重复处理/不重复审计）
  ├─ prisma.$transaction:
  │   ├─ order.status = tx.status
  │   └─ 未 revoked 的 License:
  │       revoked = true
  │       revokedAt = now
  │       revokedReason = "refunded"
  ├─ 每条 License 写一条 audit: license.status_changed
  └─ 已激活设备的客户端下次 check-in 收到 { valid: false, reason: "license_refunded" }
```

### 4.3 客户端使用流程

```
启动 App
  │
  ├─ 有缓存 payload+signature+publicKey?
  │   └─ 是 → 本地 ECDSA 验证
  │       ├─ 失败 → 弹"无效"提示, 清缓存, 重新激活流程
  │       └─ 成功 → 看 valid_until 是否已过
  │           ├─ 未过期 → 直接进入应用
  │           └─ 已过期 → 调 /api/license/check-in 刷新签名
  │
  └─ 无缓存 / 首次启动 → POST /api/license/activate
      { key, fingerprint, label }
        │
        └─ 服务端:
            ├─ license 不存在 / 吊销 → { valid: false }
            ├─ 同 fingerprint → refresh lastCheckedAt → 签名 + 证书 返回
            ├─ 新 fp + 未满 → 注册 → 签名 + 证书 返回
            └─ 新 fp + 已满 → FIFO 踢最早 + 注册 → 签名 + 证书 返回
```

成功响应除 `{ valid, payload, signature }` 外，还附带 **`certificate`**（Licentra Ed25519 签发的 Signed License Certificate）。客户端把证书存本地——即使未来 Licentra 下线，也能凭证书向新 License 系统离线迁移（见 [licentra-offline-migration-spec.md](licentra-offline-migration-spec.md)）。

### 4.4 各 API 行为一览

| 端点                           | 入参                                               | 行为                                              | 副作用           |
| ------------------------------ | -------------------------------------------------- | ------------------------------------------------- | ---------------- |
| `POST /api/license/activate`   | `{ key, fingerprint, label? }`                     | 同 fp 刷新 / 新 fp 注册 / 满则 FIFO 踢出；返回 ECDSA payload + **Signed Certificate** | 写 Activation    |
| `POST /api/license/check-in`   | `{ key, fingerprint }`                             | 验证 license + 验证 fp 仍绑定，刷新 lastCheckedAt；返回 payload + **Signed Certificate** | 写 lastCheckedAt |
| `GET /api/v1/well-known/licentra-keys` | —                                          | 公开返回 Licentra Ed25519 公钥集（含已轮换旧键）  | 无               |
| `POST /api/v1/migration/export` | `{ productId?, licenseIds?, destinationSystem?, includeCustomerData?, migrationId? }` | admin 会话 + 限流；生成**签名批量导出**；写审计 | 写 AuditEvent    |
| `POST /api/licenses`   | `{ productId, email }`                                | admin 手动创建 License（无 Paddle 订单）；返回一次性 License Key | 写 License       |

License API **不做鉴权**（key 即凭证）。`/api/webhook/paddle` 用 HMAC 验签；`/api/products/*`、`/api/licenses*` 和 `/api/v1/migration/export`（管理用）走 dashboard session。公钥发现端点公开只读。

---

## 5. 使用手册

### 5.1 首次启动（运营者）

```bash
pnpm install
cp .env.example .env.local      # 填 Neon URL + Paddle webhook secret + Resend key + LICENSE_MASTER_KEY
pnpm prisma db push             # 建表
pnpm dev                        # 起 http://localhost:3000
```

### 5.2 创建一个新产品并接入 Paddle

1. **Dashboard → Products → New product**
   - `name` / `slug`（slug 决定客户应用按它挑公钥）
   - `plan` / `maxActivations`
   - `emailSubject` / `emailBodyHtml` / `resendFromAddress`（可选，不填用 DEFAULT）
2. **进入产品详情页 → "Generate signing key"**
   - 生成 ECDSA P-256 密钥对
   - 私钥 AES-256-GCM 加密后入库
   - 页面展示**公钥 PEM** 和 fingerprint — **公钥要给产品方嵌入他们的代码**
3. **Paddle Dashboard**：
   - 创建一个 Product + Price
   - 复制 `paddleProductId` 和 `paddlePriceId`，填回 Licentra 产品编辑页
   - 在 webhook 配置里：
     - URL = `https://YOUR-DOMAIN/api/webhook/paddle-transaction-completed`（completed）/ `.../paddle-transaction-updated`（updated）
     - 事件 = `transaction.completed` + `transaction.updated`
     - **Notification secret** = 填到 Licentra 的 `PADDLE_WEBHOOK_SECRET`
4. **Paddle checkout 集成**：`custom_data.productId` 传 Licentra 的 `Product.id`（不是 Paddle product_id）。这样 webhoook 解析最可靠。

### 5.3 客户应用嵌入示例

```js
// 产品方在自己代码里嵌入 (来自 Licentra dashboard 复制)
const PUBLIC_KEYS = {
  "stealth-browser-assistant": `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...
-----END PUBLIC KEY-----`,
};

function verifyLicense({ payload, signature }) {
  const publicKeyPem = PUBLIC_KEYS[payload.product];
  if (!publicKeyPem) return false;
  return crypto.verify(
    "sha256",
    Buffer.from(JSON.stringify(payload), "utf8"),
    crypto.createPublicKey(publicKeyPem),
    Buffer.from(signature, "base64"),
  );
}
```

完整调用序列参考 [README §API](README.md)。

### 5.4 日常运营

| 场景                    | 操作                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 客户说自己没收到 key    | Dashboard → Licenses → 搜邮箱 → "Resend email"（**换发新 key**：在同一行轮换 `keyHash`，License 身份/设备激活/迁移字段不变，旧 key 立即失效） |
| 线下 / 赠送 / 补偿发 key | Dashboard → Licenses → "New license" → 选产品 + 填邮箱 → 弹窗复制 License Key（明文只展示一次，不入库） |
| 客户退款                | Paddle 自动 → webhook → license 自动 revoked；无需手动操作                                           |
| 客户超过 maxActivations | 自动 FIFO 踢出最早一台；不需要 admin 介入。客户被踢出的设备下次启动会拿到 `valid: false`             |
| 紧急吊销某个 key        | Dashboard → Licenses → Revoke（reason 可选）                                                         |
| 改邮件模板              | Dashboard → Products → 编辑 → 立刻对**后续新订单**生效；存量订单仍用创建时的模板                     |
| 迁移到新 License 系统   | `POST /api/v1/migration/export` 拉取签名导出包；客户端凭本地 Signed Certificate 离线换证（见 offline-migration-spec） |

### 5.5 烟雾测试

```bash
pnpm tsx scripts/smoke-sign.ts
```

验证（无 DB）：密钥对生成、AES round-trip、签名 DER 前缀 `MEU...`、本地验签、License key 生成 + 格式正则。

---

## 6. 安全模型

| 项               | 说明                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| License Key 存储 | 只存 SHA-256(原始 key)。原 key 邮件一次性投递，不入 DB                                                |
| Webhook 验签     | HMAC-SHA256 over `${ts}.${rawBody}`，时窗 ±5min，常量时间比较                                         |
| Dashboard 鉴权   | HS256 JWT in `httpOnly` cookie，单用户硬编码 env                                                      |
| License API 鉴权 | **无**（key 即凭证）。安全模型：16 字符 ≈95 bit 熵 + HTTPS + 邮件渠道安全                             |
| 产品私钥         | AES-256-GCM 加密，`LICENSE_MASTER_KEY` 是 32-byte hex（64 chars）                                     |
| 设备指纹         | 入库前 SHA-256；DB 泄漏不暴露原始设备标识                                                             |
| 签名序列化       | `JSON.stringify(payload)` 键顺序必须固定：`product → plan → license_id → license_expires_at → valid_until`。改动 = 协议破坏 |
| License 证书     | Ed25519，`kid` 标识签名键，规范序列化字段顺序冻结（`type → version → … → nonce`）；公钥经 `/api/v1/well-known/licentra-keys` 发现 |
| 迁移导出         | 仅 admin 会话可调 + 限流（10/min/IP）+ 全量审计；导出的签名文档离线可验，**不含明文 key / 私钥** |
| 主密钥泄漏       | ⇒ 所有产品私钥可解 ⇒ 所有 license 可伪造。**生产环境必须用 KMS 或 secret manager**                    |

### 不在 v1 范围

- 多用户 / 角色权限
- License API 限流（生产建议加 Upstash Redis；迁移导出端点已用内存限流器兜底）
- Webhook 重试 UI（Paddle 后台已有投递日志与重试）
- 邮件模板实时预览
- 迁移导入 UI / dashboard（导入是目标系统侧职责，Licentra 只负责导出）
- 测试套件（构建通过；建议加 Vitest + Playwright）

---

## 7. 文件结构

```
licentra/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── smoke-sign.ts                  # 无 DB 冒烟：ECDSA + Ed25519 证书 + 导出
│   ├── bootstrap-signing-key.ts       # 首次生成 / --rotate 轮换 Licentra 签名键
│   └── migrate-product-tiers.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/                # 登录页
│   │   ├── (dashboard)/dashboard/       # 受保护的后台
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                 # 总览
│   │   │   ├── products/                # 产品 CRUD
│   │   │   ├── licenses/                # License 列表（按产品筛选）/ 手动创建 / 详情 / 吊销 / 重发
│   │   │   └── orders/                  # Paddle 订单流水
│   │   ├── api/
│   │   │   ├── auth/{login,logout}/     # 鉴权
│   │   │   ├── license/{activate,check-in}/   # 客户端验证（返回 ECDSA payload + 证书）
│   │   │   ├── webhook/paddle/          # Paddle 入口
│   │   │   ├── v1/well-known/licentra-keys/   # Ed25519 公钥发现（公开）
│   │   │   ├── v1/migration/export/           # 签名批量导出（admin + 限流 + 审计）
│   │   │   ├── products/                # 管理 CRUD + generate-key
│   │   │   ├── licenses/                # 管理：POST 手动创建
│   │   │   └── licenses/[id]/{revoke,resend-email}/
│   │   ├── layout.tsx
│   │   └── page.tsx                     # / → 重定向到 /dashboard 或 /login
│   ├── components/
│   │   ├── ui/                          # shadcn 手写组件
│   │   └── dashboard/{sidebar,header}
│   ├── lib/
│   │   ├── auth.ts                      # JWT cookie + 常量时间凭据校验
│   │   ├── certificate.ts               # Ed25519 Signed License Certificate：签发/离线验证 + 签名键管理
│   │   ├── migration-export.ts          # 签名批量导出文档（§21）
│   │   ├── audit.ts                     # AuditEvent 写入（key_rotated / status_changed / migration_*）
│   │   ├── rate-limit.ts                # 内存限流（迁移端点）
│   │   ├── crypto.ts                    # AES-256-GCM
│   │   ├── email.ts                     # Resend + 占位符渲染 + stub 模式
│   │   ├── env.ts                       # zod 校验
│   │   ├── fingerprint.ts               # SHA-256 + 公私钥指纹
│   │   ├── license-key.ts               # 16 字符生成 + 格式校验
│   │   ├── license-query.ts             # loadLicenseByHash / buildLicensePayload / buildLicenseResponse（含证书）
│   │   ├── license-sign.ts              # ECDSA P-256 + DER + base64
│   │   ├── paddle.ts                    # 验签 + 事件类型
│   │   ├── prisma.ts                    # Neon adapter 单例
│   │   └── utils.ts
│   └── proxy.ts                         # Next.js 16 (前身 middleware.ts) — 保护 /dashboard
├── prisma.config.ts                     # Prisma 7 配置 + 自加载 .env.local
├── next.config.ts
├── package.json
├── pnpm-workspace.yaml                  # pnpm 11 allowBuilds
├── tailwind config 内联在 globals.css   # Tailwind v4 @theme inline
└── README.md
```

---

## 8. API 速查

### `POST /api/license/activate`

```json
请求: { "key": "...", "fingerprint": "<设备指纹原文>", "label": "MacBook Pro" }
成功响应:
{
  "valid": true,
  "payload": {
    "product": "stealth-browser-assistant",
    "plan": "pro",
    "license_id": "abc123",
    "license_expires_at": null,
    "valid_until": "2026-08-14T16:00:00.000Z"
  },
  "signature": "MEUCIQ...",
  "certificate": {
    "type": "licentra_license_certificate",
    "version": 1,
    "issuer": "licentra",
    "kid": "licentra-2026-08",
    "license_id": "abc123",
    "product_id": "stealth-browser-assistant",
    "plan": "pro",
    "status": "active",
    "max_devices": 3,
    "issued_at": 1786700000,
    "expires_at": null,
    "nonce": "...",
    "signature": "<base64 Ed25519>"
  }
}
失败响应: { "valid": false, "reason": "license_not_found" | "license_revoked" | "license_refunded" }
```

> `certificate` 即 **Signed License Certificate**：Licentra 用全局 Ed25519 键签发的 License 状态快照。客户端应本地保存；吊销/退款等实时状态仍需 online check-in 反映。验证用公钥见 `GET /api/v1/well-known/licentra-keys`（按 `kid` 取键）。

### `POST /api/license/check-in`

```json
请求: { "key": "...", "fingerprint": "..." }
成功响应: 同 activate（含新签发的 certificate）
失败响应: 同 activate，另加 "activation_evicted"（指纹被踢出）
```

### `POST /api/v1/migration/export`

admin 会话 + 限流。返回整包签名导出（`type: licentra_license_migration_export`），含全部 License 的 `license_id/product_id/plan/status/max_devices/expires_at/created_at`，可用 `productId` / `licenseIds` 过滤，`includeCustomerData: true` 时附加 `email`/`customer_id`。离线迁移协议见 [licentra-offline-migration-spec.md](licentra-offline-migration-spec.md)。

### `POST /api/webhook/paddle`

由 Paddle 调用（HMAC 验签）。客户端应用不应直接调用。

---

## 9. 部署 checklist

- [ ] 生产 env 全部覆盖（**不要**用 `src/lib/env.ts` 的默认值）
- [ ] `AUTH_JWT_SECRET` 32 字节随机（`openssl rand -hex 32`）
- [ ] `LICENSE_MASTER_KEY` 32 字节 hex（64 chars），用 KMS / secret manager
- [ ] `RESEND_API_KEY` 是真实 key，不是 `re_dev`
- [ ] `PADDLE_WEBHOOK_SECRET` 是 Paddle 后台给的真实 secret
- [ ] Neon DB 加 IP 白名单（Vercel egress）
- [ ] 上线前用 `pnpm build` 通过；用 `pnpm tsx scripts/smoke-sign.ts` 验证签名管线
- [ ] 首次部署跑 `pnpm bootstrap:signing-key` 生成 Licentra Ed25519 签名键（此后每次 activate/check-in 自动签发证书；轮换用 `--rotate`）
- [ ] Dashboard 默认密码已改
- [ ] 第一个 Product 已创建 + 签名密钥已生成 + 公钥已交给产品方嵌入代码
