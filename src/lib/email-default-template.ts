/**
 * Default per-language email template, used to seed:
 *   - the `en` template on every new Product
 *   - the form fields when an admin adds a new language template
 *   - the legacy fallback chain when a Product has zero templates
 *
 * Two kinds of placeholders:
 *   {{xxx}}  — interpolated at send time by `render()` in ./email.ts
 *   [[xxx]]  — literal hints to the admin ("you need to customize this
 *              before saving"). They are NOT substituted; the admin edits
 *              them out before the first send.
 */

export const DEFAULT_EMAIL_SUBJECT = "[[Product Name]] - License Key";

export const DEFAULT_EMAIL_BODY_HTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.65; color: #111827; max-width: 560px; margin: 0 auto; padding: 24px 16px;">
      <p style="font-size: 14px; color: #6b7280; margin: 0 0 12px;">[[产品名]]</p>
      <h1 style="font-size: 24px; margin: 0 0 8px; font-weight: 700;">[[购买回执]]</h1>
      <p style="margin: 0 0 20px;">[[您的 产品名 购买已完成，以下是本次交易回执与授权信息。]]</p>
      <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; background: #ffffff; margin-bottom: 16px;">
        <p style="margin: 0 0 8px;"><strong>[[产品]]:</strong> [[产品名]]</p>
        <p style="margin: 0 0 8px;"><strong>[[套餐]]:</strong> [[永久授权]]</p>
        <p style="margin: 0 0 8px;"><strong>[[交易号]]:</strong> {{orderId}}</p>
        <p style="margin: 0;"><strong>[[收件邮箱]]:</strong> {{email}}</p>
      </div>
      <div style="border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 18px; background: #ffffff;">
        <p style="margin: 0 0 12px;"><strong>[[激活码]]:</strong></p>
        <div style="display: inline-block; font-size: 24px; letter-spacing: 1px; font-weight: 700; background: #f3f4f6; padding: 12px 16px; border-radius: 10px;">
          {{code}}
        </div>
      </div>
      <p style="margin: 20px 0 8px;">[[请在 产品名 中输入此激活码完成激活。]]</p>
      <p style="margin: 20px 0 8px;">[[最多激活设备数]]: {{maxActivations}}</p>
      <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;">[[如需帮助，您可以直接回复此邮件，或发送邮件至]] <a href="mailto:{{supportEmail}}" style="color: #2563eb; text-decoration: underline;">{{supportEmail}}</a>.</p>
      <p style="margin: 0; color: #9ca3af; font-size: 12px;">[[此邮件为您最近一次购买的交易通知，不包含营销订阅内容。]]</p>
    </div>
  `;
