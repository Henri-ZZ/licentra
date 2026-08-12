# Licentra

License key 销售与激活管理平台：售卖侧接 Paddle、签发 Key 并邮件投递；使用侧提供本地可验签的 License API；管理侧是一个 Dashboard。

---

## 1. 系统定位

Licentra 是一个 **License key 服务端**（不是客户的桌面应用本体）。它做三件事：

1. **卖 Key** — 客户在 Paddle 付款，Licentra 收到 webhook，签发一个 Key，通过邮件（Resend）一次性投递。
2. **用 Key** — 客户的桌面/移动应用调用 Licentra 的 License API（validate / activate / check-in / deactivate），Licentra 返回一段**用产品 ECDSA 私钥签名的 payload**。客户应用**离线本地验签**（公钥嵌入客户自己的代码里），不必每次都打网络。
3. **管 Key** — 运营者登录 Dashboard：创建产品、生成每产品的密钥对、查看 License、吊销、重发邮件、查订单流水。

---

## 2. 关键设计决策

### 2.1 原始 Key 不入库
客户收到的原始 key（如 `K3PQ-W7HN-8YJZ-V9D2`）只在内存中存在；入库只存 SHA-256 hash。原始 key 通过邮件一次性送达。

**后果**：
- DB 泄漏不会泄漏可用的 key
- 邮件发送失败 → 原始 key 丢失 → 需要重发时**生成新 Key + 吊销旧 Key**（"重发邮件"实际是"换发 Key"）
- License Key 本身即凭证，不需要额外的 API key 鉴权；安全靠 16 字符随机（≈95 bit 熵）+ HTTPS + 邮件投递渠道安全

### 2.2 离线验签 + 强制在线 check-in
客户端拿到 `{payload, signature}` 后**纯本地验签**——不需要每次访问 API。但本地验签**只能证明"服务端在签名那一刻认为这个 key 有效"**，**不能反映运行时变化**：

- 设备被新设备挤掉名额（FIFO 踢出）
- 用户退款
- License 被吊销
- 产品下线

所以客户端必须**每 24 小时调一次** `/api/license/check-in`（v1 固定 24h），让服务端把当前最新签名回传。如果服务端发现该 fingerprint 已被踢出 / license 已被吊销 / 已退款，就返回 `valid: false` + `reason`，客户端清缓存。

### 2.3 每产品独立密钥对
不同产品用不同的 ECDSA P-256 密钥对。客户应用按 `payload.product` 字段在本地公钥表里挑公钥验签：
```
PUBLIC_KEYS = {
  "stealth-browser-assistant": `<PEM>`,
  "other-product": `<PEM>`,
}
```

每产品的私钥用 `LICENSE_MASTER_KEY`（AES-256-GCM）加密后存在 `Product.privateKeyEncrypted`。**主密钥泄漏则所有产品私钥泄漏**——必须严格保管。

### 2.4 FIFO 踢出
每个 Product 配置 `maxActivations`（默认 3）。`/api/license/activate` 时：

1. 同 fingerprint 已绑定 → 仅刷新 `lastCheckedAt`（幂等）
2. 新 fingerprint + 未满 → 直接注册
3. 新 fingerprint + 已满 → 删除**最早**一条 Activation（按 `createdAt asc`），再注册新的

整个流程在 `prisma.$transaction` 里跑，保证踢出和注册的原子性。

### 2.5 Paddle webhook 是事实来源
License 不允许在 Dashboard 手创——只由 Paddle 付款事件触发。这样不会出现"签发了 Key 但没收到钱"的不一致。webhook 幂等：`WebhookEvent.paddleEventId` 唯一索引，重复 event 直接 200 返回。

### 2.6 单用户鉴权
v1 没有 User 表，`ADMIN_EMAIL` / `ADMIN_PASSWORD` 写死（常量时间比较），登录后下发 HS256 JWT cookie。`proxy.ts`（Next.js 16 重命名自 `middleware.ts`）保护 `/dashboard/*`。**后续接多用户只需把 `verifyCredentials` 换成 Prisma lookup**。

---

## 3. 数据模型

```
Product ─┬─< LicenseKey ─< Activation
         └─< Order ─< LicenseKey
WebhookEvent (独立)
```

| 表 | 关键字段 |
|---|---|
| `Product` | `slug` (unique), `paddleProductId` (unique), `privateKeyEncrypted`, `publicKey`, `publicKeyFingerprint` (unique), `maxActivations`, `emailSubject`/`emailBodyHtml`/`resendFromAddress` |
| `LicenseKey` | `keyHash` (unique, **SHA-256(原始 key)**), `productId`, `orderId`, `maxActivations`, `revoked`/`revokedAt`/`revokedReason`, `emailedAt`/`emailError`/`emailAttempts` |
| `Activation` | `licenseKeyId`, `fingerprint` (**SHA-256(原始设备指纹)**, 不是原始值), `label`, `ipAddress`, `userAgent`, `lastCheckedAt`, 唯一 `(licenseKeyId, fingerprint)` |
| `Order` | `paddleTransactionId` (unique), `paddleEmail`, `productId`, `amount`(分), `currency`, `status`, `rawPayload`(Json) |
| `WebhookEvent` | `paddleEventId` (unique), `eventType`, `processed`, `payload`(Json), `error` |

完整定义见 [prisma/schema.prisma](prisma/schema.prisma)。

---

## 4. 关键流程

### 4.1 售卖流程（一次完整交易）

```
客户付款 → Paddle → POST /api/webhook/paddle (transaction.completed)
  │
  ├─ 验签 (HMAC-SHA256 over `${ts}.${rawBody}`, ±5min 时窗)
  ├─ 幂等检查: WebhookEvent.paddleEventId 已存在 → 200 duplicate
  ├─ 解析 custom_data.productId → 找 Product (要求 privateKeyEncrypted 已就绪)
  │
  ├─ 已有 Order.paddleTransactionId 记录?
  │   ├─ 是 → 复用, 检查 emailedAt, 没发就重试
  │   └─ 否 → 继续
  │
  ├─ prisma.order.create({ paddleTransactionId, paddleEmail, productId, amount, currency, status, rawPayload })
  ├─ rawKey = generateLicenseKey()    // K3PQ-W7HN-8YJZ-V9D2
  ├─ prisma.licenseKey.create({ keyHash: sha256(rawKey), productId, orderId, maxActivations })
  │
  ├─ 邮件 (Resend 或 stub):
  │   渲染 Product.emailSubject / emailBodyHtml
  │   占位符 {{key}} {{productName}} {{plan}} {{licenseId}} {{maxActivations}}
  │   发到 paddleEmail
  │   成功 → emailedAt = now
  │   失败 → emailError, emailAttempts++, throw → webhook 返回 500 → Paddle 重试
  │
  └─ WebhookEvent.processed = true → 200
```

**重试策略**：
- 同 `paddleEventId` 重发 → 幂等跳过
- 同 `paddleTransactionId` 但不同 `paddleEventId`（Paddle 真的会重发整个 transaction）：
  - `emailedAt != null` → 直接 200
  - `emailedAt == null` → 重发邮件（**此时原始 key 已丢**——v1 行为：写 `emailError: "raw key not retained across retries"`，要求 admin 在 dashboard 重发）

### 4.2 退款流程

Paddle `transaction.updated` + status ∈ {refunded, partially_refunded, canceled, cancelled}：

```
WebhookEvent 写入 → handleTransactionUpdated
  ├─ 找 Order (by paddleTransactionId)
  ├─ prisma.$transaction:
  │   ├─ order.status = tx.status
  │   └─ 所有关联 LicenseKey:
  │       revoked = true
  │       revokedAt = now
  │       revokedReason = "refunded"
  └─ 已激活设备的客户端下次 check-in 收到 { valid: false, reason: "license_refunded" }
```

### 4.3 客户端使用流程

```
启动 App
  │
  ├─ 有缓存 payload+signature+publicKey?
  │   └─ 是 → 本地 ECDSA 验证
  │       ├─ 失败 → 弹"无效"提示, 清缓存, 重新激活流程
  │       └─ 成功 → 看距离上次 check-in 的时间
  │           ├─ < next_check_in_seconds → 直接进入应用
  │           └─ ≥ → 调 /api/license/check-in
  │
  └─ 无缓存 / 首次启动 → POST /api/license/activate
      { key, fingerprint, label }
        │
        └─ 服务端:
            ├─ license 不存在 / 吊销 → { valid: false }
            ├─ 同 fingerprint → refresh lastCheckedAt → 签名返回
            ├─ 新 fp + 未满 → 注册 → 签名返回
            └─ 新 fp + 已满 → FIFO 踢最早 + 注册 → 签名返回
```

### 4.4 各 API 行为一览

| 端点 | 入参 | 行为 | 副作用 |
|---|---|---|---|
| `POST /api/license/validate` | `{ key }` | 按 hash 查 license，返回签名 payload | 无 |
| `POST /api/license/activate` | `{ key, fingerprint, label? }` | 同 fp 刷新 / 新 fp 注册 / 满则 FIFO 踢出 | 写 Activation |
| `POST /api/license/check-in` | `{ key, fingerprint, client_version?, platform? }` | 验证 license + 验证 fp 仍绑定，刷新 lastCheckedAt | 写 lastCheckedAt |
| `POST /api/license/deactivate` | `{ key, fingerprint }` | 删 Activation（幂等） | 删 Activation |

License API **不做鉴权**（key 即凭证）。`/api/webhook/paddle` 用 HMAC 验签；`/api/products/*` 和 `/api/licenses/*`（管理用）走 dashboard session。

---

## 5. 使用手册

### 5.1 首次启动（运营者）

```bash
pnpm install
cp .env.example .env.local      # 填 Neon URL + Paddle webhook secret + Resend key + LICENSE_MASTER_KEY
pnpm prisma db push             # 建表
pnpm dev                        # 起 http://localhost:3000
```

默认账号：`henrizhang@henri.ren` / `Gun748..`（**仅开发用**，生产必须改 env）。

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
     - URL = `https://YOUR-DOMAIN/api/webhook/paddle`
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
    Buffer.from(signature, "base64")
  );
}
```

完整调用序列参考 [README §API](README.md)。

### 5.4 日常运营

| 场景 | 操作 |
|---|---|
| 客户说自己没收到 key | Dashboard → Licenses → 搜邮箱 → "Resend email"（**实际是换发新 key + 吊销旧的**，原 key 找不回来了） |
| 客户退款 | Paddle 自动 → webhook → license 自动 revoked；无需手动操作 |
| 客户超过 maxActivations | 自动 FIFO 踢出最早一台；不需要 admin 介入。客户被踢出的设备下次启动会拿到 `valid: false` |
| 紧急吊销某个 key | Dashboard → Licenses → Revoke（reason 可选） |
| 改邮件模板 | Dashboard → Products → 编辑 → 立刻对**后续新订单**生效；存量订单仍用创建时的模板 |

### 5.5 烟雾测试

```bash
pnpm tsx scripts/smoke-sign.ts
```

验证（无 DB）：密钥对生成、AES round-trip、签名 DER 前缀 `MEU...`、本地验签、License key 生成 + 格式正则。

---

## 6. 安全模型

| 项 | 说明 |
|---|---|
| License Key 存储 | 只存 SHA-256(原始 key)。原 key 邮件一次性投递，不入 DB |
| Webhook 验签 | HMAC-SHA256 over `${ts}.${rawBody}`，时窗 ±5min，常量时间比较 |
| Dashboard 鉴权 | HS256 JWT in `httpOnly` cookie，单用户硬编码 env |
| License API 鉴权 | **无**（key 即凭证）。安全模型：16 字符 ≈95 bit 熵 + HTTPS + 邮件渠道安全 |
| 产品私钥 | AES-256-GCM 加密，`LICENSE_MASTER_KEY` 是 32-byte hex（64 chars） |
| 设备指纹 | 入库前 SHA-256；DB 泄漏不暴露原始设备标识 |
| 签名序列化 | `JSON.stringify(payload)` 键顺序必须固定：`product → plan → license_id → expires_at`。改动 = 协议破坏 |
| 主密钥泄漏 | ⇒ 所有产品私钥可解 ⇒ 所有 license 可伪造。**生产环境必须用 KMS 或 secret manager** |

### 不在 v1 范围

- 多用户 / 角色权限
- License API 限流（生产建议加 Upstash Redis）
- Webhook 重试 UI（dashboard 看 `WebhookEvent.error`）
- 邮件模板实时预览
- 激活事件审计日志
- 测试套件（构建通过；建议加 Vitest + Playwright）

---

## 7. 文件结构

```
licentra/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   └── smoke-sign.ts
├── src/
│   ├── app/
│   │   ├── (auth)/login/                # 登录页
│   │   ├── (dashboard)/dashboard/       # 受保护的后台
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                 # 总览
│   │   │   ├── products/                # 产品 CRUD
│   │   │   ├── licenses/                # License 列表 / 详情 / 吊销 / 重发
│   │   │   └── orders/                  # Paddle 订单流水
│   │   ├── api/
│   │   │   ├── auth/{login,logout}/     # 鉴权
│   │   │   ├── license/{validate,activate,check-in,deactivate}/
│   │   │   ├── webhook/paddle/          # Paddle 入口
│   │   │   ├── products/                # 管理 CRUD + generate-key
│   │   │   └── licenses/[id]/{revoke,resend-email}/
│   │   ├── layout.tsx
│   │   └── page.tsx                     # / → 重定向到 /dashboard 或 /login
│   ├── components/
│   │   ├── ui/                          # shadcn 手写组件
│   │   └── dashboard/{sidebar,header}
│   ├── lib/
│   │   ├── auth.ts                      # JWT cookie + 常量时间凭据校验
│   │   ├── crypto.ts                    # AES-256-GCM
│   │   ├── email.ts                     # Resend + 占位符渲染 + stub 模式
│   │   ├── env.ts                       # zod 校验
│   │   ├── fingerprint.ts               # SHA-256 + 公私钥指纹
│   │   ├── license-key.ts               # 16 字符生成 + 格式校验
│   │   ├── license-query.ts             # loadLicenseByHash / buildLicensePayload / buildLicenseResponse
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

### `POST /api/license/validate`
```json
请求: { "key": "K3PQ-W7HN-8YJZ-V9D2" }
成功响应:
{
  "valid": true,
  "payload": {
    "product": "stealth-browser-assistant",
    "plan": "pro",
    "license_id": "abc123",
    "expires_at": null
  },
  "signature": "MEUCIQ..."
}
失败响应: { "valid": false, "reason": "license_not_found" | "license_revoked" | "license_refunded" | "activation_evicted" }
```

### `POST /api/license/activate`
```json
请求: { "key": "...", "fingerprint": "<设备指纹原文>", "label": "MacBook Pro" }
成功响应: 同 validate
```

### `POST /api/license/check-in`
```json
请求: { "key": "...", "fingerprint": "...", "client_version": "1.2.3", "platform": "macos" }
成功响应: { ...validate 响应, "next_check_in_seconds": 86400 }
```

### `POST /api/license/deactivate`
```json
请求: { "key": "...", "fingerprint": "..." }
成功响应: 同 validate
```

### `POST /api/webhook/paddle`
由 Paddle 调用（HMAC 验签）。客户端应用不应直接调用。

---

## 9. 部署 checklist

- [ ] 生产 env 全部覆盖（**不要**用 `src/lib/env.ts` 的默认值）
- [ ] `AUTH_JWT_SECRET` 32 字节随机（`openssl rand -hex 32`）
- [ ] `LICENSE_MASTER_KEY` 32 字节 hex（64 chars），用 KMS / secret manager
- [ ] `RESEND_API_KEY` 是真实 key，不是 `re_dev`
- [ ] `PADDLE_WEBHOOK_SECRET` 是 Paddle 后台给的真实 secret
- [ ] `PADDLE_ENVIRONMENT=production`
- [ ] Neon DB 加 IP 白名单（Vercel egress）
- [ ] 上线前用 `pnpm build` 通过；用 `pnpm tsx scripts/smoke-sign.ts` 验证签名管线
- [ ] Dashboard 默认密码已改
- [ ] 第一个 Product 已创建 + 签名密钥已生成 + 公钥已交给产品方嵌入代码