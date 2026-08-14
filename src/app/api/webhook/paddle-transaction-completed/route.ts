import { type NextRequest } from "next/server";

import {
  handleTransactionCompleted,
  processWebhookEvent,
} from "@/lib/paddle-webhook";
import { isCompletedTransaction } from "@/lib/paddle";

/**
 * Paddle Billing — `transaction.completed` webhook.
 *
 * Configure this URL in the Paddle dashboard under the
 * "transaction.completed" event slot. Idempotent at both the event level
 * (WebhookEvent.event_id unique) and the transaction level (Order.
 * paddleTransactionId unique). On a successful match, creates an Order +
 * License for the customer and sends the license email with the new
 * key. If the customer's Paddle locale matches a non-default template,
 * that template is used; otherwise the product's default (always `en`).
 */
export async function POST(request: NextRequest) {
  return processWebhookEvent({
    request,
    expectedEventType: "transaction.completed",
    typeGuard: isCompletedTransaction,
    handler: handleTransactionCompleted,
  });
}
