#!/usr/bin/env bash
# Simulates a bank transfer into a seller's Amana virtual account for an invoice.
#
# Requires:
#   - amana-backend running (default http://localhost:3001)
#   - A pending or payment_initiated invoice with a known payment reference
#   - FLUTTERWAVE_WEBHOOK_HASH exported from .env
#
# Usage:
#   cd amana-backend && \
#   export FLUTTERWAVE_WEBHOOK_HASH="$(grep '^FLUTTERWAVE_WEBHOOK_HASH=' .env | cut -d= -f2-)" && \
#   export PAYMENT_REFERENCE=PAY-ABC12345 && \
#   export AMOUNT=50000 && \
#   bash paymentScript.sh
#
# Optional env overrides:
#   API_URL=http://localhost:3001
#   PAYMENT_REFERENCE=PAY-...     (required — copy from invoice register or modal)
#   AMOUNT=50000                  (must match invoice amount in NGN)
#   INVOICE_NUMBER=INV-20250705-ABC
#   BUYER_NAME="Jane Buyer"
#   BUYER_BANK=GTBank
#   BUYER_ACCOUNT=0123456789

set -euo pipefail

API_URL="${API_URL:-http://localhost:3001}"

if [ -z "${FLUTTERWAVE_WEBHOOK_HASH:-}" ]; then
  if [ -f .env ]; then
    FLUTTERWAVE_WEBHOOK_HASH="$(grep '^FLUTTERWAVE_WEBHOOK_HASH=' .env | cut -d= -f2-)"
    export FLUTTERWAVE_WEBHOOK_HASH
  fi
fi

if [ -z "${FLUTTERWAVE_WEBHOOK_HASH:-}" ]; then
  echo "Set FLUTTERWAVE_WEBHOOK_HASH (export from .env) before running." >&2
  exit 1
fi

if [ -z "${PAYMENT_REFERENCE:-}" ]; then
  echo "Set PAYMENT_REFERENCE to the invoice payment reference (e.g. PAY-ABC12345)." >&2
  echo "Find it in Invoices → View modal, or the Payment reference column." >&2
  exit 1
fi

if [ -z "${AMOUNT:-}" ]; then
  echo "Set AMOUNT to the invoice total in NGN (must match exactly)." >&2
  exit 1
fi

PAYMENT_REFERENCE="$(echo "${PAYMENT_REFERENCE}" | tr '[:lower:]' '[:upper:]')"
INVOICE_NUMBER="${INVOICE_NUMBER:-${PAYMENT_REFERENCE}}"
BUYER_NAME="${BUYER_NAME:-Jane Buyer}"
BUYER_BANK="${BUYER_BANK:-GTBank}"
BUYER_ACCOUNT="${BUYER_ACCOUNT:-0123456789}"

# Unique per test — MOCK- prefix enables local webhook simulation without Flutterwave API
FLW_CHARGE_ID="MOCK-$(date +%s)-${RANDOM}"
FLW_TX_REF="AMANA-${FLW_CHARGE_ID}"

NARRATION="Amana invoice ${INVOICE_NUMBER} ${PAYMENT_REFERENCE}"

echo "Simulating payment for reference: ${PAYMENT_REFERENCE}" >&2
echo "Amount: ₦${AMOUNT}" >&2

BODY="$(cat <<EOF
{
  "type": "charge.completed",
  "timestamp": $(date +%s),
  "data": {
    "id": "${FLW_CHARGE_ID}",
    "amount": ${AMOUNT},
    "currency": "NGN",
    "reference": "${FLW_TX_REF}",
    "status": "succeeded",
    "flw_ref": "FLW-MOCK-${FLW_CHARGE_ID}",
    "payment_method": {
      "type": "bank_transfer",
      "id": "mock-payment-method",
      "bank_transfer": {
        "account_type": "static",
        "originator_name": "${BUYER_NAME}",
        "originator_bank_name": "${BUYER_BANK}",
        "originator_account_number": "${BUYER_ACCOUNT}"
      }
    },
    "meta": {
      "narration": "${NARRATION}"
    },
    "description": "${NARRATION}"
  }
}
EOF
)"

curl -sS -X POST "${API_URL}/api/v1/payments/webhooks/flutterwave" \
  -H "Content-Type: application/json" \
  -H "verif-hash: ${FLUTTERWAVE_WEBHOOK_HASH}" \
  -d "${BODY}" | jq .
