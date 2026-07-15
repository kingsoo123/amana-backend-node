import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

@Injectable()
export class CloudinaryService {
  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.getCloudName() && this.getApiKey() && this.getApiSecret(),
    );
  }

  getCloudName(): string | null {
    return this.configService.get<string>('CLOUDINARY_CLOUD_NAME')?.trim() || null;
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'File uploads are not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
  }

  signUpload(input: {
    folder: string;
    resourceType?: 'image' | 'raw' | 'auto';
  }) {
    this.assertConfigured();

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = input.folder.replace(/^\/+|\/+$/g, '');
    const resourceType = input.resourceType ?? 'auto';
    const paramsToSign: Record<string, string | number> = {
      folder,
      timestamp,
    };

    return {
      cloudName: this.getCloudName()!,
      apiKey: this.getApiKey()!,
      timestamp,
      signature: this.sign(paramsToSign),
      folder,
      resourceType,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.getCloudName()}/${resourceType}/upload`,
    };
  }

  isTrustedDeliveryUrl(url: string): boolean {
    const cloud = this.getCloudName();
    if (!cloud) return false;
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === 'https:' &&
        parsed.hostname === 'res.cloudinary.com' &&
        parsed.pathname.startsWith(`/${cloud}/`)
      );
    } catch {
      return false;
    }
  }

  private getApiKey(): string | null {
    return this.configService.get<string>('CLOUDINARY_API_KEY')?.trim() || null;
  }

  private getApiSecret(): string | null {
    return this.configService.get<string>('CLOUDINARY_API_SECRET')?.trim() || null;
  }

  private sign(params: Record<string, string | number>) {
    const secret = this.getApiSecret()!;
    const toSign = Object.keys(params)
      .filter(
        (key) =>
          params[key] !== undefined && params[key] !== null && params[key] !== '',
      )
      .sort()
      .map((key) => `${key}=${params[key]}`)
      .join('&');

    return createHash('sha1').update(`${toSign}${secret}`).digest('hex');
  }
}
