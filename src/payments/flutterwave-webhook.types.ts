export type FlutterwaveCharge = {
  id: string;
  amount: number;
  currency: string;
  reference: string;
  status: string;
  flw_ref?: string;
  payment_method?: {
    type?: string;
    bank_transfer?: {
      originator_name?: string;
      originator_bank_name?: string;
      originator_account_number?: string;
    };
  };
  meta?: Record<string, unknown> | null;
  description?: string;
};

export type FlutterwaveWebhookEvent = {
  type: string;
  timestamp?: number;
  data: FlutterwaveCharge;
};
