import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private minioClient: Minio.Client;
  private readonly logger = new Logger(MinioService.name);

  constructor(private configService: ConfigService) {
    this.minioClient = new Minio.Client({
      endPoint: this.configService.get<string>('MINIO_ENDPOINT') || 'localhost',
      port: parseInt(this.configService.get<string>('MINIO_PORT') || '9000', 10),
      useSSL: this.configService.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY') || 'minioadmin',
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY') || 'minioadmin',
    });
  }

  async onModuleInit() {
    try {
      const buckets = [
        this.configService.get<string>('MINIO_BUCKET_NAME') || 'sabeel-upload',
        this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images',
        this.configService.get<string>('MINIO_DOCUMENTS_BUCKET_NAME') || 'documents',
      ];

      for (const bucket of buckets) {
        await this.ensureBucketExists(bucket);
        // Set public read policy for images and documents
        if (bucket === 'images' || bucket === 'documents') {
          await this.setBucketPublic(bucket);
        }
      }
    } catch (error) {
      this.logger.error(`MinIO initialization failed: ${error.message}. The app will continue but media features may fail.`);
    }
  }

  private async setBucketPublic(bucketName: string) {
    try {
      const policy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetBucketLocation', 's3:ListBucket'],
            Resource: [`arn:aws:s3:::${bucketName}`],
          },
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${bucketName}/*`],
          },
        ],
      };
      await this.minioClient.setBucketPolicy(bucketName, JSON.stringify(policy));
    } catch (error) {
      this.logger.error(`Error setting bucket "${bucketName}" to public: ${error.message}`);
    }
  }



  private async ensureBucketExists(bucketName: string) {
    try {
      const exists = await this.minioClient.bucketExists(bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(bucketName, this.configService.get<string>('MINIO_REGION') || 'us-east-1');
        this.logger.log(`Bucket "${bucketName}" created successfully.`);
      }
    } catch (error) {
      this.logger.error(`Error checking/creating bucket "${bucketName}": ${JSON.stringify(error)}`);
    }
  }

  async uploadFile(bucketName: string, fileName: string, file: Buffer, mimeType: string) {
    try {
      const metaData = {
        'Content-Type': mimeType,
      };
      await this.minioClient.putObject(bucketName, fileName, file, file.length, metaData);
      return fileName;
    } catch (error) {
      this.logger.error(`Error uploading file to MinIO: ${error.message}`);
      throw error;
    }
  }

  getPublicFileUrl(bucketName: string, fileName: string): string {
    if (!fileName) {
      return fileName;
    }

    if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
      return fileName;
    }

    // Some clients may temporarily send base64 data URLs instead of object keys.
    // These are not valid MinIO object names and should be returned as-is.
    if (fileName.startsWith('data:')) {
      return fileName;
    }

    const explicitPublicUrl = this.configService.get<string>('MINIO_PUBLIC_URL');
    if (explicitPublicUrl) {
      return `${explicitPublicUrl.replace(/\/$/, '')}/${bucketName}/${fileName
        .split('/')
        .map((segment) => encodeURIComponent(segment))
        .join('/')}`;
    }

    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    const protocol = useSSL ? 'https' : 'http';
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT') || 'localhost';
    const port = this.configService.get<string>('MINIO_PORT') || '9000';
    const portSuffix = (useSSL && port === '443') || (!useSSL && port === '80') ? '' : `:${port}`;

    return `${protocol}://${endPoint}${portSuffix}/${bucketName}/${fileName
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;
  }

  async getFileUrl(bucketName: string, fileName: string): Promise<string> {
    try {
      if (!fileName) {
        return fileName;
      }

      if (fileName.startsWith('http://') || fileName.startsWith('https://') || fileName.startsWith('data:')) {
        return fileName;
      }

      return await this.minioClient.presignedGetObject(bucketName, fileName, 24 * 60 * 60); // URL valid for 24h
    } catch (error) {
      this.logger.error(`Error generating presigned URL: ${error.message}`);
      throw error;
    }
  }

  async deleteFile(bucketName: string, fileName: string) {
    try {
      await this.minioClient.removeObject(bucketName, fileName);
    } catch (error) {
      this.logger.error(`Error deleting file from MinIO: ${error.message}`);
      throw error;
    }
  }
}
