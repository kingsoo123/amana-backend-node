import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';

export type FlutterwaveTransferInput = {
  accountBank: string;
  accountNumber: string;
  amount: number;
  currency?: string;
  narration: string;
  reference: string;
  callbackUrl?: string;
};

export type FlutterwaveTransferResult = {
  id: string | number | null;
  reference: string;
  status: string;
  amount: number;
  fee: number | null;
  mocked: boolean;
};

type FlutterwaveBank = {
  id?: number;
  code?: string;
  name?: string;
};

type FlutterwaveEnvelope<T> = {
  status: string;
  message: string;
  data?: T;
};

@Injectable()
export class FlutterwaveTransfersService {
  private readonly logger = new Logger(FlutterwaveTransfersService.name);
  private banksCache: FlutterwaveBank[] | null = null;

  constructor(private readonly configService: ConfigService) {}

  isMockEnabled(): boolean {
    const explicit = this.configService.get<string>('ESCROW_PAYOUT_MOCK');
    if (explicit === 'true') {
      return true;
    }
    if (explicit === 'false') {
      return false;
    }

    const secret = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
    return !secret?.trim();
  }

  async createTransfer(
    input: FlutterwaveTransferInput,
  ): Promise<FlutterwaveTransferResult> {
    if (this.isMockEnabled()) {
      this.logger.warn(
        `Mocking Flutterwave transfer ${input.reference} for ₦${input.amount}`,
      );
      return {
        id: `MOCK-TRF-${randomBytes(4).toString('hex')}`,
        reference: input.reference,
        status: 'SUCCESSFUL',
        amount: input.amount,
        fee: 0,
        mocked: true,
      };
    }

    const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
    if (!secretKey?.trim()) {
      throw new BadGatewayException(
        'FLUTTERWAVE_SECRET_KEY is required for escrow payouts',
      );
    }

    const env = this.configService.get<string>('FLUTTERWAVE_ENV', 'sandbox');
    const baseUrl =
      env === 'production' || env === 'live'
        ? 'https://api.flutterwave.com'
        : 'https://api.flutterwave.com';

    const response = await fetch(`${baseUrl}/v3/transfers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        account_bank: input.accountBank,
        account_number: input.accountNumber,
        amount: input.amount,
        narration: input.narration,
        currency: input.currency ?? 'NGN',
        reference: input.reference,
        debit_currency: input.currency ?? 'NGN',
        ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      }),
    });

    const rawBody = await response.text();
    let payload: FlutterwaveEnvelope<{
      id?: number | string;
      reference?: string;
      status?: string;
      amount?: number;
      fee?: number;
    }>;

    try {
      payload = rawBody ? JSON.parse(rawBody) : ({} as never);
    } catch {
      this.logger.error(
        `Flutterwave transfer returned non-JSON (${response.status}): ${rawBody.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Flutterwave transfer failed with an unexpected response',
      );
    }

    if (!response.ok || payload.status !== 'success' || !payload.data) {
      const message =
        payload.message ||
        `Flutterwave transfer failed (${response.status})`;
      this.logger.error(message);
      throw new BadGatewayException(message);
    }

    return {
      id: payload.data.id ?? null,
      reference: payload.data.reference ?? input.reference,
      status: String(payload.data.status ?? 'NEW').toUpperCase(),
      amount: Number(payload.data.amount ?? input.amount),
      fee:
        payload.data.fee == null || Number.isNaN(Number(payload.data.fee))
          ? null
          : Number(payload.data.fee),
      mocked: false,
    };
  }

  async resolveBankCode(bankName: string): Promise<string | null> {
    const normalized = bankName.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    const staticCode = STATIC_BANK_CODES[normalized];
    if (staticCode) {
      return staticCode;
    }

    for (const [name, code] of Object.entries(STATIC_BANK_CODES)) {
      if (normalized.includes(name) || name.includes(normalized)) {
        return code;
      }
    }

    const banks = await this.listNigerianBanks();
    const exact = banks.find(
      (bank) => bank.name?.trim().toLowerCase() === normalized,
    );
    if (exact?.code) {
      return exact.code;
    }

    const partial = banks.find((bank) => {
      const name = bank.name?.trim().toLowerCase() ?? '';
      return name.includes(normalized) || normalized.includes(name);
    });

    return partial?.code ?? null;
  }

  private async listNigerianBanks(): Promise<FlutterwaveBank[]> {
    if (this.banksCache) {
      return this.banksCache;
    }

    if (this.isMockEnabled()) {
      this.banksCache = Object.entries(STATIC_BANK_CODES).map(
        ([name, code]) => ({ name, code }),
      );
      return this.banksCache;
    }

    const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
    if (!secretKey?.trim()) {
      return [];
    }

    try {
      const response = await fetch('https://api.flutterwave.com/v3/banks/NG', {
        headers: {
          Authorization: `Bearer ${secretKey.trim()}`,
          Accept: 'application/json',
        },
      });
      const payload = (await response.json()) as FlutterwaveEnvelope<
        FlutterwaveBank[]
      >;
      if (payload.status === 'success' && Array.isArray(payload.data)) {
        this.banksCache = payload.data;
        return this.banksCache;
      }
    } catch (error) {
      this.logger.warn(
        `Unable to load Flutterwave banks: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    return [];
  }
}

const STATIC_BANK_CODES: Record<string, string> = {
  'wema bank': '035',
  wema: '035',
  'sterling bank': '232',
  sterling: '232',
  'access bank': '044',
  access: '044',
  'gtbank': '058',
  'guaranty trust bank': '058',
  'uba': '033',
  'united bank for africa': '033',
  'zenith bank': '057',
  zenith: '057',
  'first bank': '011',
  'first bank of nigeria': '011',
  'fidelity bank': '070',
  fidelity: '070',
  'union bank': '032',
  'polaris bank': '076',
  'kuda bank': '090267',
  kuda: '090267',
  flutterwave: '035',
  'mock bank': '999',
  mock: '999',
};
