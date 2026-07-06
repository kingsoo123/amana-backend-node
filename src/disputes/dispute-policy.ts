export const BUYER_DISPUTE_WINDOW_HOURS = 48;
export const SELLER_RESPONSE_HOURS = 24;
export const PLATFORM_REVIEW_HOURS = 72;
export const DECISION_BUSINESS_DAYS = 5;

export const DISPUTE_POLICY_STEPS = [
  {
    key: 'buyer_window',
    role: 'buyer',
    label: 'Buyer dispute window',
    duration: '48 hours after delivery',
    description:
      'Buyers may open a dispute within 48 hours of receiving their order while payment is still in escrow.',
  },
  {
    key: 'seller_response',
    role: 'seller',
    label: 'Seller response',
    duration: '24 hours',
    description:
      'The seller is notified immediately and has 24 hours to respond with any supporting information.',
  },
  {
    key: 'platform_review',
    role: 'platform',
    label: 'Platform review',
    duration: '72 hours',
    description:
      'Amana reviews the case, evidence from both parties, and escrow status within 72 hours.',
  },
  {
    key: 'decision',
    role: 'platform',
    label: 'Final decision',
    duration: '5 business days',
    description:
      'A binding decision is issued within 5 business days of the dispute being opened.',
  },
] as const;

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;

  while (added < days) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) {
      added += 1;
    }
  }

  return result;
}

export function getBuyerDisputeDeadline(escrowedAt: Date | null): Date | null {
  if (!escrowedAt) {
    return null;
  }

  return addHours(escrowedAt, BUYER_DISPUTE_WINDOW_HOURS);
}

export function canBuyerOpenDispute(
  status: string,
  escrowedAt: Date | null,
  now = new Date(),
): boolean {
  if (status !== 'paid_in_escrow') {
    return false;
  }

  const deadline = getBuyerDisputeDeadline(escrowedAt);
  if (!deadline) {
    return true;
  }

  return now.getTime() <= deadline.getTime();
}

export function computeDisputeDeadlines(openedAt: Date) {
  return {
    sellerResponseDueAt: addHours(openedAt, SELLER_RESPONSE_HOURS),
    platformReviewDueAt: addHours(openedAt, PLATFORM_REVIEW_HOURS),
    decisionDueAt: addBusinessDays(openedAt, DECISION_BUSINESS_DAYS),
  };
}

export function serializeDeadline(date: Date | null | undefined) {
  return date ? date.toISOString() : null;
}
