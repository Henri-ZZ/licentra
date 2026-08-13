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
 * LicenseKey rows tied to that order are revoked.
 *
 * Other status transitions (e.g. `past_due`) are silently ignored — the
 * event is still recorded in WebhookEvent for audit, but no business
 * action runs.
 */
export async function POST(request: NextRequest) {
  return processWebhookEvent({
    request,
    expectedEventType: "transaction.updated",
    typeGuard: isUpdatedTransaction,
    handler: handleTransactionUpdated,
  });
}
