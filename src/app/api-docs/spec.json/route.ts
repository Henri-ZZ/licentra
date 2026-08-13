import { NextResponse } from "next/server";

import { openApiSpec } from "@/lib/api-spec";

/**
 * Public — returns the OpenAPI 3.1 spec for the external API. No auth
 * required so integrators can import it into Postman / Insomnia /
 * openapi-generator. The spec is rendered visually by the dashboard's
 * API docs page; this route is the machine-readable URL.
 */
export function GET() {
  return NextResponse.json(openApiSpec, {
    headers: {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
    },
  });
}
