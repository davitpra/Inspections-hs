import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { UploadContentType } from '@hs/contracts';

export interface PresignedUpload {
  url: string;
  object_key: string;
  expires_at: string;
}

export interface PresignInput {
  site_id: string;
  scheduled_inspection_id: string;
  content_type: UploadContentType;
  content_length: number;
}

export interface PresignManualInput {
  site_id: string;
  draft_finding_id: string;
  content_type: UploadContentType;
  content_length: number;
}

export interface PresignActionInput {
  site_id: string;
  action_id: string;
  content_type: UploadContentType;
  content_length: number;
}

const DEFAULT_TTL_SECONDS = 300;

@Injectable()
export class ObjectStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly ttlSeconds: number;

  constructor() {
    const config = readConfig();

    this.bucket = config.bucket;
    this.ttlSeconds = config.ttlSeconds;
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async presignPut(input: PresignInput): Promise<PresignedUpload> {
    return this.sign(
      deriveObjectKey(input.site_id, input.scheduled_inspection_id),
      input.content_type,
      input.content_length,
    );
  }

  async presignManualPut(input: PresignManualInput): Promise<PresignedUpload> {
    return this.sign(
      deriveManualObjectKey(input.site_id, input.draft_finding_id),
      input.content_type,
      input.content_length,
    );
  }

  async presignActionPut(input: PresignActionInput): Promise<PresignedUpload> {
    return this.sign(
      deriveActionObjectKey(input.site_id, input.action_id),
      input.content_type,
      input.content_length,
    );
  }

  private async sign(
    objectKey: string,
    contentType: UploadContentType,
    contentLength: number,
  ): Promise<PresignedUpload> {
    const url = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: this.ttlSeconds },
    );

    return {
      url,
      object_key: objectKey,
      expires_at: new Date(Date.now() + this.ttlSeconds * 1000).toISOString(),
    };
  }
}

export function deriveObjectKey(siteId: string, scheduledInspectionId: string): string {
  return `${siteId}/${scheduledInspectionId}/${randomUUID()}`;
}

export function deriveManualObjectKey(siteId: string, draftFindingId: string): string {
  return `${siteId}/manual/${draftFindingId}/${randomUUID()}`;
}

export function deriveActionObjectKey(siteId: string, actionId: string): string {
  return `${siteId}/actions/${actionId}/${randomUUID()}`;
}

interface ObjectStorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  ttlSeconds: number;
}

function readConfig(): ObjectStorageConfig {
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY tienen que estar definidas. Ver .env.example.',
    );
  }

  return {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    ttlSeconds: Number(process.env.S3_UPLOAD_TTL_SECONDS ?? DEFAULT_TTL_SECONDS),
  };
}
