import {
  BadGatewayException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

type FlutterwaveTokenResponse = {
  access_token: string;
  expires_in: number;
};

type FlutterwaveEnvelope<T> = {
  status: string;
  message: string;
  data?: T;
};

type FlutterwaveVirtualAccountData = {
  flw_ref?: string;
  order_ref?: string;
  account_number?: string;
  account_status?: string;
  bank_name?: string;
};

type FlutterwaveBvnInitiateData = {
  url?: string;
  reference?: string;
};

type FlutterwaveBvnVerifyData = {
  first_name?: string;
  last_name?: string;
  status?: string;
  reference?: string;
  bvn?: string;
  bvn_data?: {
    surname?: string;
    first_name?: string;
  };
};

type V4CustomerData = {
  id?: string;
};

type V4VirtualAccountData = {
  id?: string;
  account_number?: string;
  account_bank_name?: string;
  status?: string;
  reference?: string;
};

export type FlutterwaveApiMode = 'v3' | 'v4';

export type InitiateBvnVerificationInput = {
  bvn: string;
  firstname: string;
  lastname: string;
  redirectUrl: string;
};

export type InitiateBvnVerificationResult = {
  reference: string;
  consentUrl: string | null;
  requiresConsent: boolean;
  apiMode: FlutterwaveApiMode;
};

export type ConfirmBvnVerificationResult = {
  reference: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
};

export type EnsureV4CustomerInput = {
  email: string;
  firstname: string;
  lastname: string;
  phonenumber: string;
  flutterwaveCustomerId?: string | null;
  idempotencyKey?: string;
};

export type CreateStaticVirtualAccountInput = {
  email: string;
  firstname: string;
  lastname: string;
  phonenumber: string;
  txRef: string;
  bvn: string;
  narration: string;
  flutterwaveCustomerId?: string | null;
  userId: string;
  idempotencyKey?: string;
};

export type CreateStaticVirtualAccountResult = {
  accountNumber: string;
  bankName: string;
  flwRef: string | null;
  orderRef: string | null;
  accountStatus: string;
  flutterwaveCustomerId: string | null;
};

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  getApiMode(): FlutterwaveApiMode {
    const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');
    const forcedMode = this.configService.get<string>('FLUTTERWAVE_API_MODE');

    if (forcedMode === 'v3' || forcedMode === 'v4') {
      return forcedMode;
    }

    return secretKey?.trim() ? 'v3' : 'v4';
  }

  async initiateBvnVerification(
    input: InitiateBvnVerificationInput,
  ): Promise<InitiateBvnVerificationResult> {
    if (this.getApiMode() === 'v4') {
      return {
        reference: `amana_bvn_${randomUUID()}`,
        consentUrl: null,
        requiresConsent: false,
        apiMode: 'v4',
      };
    }

    const payload = await this.requestV3<FlutterwaveEnvelope<FlutterwaveBvnInitiateData>>(
      'https://api.flutterwave.com/v3/bvn/verifications',
      {
        method: 'POST',
        body: JSON.stringify({
          bvn: input.bvn,
          firstname: input.firstname,
          lastname: input.lastname,
          redirect_url: input.redirectUrl,
        }),
      },
      'initiate BVN verification',
    );

    if (
      payload.status !== 'success' ||
      !payload.data?.reference ||
      !payload.data?.url
    ) {
      throw new BadGatewayException(
        payload.message ?? 'Unable to initiate BVN verification',
      );
    }

    return {
      reference: payload.data.reference,
      consentUrl: payload.data.url,
      requiresConsent: true,
      apiMode: 'v3',
    };
  }

  async confirmBvnVerification(
    reference: string,
    apiMode: FlutterwaveApiMode,
  ): Promise<ConfirmBvnVerificationResult> {
    if (apiMode === 'v4') {
      return {
        reference,
        status: 'COLLECTED',
        firstName: null,
        lastName: null,
      };
    }

    const payload = await this.requestV3<FlutterwaveEnvelope<FlutterwaveBvnVerifyData>>(
      `https://api.flutterwave.com/v3/bvn/verifications/${reference}`,
      { method: 'GET' },
      'confirm BVN verification',
    );

    if (payload.status !== 'success' || !payload.data) {
      throw new BadGatewayException(
        payload.message ?? 'Unable to confirm BVN verification',
      );
    }

    const status = (payload.data.status ?? 'PENDING').toUpperCase();
    const firstName =
      payload.data.first_name ??
      payload.data.bvn_data?.first_name ??
      null;
    const lastName =
      payload.data.last_name ??
      payload.data.bvn_data?.surname ??
      null;

    return {
      reference,
      status,
      firstName,
      lastName,
    };
  }

  async createStaticVirtualAccount(
    input: CreateStaticVirtualAccountInput,
  ): Promise<CreateStaticVirtualAccountResult> {
    if (this.getApiMode() === 'v4') {
      return this.createV4StaticVirtualAccount(input);
    }

    const payload = await this.requestV3<
      FlutterwaveEnvelope<FlutterwaveVirtualAccountData>
    >(
      'https://api.flutterwave.com/v3/virtual-account-numbers',
      {
        method: 'POST',
        body: JSON.stringify({
          email: input.email,
          amount: 0,
          tx_ref: input.txRef,
          phonenumber: this.formatPhoneNumber(input.phonenumber),
          firstname: input.firstname,
          lastname: input.lastname,
          narration: input.narration,
          is_permanent: true,
          bvn: input.bvn,
          currency: 'NGN',
        }),
      },
      'create virtual account',
    );

    if (payload.status !== 'success' || !payload.data) {
      throw new BadGatewayException(
        payload.message ?? 'Unable to create virtual account',
      );
    }

    if (!payload.data.account_number || !payload.data.bank_name) {
      throw new BadGatewayException(
        'Flutterwave did not return complete virtual account details',
      );
    }

    return {
      accountNumber: payload.data.account_number,
      bankName: payload.data.bank_name,
      flwRef: payload.data.flw_ref ?? null,
      orderRef: payload.data.order_ref ?? null,
      accountStatus: payload.data.account_status ?? 'active',
      flutterwaveCustomerId: input.flutterwaveCustomerId ?? null,
    };
  }

  buildTxRef(_userId: string): string {
    // Flutterwave v4 reference: 6-42 chars, alphanumeric and hyphen only.
    return randomUUID().replace(/-/g, '');
  }

  formatPhoneNumber(phoneNumber: string): string {
    const digits = phoneNumber.replace(/\D/g, '');

    if (digits.startsWith('234') && digits.length >= 13) {
      return `0${digits.slice(3)}`;
    }

    if (digits.startsWith('0')) {
      return digits;
    }

    return digits;
  }

  private formatPhoneForV4(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    let localNumber = digits;

    if (digits.startsWith('234')) {
      localNumber = digits.slice(3);
    }

    if (localNumber.startsWith('0')) {
      localNumber = localNumber.slice(1);
    }

    return {
      country_code: '234',
      number: localNumber,
    };
  }

  private async createV4StaticVirtualAccount(
    input: CreateStaticVirtualAccountInput,
  ): Promise<CreateStaticVirtualAccountResult> {
    const customerId = await this.ensureV4Customer(input);

    const payload = await this.requestV4<FlutterwaveEnvelope<V4VirtualAccountData>>(
      '/virtual-accounts',
      {
        method: 'POST',
        body: JSON.stringify({
          customer_id: customerId,
          amount: 0,
          reference: input.txRef,
          currency: 'NGN',
          account_type: 'static',
          bvn: input.bvn,
          narration: input.narration,
        }),
      },
      'create virtual account',
      input.idempotencyKey,
    );

    if (payload.status !== 'success' || !payload.data) {
      throw new BadGatewayException(
        payload.message ?? 'Unable to create virtual account',
      );
    }

    if (!payload.data.account_number || !payload.data.account_bank_name) {
      throw new BadGatewayException(
        'Flutterwave did not return complete virtual account details',
      );
    }

    return {
      accountNumber: payload.data.account_number,
      bankName: payload.data.account_bank_name,
      flwRef: payload.data.id ?? null,
      orderRef: payload.data.reference ?? null,
      accountStatus: payload.data.status ?? 'active',
      flutterwaveCustomerId: customerId,
    };
  }

  async ensureV4Customer(input: EnsureV4CustomerInput): Promise<string> {
    if (input.flutterwaveCustomerId) {
      return input.flutterwaveCustomerId;
    }

    const token = await this.getAccessToken();
    const url = `${this.getV4BaseUrl()}/customers`;
    const phone = this.formatPhoneForV4(input.phonenumber);
    const idempotencyKey = input.idempotencyKey
      ? `${input.idempotencyKey}-customer`
      : undefined;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({
        email: input.email,
        name: {
          first: input.firstname,
          last: input.lastname,
        },
        phone,
      }),
    });

    if (response.status === 409) {
      const existingId = await this.findV4CustomerByEmail(input.email);
      if (existingId) {
        this.logger.warn(
          `Reusing existing Flutterwave customer ${existingId} for ${input.email}`,
        );
        return existingId;
      }
    }

    const payload = await this.parseResponse<FlutterwaveEnvelope<V4CustomerData>>(
      response,
      'create customer',
    );

    if (payload.status !== 'success' || !payload.data?.id) {
      throw new BadGatewayException(
        payload.message ?? 'Unable to create Flutterwave customer',
      );
    }

    return payload.data.id;
  }

  private async findV4CustomerByEmail(email: string): Promise<string | null> {
    const payload = await this.requestV4<{
      status: string;
      data?: Array<{ id?: string; email?: string }>;
    }>(
      '/customers/search',
      {
        method: 'POST',
        body: JSON.stringify({ email: email.trim() }),
      },
      'search customer',
    );

    const normalizedEmail = email.trim().toLowerCase();
    const customers = payload.data ?? [];
    const match =
      customers.find(
        (customer) => customer.email?.toLowerCase() === normalizedEmail,
      ) ?? customers[0];

    return match?.id ?? null;
  }

  private getV4BaseUrl(): string {
    const env = this.configService.get<string>('FLUTTERWAVE_ENV', 'sandbox');

    if (env === 'production' || env === 'live') {
      return 'https://f4bexperience.flutterwave.com';
    }

    return 'https://developersandbox-api.flutterwave.com';
  }

  private async requestV4<T>(
    path: string,
    init: RequestInit,
    action: string,
    idempotencyKey?: string,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = `${this.getV4BaseUrl()}${path}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        ...(init.headers ?? {}),
      },
    });

    return this.parseResponse<T>(response, action);
  }

  private async requestV3<T>(
    url: string,
    init: RequestInit,
    action: string,
  ): Promise<T> {
    const secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY');

    if (!secretKey?.trim()) {
      throw new BadGatewayException(
        'FLUTTERWAVE_SECRET_KEY is required for v3 BVN consent. Use v4 OAuth credentials or add your secret key from the Flutterwave dashboard.',
      );
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey.trim()}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

    return this.parseResponse<T>(response, action);
  }

  private async parseResponse<T>(response: Response, action: string): Promise<T> {
    const rawBody = await response.text();
    let payload: T;

    try {
      payload = rawBody ? (JSON.parse(rawBody) as T) : ({} as T);
    } catch {
      this.logger.error(
        `Flutterwave ${action} returned non-JSON (${response.status}): ${rawBody.slice(0, 300)}`,
      );
      throw new BadGatewayException(
        `Flutterwave ${action} failed with an unexpected response`,
      );
    }

    if (!response.ok) {
      const errorPayload = payload as {
        message?: string;
        error?:
          | string
          | {
              message?: string;
              validation_errors?: Array<{ field_name?: string; message?: string }>;
            };
      };

      const nestedError =
        typeof errorPayload.error === 'object' ? errorPayload.error : null;
      const validationMessage = nestedError?.validation_errors
        ?.map((item) =>
          item.field_name ? `${item.field_name}: ${item.message}` : item.message,
        )
        .filter(Boolean)
        .join('; ');

      const message =
        validationMessage ||
        nestedError?.message ||
        (typeof errorPayload.error === 'string' ? errorPayload.error : undefined) ||
        errorPayload.message ||
        `Flutterwave ${action} failed (${response.status})`;

      this.logger.error(`Flutterwave ${action} failed (${response.status}): ${message}`);

      throw new BadGatewayException(message);
    }

    return payload;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.accessToken && now < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const clientId = this.configService.get<string>('FLUTTERWAVE_CLIENT_ID');
    const clientSecret = this.configService.get<string>(
      'FLUTTERWAVE_CLIENT_SECRET',
    );

    if (!clientId?.trim() || !clientSecret?.trim()) {
      throw new BadGatewayException(
        'Flutterwave OAuth is not configured. Set FLUTTERWAVE_CLIENT_ID and FLUTTERWAVE_CLIENT_SECRET.',
      );
    }

    const body = new URLSearchParams({
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      grant_type: 'client_credentials',
    });

    const response = await fetch(
      'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    );

    const payload = (await response.json()) as FlutterwaveTokenResponse & {
      error?: string;
      error_description?: string;
    };

    if (!response.ok || !payload.access_token) {
      this.logger.error(
        `Flutterwave OAuth failed: ${payload.error_description ?? response.statusText}`,
      );
      throw new BadGatewayException(
        payload.error_description ?? 'Unable to authenticate with Flutterwave',
      );
    }

    this.accessToken = payload.access_token;
    this.tokenExpiresAt = now + payload.expires_in * 1000;

    return this.accessToken;
  }
}
