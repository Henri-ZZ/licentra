import { type NextRequest } from "next/server";

import {
  handleTransactionUpdated,
  processWebhookEvent,
} from "@/lib/paddle-webhook";
import { isUpdatedTransaction } from "@/lib/paddle";

/**
 * Paddle Billing — `transaction.updated` webhook.
 *
 * Configure this URL in the Paddle dashboard under the
 * "transaction.updated" event slot. Currently we only react to refund /
 * cancel / partial-refund statuses: the order's status is synced and any
 * License rows tied to that order that aren't already revoked are revoked
 * (idempotent across repeated refund events).
 *
 * Other status transitions (e.g. `past_due`) are silently ignored — no
 * business action runs. Paddle keeps the authoritative delivery log.
 */
export async function POST(request: NextRequest) {
  return processWebhookEvent({
    request,
    expectedEventType: "transaction.updated",
    typeGuard: isUpdatedTransaction,
    handler: handleTransactionUpdated,
  });
}
