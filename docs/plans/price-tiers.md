# Price tiers — 设计文档

记录一个 Product 为什么以及如何支持多个 plan（30 天 / 一年 / 永久）。

---

## 1. 背景

最早期一个 Product 只有一个 `plan`（字符串，如 `"standard"`）和最多一个 `paddlePriceId`。Paddle webhook 进来时按 `custom_data.productId` 匹配 Product，再按预先配的 `paddlePriceId` 匹配价格。

随着业务演进到同时卖 30 天 / 一年 / 永久三种 Plan：

- 单 Product 必须能挂多个 Plan
- 每个 Plan 独立绑定一个 Paddle price ID
- 每个 Plan 独立配置过期时长（`null` = 永久）
- 客户购买哪一档会写到 license 上，且**不能**事后被管理员改 tier 而影响存量 license

我们做了一次较小规模的 schema 迁移来支撑这个模型。

---

## 2. 数据模型

### 2.1 `ProductPriceTier`（新增）

```prisma
model ProductPriceTier {
  id            String   @id @default(cuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  plan          String                          // 1–40 chars
  paddlePriceId String?                         // 可空，目前仅展示
  expiresInDays Int?                            // null = 永久；冻结，post-creation 不可改
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  licenses      LicenseKey[]
  @@unique([productId, plan])
  @@unique([productId, paddlePriceId])
  @@index([productId])
}
```

`Product.plan` 和 `Product.paddlePriceId` 字段被**删除**。

### 2.2 `LicenseKey` 新增 snapshot 字段

```prisma
model LicenseKey {
  // ...
  tierId    String?
  tier      ProductPriceTier? @relation(fields: [tierId], references: [id])
  plan      String?                       // 快照：tier.plan 在签发时刻的值
  expiresAt DateTime?                     // 快照：tier.expiresInDays 转成的 Date 或 null
  // ...
  @@index([tierId])
}
```

**为什么快照**：管理员之后改名某 Tier、或把 30 天改成 30 天试运营，都**不能**影响存量已签发 license。Policy：license 是什么 Plan、什么时候过期，**服务器签名时刻**说了算。

### 2.3 索引与约束

- `@@unique([productId, plan])` — 同产品下 plan 名唯一
- `@@unique([productId, paddlePriceId])` — 同产品下价格 ID 唯一（可空，但多个 null 仍被视为冲突；用 `WHERE paddlePriceId IS NOT NULL` 的部分索引会更精准，目前 DB 层由 Prisma Unique + API 层去重兜底）
- `@@index([productId])` — 列表查询

---

## 3. Webhook 行为

### 3.1 Paddle 推 `transaction.completed`

现在暂时**只按 `custom_data.productId` 找到 Product**，再从该 Product 的 tiers 中**挑一个**：

```ts
function pickTierForOrder(tiers) {
  if (tiers.length === 0) return null;
  if (tiers.length === 1) return tiers[0];
  // 多 Tier 时，按 createdAt 升序取最早那个
  // 并打印一条 warn — 当前还没有 priceId-based matching
  return sorted[0];
}
```

**为什么不按 `paddlePriceId` 匹配**：当前我们的 Paddle webhoook 内部对 items 价格的利用还不完整；如果一开始就按 priceId 匹配，调试「哪个 Plan 匹配错了」会很麻烦。`createdAt asc` 给一份确定的行为，方便排查。

「30 天」「一年」等其他 Plan 的精确匹配留到 v2。

### 3.2 签发

```ts
const tier = pickTierForOrder(product.priceTiers);
const expiresAt = tier.expiresInDays == null
  ? null
  : new Date(Date.now() + tier.expiresInDays * 86400_000);

await prisma.licenseKey.create({
  data: {
    // ...
    tierId: tier.id,
    plan: tier.plan,
    expiresAt,
  },
});
```

`LicenseKey` 永远带 `plan`/`expiresAt` 快照；`payload.plan` / `payload.expires_at` 也直接读这两个字段，不再到 `Product` 上取。

### 3.3 退款 / 吊销

`paddle-transaction-updated` 仍按 `custom_data.productId` 找 Product，再按 `paddleTransactionId` 找 Order，吊销该 Order 下**所有** LicenseKey。tier 状态变化不影响这个流程。

---

## 4. Dashboard UI

### 4.1 列表页

`/dashboard/products` 把「Plan」列改成「Plans」，每行用 `Badge` 列出该 Product 所有 tier 的 `plan` 名（按 `createdAt asc`），没有 tier 时显示「—」。

### 4.2 新建产品

`/dashboard/products/new` 不再有 Plan / Paddle price ID 字段，只在表单底部新增「First price tier」section：

- `tierPlan`（默认 `永久`）
- `tierPaddlePriceId`（可选）

POST `/api/products` 的 body 现在带 `tiers: [{ plan, paddlePriceId }]`；`expiresInDays` 不接收，**总是 `null`**。

### 4.3 详情页

`/dashboard/products/[id]` 渲染 `<ProductTiersCard>` 表格：

| 列        | 说明                                                                 |
| --------- | -------------------------------------------------------------------- |
| Plan      | tier.plan；`hasLicenses > 0` 时加 `in use` Badge                     |
| Paddle price | tier.paddlePriceId，没有就 `—`                                     |
| Expires   | `null` → `lifetime`，数字 → `N days`                                |
| Licenses  | 引用此 tier 的 LicenseKey 数                                         |
| Actions   | Edit / Delete（Delete 在有 license 时禁用）                          |

新建产品时自动创建一个 `永久` tier。

### 4.4 编辑 tier

- Plan / Paddle price ID 可改
- `expiresInDays` **不可改**（输入框不渲染；`<DialogDescription>` 列出该字段的锁定）

### 4.5 删除 tier

- API 拒绝存在 LicenseKey 的 tier，返回 `409 tier_has_licenses`
- UI 按钮 disabled，带 tooltip 「此 tier 还有 license — 先吊销或迁移」

---

## 5. API

| 端点                                              | 行为                                                            |
| ------------------------------------------------- | --------------------------------------------------------------- |
| `POST /api/products`                              | 创建产品 + 默认 `en` 邮件模板 + 至少 1 个 tier（全部 `expiresInDays: null`） |
| `POST /api/products/[id]/tiers`                   | 新增 tier；`expiresInDays` 永远 `null`；`plan` 唯一、 `paddlePriceId` 唯一 |
| `PATCH /api/products/[id]/tiers/[tid]`            | 改 `plan` / `paddlePriceId`；`expiresInDays` 不接受              |
| `DELETE /api/products/[id]/tiers/[tid]`            | 删 tier；仍有 `LicenseKey` 引用 → 409 `tier_has_licenses`        |

错误码：

- `plan_already_exists` — 同 Product 下 plan 名重复
- `paddlePriceId_already_exists` — 同 Product 下 priceId 重复
- `tier_has_licenses` — DELETE 时仍有 LicenseKey 引用

---

## 6. 迁移步骤

1. `pnpm prisma db push`（dev + prod 都用 `db push`）
2. 部署代码
3. `pnpm backfill:tiers`（幂等）

`backfill:tiers` 脚本：

- 遍历所有有 `paddleProductId` 的 Product
- 对每个 Product，若还没有任何 tier，创建一条 `plan: "standard"`、`expiresInDays: null` 的 seed tier
- 把该 Product 下所有 `LicenseKey` 的 `tierId` 写到 seed tier，`plan` 写 `"standard"`，`expiresAt` 写 `null`

注意：旧 `Product.plan` 已被删除，**不能**从 schema 读到 — backfill 阶段所有旧 license 的 `plan` 都只能是 `"standard"` 这个**猜测值**。如果某个产品实际上卖的是「pro」但历史 license 的 `plan` 字段被写成 `standard`，暂时没有办法补救。

---

## 7. 未来工作（v2）

- **`expiresInDays` 可编辑**：放开 schema 限制，但不是「UI 上随便改」，而是「重新创建 tier + 迁移老 license」。比较适合走 API：DELETE 旧 tier（如果还有 license 就拒绝）→ POST 新 tier → 引导用户迁移 license。
- **`paddlePriceId` 真正起作用**：`pickTierForOrder` 改成按 items 里的 `price_id` 匹配 (`tier.paddlePriceId === items[0].price_id`)，匹配失败 fallback 到 `createdAt asc`。
- **多 tier 同时上架**：暂未支持，老的「多 plan 只能分多个 Paddle Product」路径继续走。
- **客户端 payload**：当前 `payload.expires_at` 只在客户端做展示用；真正在线校验仍是 `validate` / `check-in` 查 DB。但将来如果需要"签名时刻起算 24h check-in 失效"逻辑，expireAt 字段已经准备好。
