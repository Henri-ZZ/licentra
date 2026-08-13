import { SwaggerViewer } from "./swagger-viewer";

export const metadata = {
  title: "API docs · Licentra",
};

/**
 * Dashboard view: visual API documentation for the external (product-facing)
 * endpoints. Renders Swagger UI against the spec served at
 * /api-docs/spec.json. Auth is enforced by the surrounding dashboard layout.
 *
 * The Swagger UI bundle + CSS are injected by <SwaggerViewer /> in useEffect,
 * so this server component stays free of script-tag orchestration.
 */
export default function ApiDocsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Docs</h1>
        <p className="text-sm text-muted-foreground">
          面向产品方的对外接口（license 激活 / 校验 / 停用 / 心跳）以及 Paddle
          webhook 接收端点。Swagger UI 通过 Try-it-out
          可直接发请求测试。机器可读的 OpenAPI 规范见{" "}
          <a
            href="/api-docs/spec.json"
            className="underline underline-offset-4"
          >
            /api-docs/spec.json
          </a>
          。
        </p>
      </div>

      <SwaggerViewer />
    </div>
  );
}
