import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MinioService } from '../../minio/minio.service';
import { FreelanceDocumentsVerificationStatus, Guide, GuideRole } from '../auth/entities/guide.entity';
import { GuideEmail } from '../auth/entities/guide-email.entity';
import { EmailService } from '../auth/services/email.service';
import { SessionStorageService } from '../auth/services/session-storage.service';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(Guide)
    private readonly guideRepository: Repository<Guide>,
    @InjectRepository(GuideEmail)
    private readonly guideEmailRepository: Repository<GuideEmail>,
    private readonly sessionStorageService: SessionStorageService,
    private readonly emailService: EmailService,
    private readonly minioService: MinioService,
    private readonly configService: ConfigService,
  ) {}

  private assertFreelance(activeRole?: string) {
    if (String(activeRole || '') !== GuideRole.FREELANCE) {
      throw new ForbiddenException('Only freelance guides can access compliance workflow');
    }
  }

  private monthsToMs(months: number) {
    const days = Math.round((months / 12) * 365);
    return days * 24 * 60 * 60 * 1000;
  }

  private hoursToMs(hours: number) {
    return hours * 60 * 60 * 1000;
  }

  private async getGuideOrThrow(userId: string) {
    const guide = await this.guideRepository.findOne({ where: { id: userId } });
    if (!guide) throw new NotFoundException('Guide not found');
    return guide;
  }

  private async buildMeResponse(guide: Guide) {
    const imagesBucket = this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images';
    const documentsBucket = this.configService.get<string>('MINIO_DOCUMENTS_BUCKET_NAME') || 'documents';

    const docs = Array.isArray(guide.freelanceDocuments)
      ? guide.freelanceDocuments
      : [];
    const documents = await Promise.all(
      docs.map(async (k) => ({
        key: k,
        url: await this.minioService.getFileUrl(documentsBucket, k).catch(() => k),
      })),
    );

    // Auto-finalize documents verification after 48h when still pending.
    // This provides a deterministic “verification response after 48h”.
    if (
      guide.freelanceDocumentsUploadedAt &&
      guide.freelanceDocumentsVerificationStatus ===
        FreelanceDocumentsVerificationStatus.PENDING &&
      !guide.freelanceDocumentsReviewedAt
    ) {
      const uploadedAtMs = new Date(
        guide.freelanceDocumentsUploadedAt,
      ).getTime();
      const readyAtMs = uploadedAtMs + this.hoursToMs(48);
      if (Date.now() >= readyAtMs) {
        guide.freelanceDocumentsVerificationStatus =
          FreelanceDocumentsVerificationStatus.APPROVED;
        guide.freelanceDocumentsReviewedAt = new Date();
        guide.freelanceDocumentsRejectReason = null;
        await this.guideRepository.save(guide);
      }
    }

    const contractPdfUrl = guide.freelanceContractPdfKey
      ? await this.minioService.getFileUrl(documentsBucket, guide.freelanceContractPdfKey).catch(() => guide.freelanceContractPdfKey)
      : null;

    const signatureUrl = guide.freelanceContractSignatureKey
      ? await this.minioService.getFileUrl(imagesBucket, guide.freelanceContractSignatureKey).catch(() => guide.freelanceContractSignatureKey)
      : null;

    const now = Date.now();
    const contractValid = !!(
      guide.freelanceContractSignedAt &&
      guide.freelanceContractExpiresAt &&
      new Date(guide.freelanceContractExpiresAt).getTime() > now &&
      guide.freelanceContractPdfKey
    );

    const documentsDone = !!(
      guide.freelanceDocumentsUploadedAt &&
      documents.length > 0
    );
    const emailDone = !!guide.isEmailVerified;
    const eligible = documentsDone && emailDone && contractValid;

    const documentsVerificationStatus =
      guide.freelanceDocumentsVerificationStatus ||
      FreelanceDocumentsVerificationStatus.PENDING;

    const canUploadDocuments =
      !documentsDone ||
      documentsVerificationStatus ===
        FreelanceDocumentsVerificationStatus.REJECTED;

    const verificationAvailableAt = guide.freelanceDocumentsUploadedAt
      ? new Date(
          new Date(guide.freelanceDocumentsUploadedAt).getTime() +
            this.hoursToMs(48),
        )
      : null;

    return {
      guide: {
        id: guide.id,
        email: guide.email,
        activeRole: guide.activeRole,
      },
      steps: {
        documents: {
          done: documentsDone,
          uploadedAt: guide.freelanceDocumentsUploadedAt,
          verificationStatus: documentsVerificationStatus,
          reviewedAt: guide.freelanceDocumentsReviewedAt,
          rejectReason: guide.freelanceDocumentsRejectReason,
          verificationAvailableAt,
          canUpload: canUploadDocuments,
          documents,
        },
        emailVerification: {
          done: emailDone,
          email: guide.email,
        },
        contract: {
          done: contractValid,
          signedAt: guide.freelanceContractSignedAt,
          durationMonths: guide.freelanceContractDurationMonths,
          expiresAt: guide.freelanceContractExpiresAt,
          contractPdfUrl,
          signatureUrl,
        },
      },
      eligible,
    };
  }

  async getMe(user: { userId: string; activeRole?: string }) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);
    return this.buildMeResponse(guide);
  }

  async getContractDownloadUrl(user: { userId: string; activeRole?: string }) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);

    if (!guide.freelanceContractPdfKey) {
      throw new BadRequestException('No contract found');
    }

    const documentsBucket =
      this.configService.get<string>('MINIO_DOCUMENTS_BUCKET_NAME') ||
      'documents';

    return this.minioService.getFileUrl(
      documentsBucket,
      guide.freelanceContractPdfKey,
    );
  }

  async listEmails(user: { userId: string; activeRole?: string }) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);
    
    let emails = await this.guideEmailRepository.find({
      where: { guide: { id: user.userId } },
      order: { createdAt: 'DESC' },
    });

    // If list is empty, or primary email is missing from the list, add it automatically
    const primaryEmail = String(guide.email || '').trim().toLowerCase();
    if (primaryEmail && !emails.find(e => e.email.toLowerCase() === primaryEmail)) {
      const newEmail = this.guideEmailRepository.create({
        email: primaryEmail,
        guide,
        verified: !!guide.isEmailVerified,
      });
      await this.guideEmailRepository.save(newEmail);
      emails = [newEmail, ...emails];
    }

    return emails;
  }

  async addEmail(user: { userId: string; activeRole?: string }, email: string) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);
    const targetEmail = String(email || '').trim().toLowerCase();
    if (!targetEmail) throw new BadRequestException('Email is required');

    // Check if already exists for this guide
    let guideEmail = await this.guideEmailRepository.findOne({
      where: { email: targetEmail, guide: { id: guide.id } },
    });

    if (!guideEmail) {
      guideEmail = this.guideEmailRepository.create({
        email: targetEmail,
        guide,
        verified: false,
      });
      await this.guideEmailRepository.save(guideEmail);
    }

    // Automatically trigger OTP
    await this.requestEmailOtp(user, targetEmail);

    return { message: 'Email added and OTP sent', email: targetEmail };
  }

  async requestEmailOtp(user: { userId: string; activeRole?: string }, email?: string) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);

    const targetEmail = String(email || guide.email || '').trim().toLowerCase();
    if (!targetEmail) throw new BadRequestException('Email is required');

    // If it's the primary email and not verified, ensure it's in guide_emails too if we want consistency
    // But for now, let's just focus on the targetEmail

    const otp = this.sessionStorageService.generateOtp();
    this.sessionStorageService.storeOtp(targetEmail, otp);
    await this.emailService.sendOtpEmail(targetEmail, otp);

    return { message: 'OTP sent', email: targetEmail };
  }

  async verifyEmailOtp(user: { userId: string; activeRole?: string }, dto: { email: string; otp: string }) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);

    const email = String(dto?.email || guide.email || '').trim().toLowerCase();
    const otp = String(dto?.otp || '').trim();
    if (!email) throw new BadRequestException('Email is required');
    if (!otp || otp.length !== 6) throw new BadRequestException('OTP must be 6 digits');

    const isValid = this.sessionStorageService.verifyOtp(email, otp);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    this.sessionStorageService.clearOtp(email);

    // 1. Update in guide_emails if exists
    const guideEmail = await this.guideEmailRepository.findOne({
      where: { email, guide: { id: guide.id } },
    });
    if (guideEmail) {
      guideEmail.verified = true;
      await this.guideEmailRepository.save(guideEmail);
    }

    // 2. If it matches primary email or if it's a new primary candidate
    if (String(guide.email || '').trim().toLowerCase() === email) {
      guide.isEmailVerified = true;
      await this.guideRepository.save(guide);
    }

    return { message: 'Email verified', email };
  }

  async uploadDocuments(user: { userId: string; activeRole?: string }, files: any[]) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);

    const documentsBucket = this.configService.get<string>('MINIO_DOCUMENTS_BUCKET_NAME') || 'documents';

    const list = Array.isArray(files) ? files : [];
    if (!list.length) throw new BadRequestException('Missing files. Expected multipart/form-data field "documents"');

    const existingDocs = Array.isArray(guide.freelanceDocuments)
      ? guide.freelanceDocuments
      : [];
    const hasExisting =
      !!guide.freelanceDocumentsUploadedAt && existingDocs.length > 0;
    const status =
      guide.freelanceDocumentsVerificationStatus ||
      FreelanceDocumentsVerificationStatus.PENDING;

    if (hasExisting && status !== FreelanceDocumentsVerificationStatus.REJECTED) {
      throw new BadRequestException(
        'Documents already uploaded. You can upload again only if they are rejected after verification.',
      );
    }

    const keys: string[] = [];
    for (const f of list) {
      const key = `freelance-documents/${guide.id}/${Date.now()}-${String(f?.originalname || 'document')}`;
      await this.minioService.uploadFile(documentsBucket, key, f.buffer, f.mimetype);
      keys.push(key);
    }

    guide.freelanceDocuments = keys;
    guide.freelanceDocumentsUploadedAt = new Date();
    guide.freelanceDocumentsVerificationStatus =
      FreelanceDocumentsVerificationStatus.PENDING;
    guide.freelanceDocumentsReviewedAt = null;
    guide.freelanceDocumentsRejectReason = null;
    await this.guideRepository.save(guide);

    return this.buildMeResponse(guide);
  }

  async uploadContract(
    user: { userId: string; activeRole?: string },
    payload: { durationMonths: number; signatureText?: string; signatureBase64?: string },
    files: { signature?: any[] },
  ) {
    this.assertFreelance(user.activeRole);
    const guide = await this.getGuideOrThrow(user.userId);

    const nowMs = Date.now();
    const hasValidContract = !!(
      guide.freelanceContractSignedAt &&
      guide.freelanceContractExpiresAt &&
      new Date(guide.freelanceContractExpiresAt).getTime() > nowMs &&
      guide.freelanceContractPdfKey
    );
    if (hasValidContract) {
      throw new BadRequestException(
        'Contract is still valid. You can re-sign only after expiration.',
      );
    }

    const durationMonths = Number(payload?.durationMonths);
    if (![6, 12, 24].includes(durationMonths)) {
      throw new BadRequestException('durationMonths must be one of 6, 12, 24');
    }

    const signatureFile = Array.isArray(files?.signature) ? files.signature[0] : null;
    const signatureText = String(payload?.signatureText || '').trim() || null;
    const signatureBase64 = String(payload?.signatureBase64 || '').trim() || null;

    if (!signatureFile && !signatureText && !signatureBase64) {
      throw new BadRequestException(
        'Missing signature. Provide one of: multipart field "signature" (image), or "signatureText", or "signatureBase64".',
      );
    }

    const documentsBucket = this.configService.get<string>('MINIO_DOCUMENTS_BUCKET_NAME') || 'documents';
    const imagesBucket = this.configService.get<string>('MINIO_IMAGES_BUCKET_NAME') || 'images';

    // 1. Handle Signature Upload (optional)
    let signatureKey: string | null = null;
    if (signatureFile) {
      signatureKey = `freelance-contracts/${guide.id}/${Date.now()}-signature.png`;
      await this.minioService.uploadFile(imagesBucket, signatureKey, signatureFile.buffer, signatureFile.mimetype);
    }

    // 2. Generate PDF Contract
    const doc = new PDFDocument({ margin: 50 });
    const chunks: any[] = [];
    doc.on('data', (chunk) => chunks.push(chunk));

    const pdfPromise = new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    // PDF Content
    doc.fontSize(20).text('CONTRAT DE SERVICES GUIDE TOURISTIQUE', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`);
    const guideName = guide.firstName
      ? `${guide.firstName} ${guide.lastName || ''}`.trim()
      : guide.email;
    doc.text(`Guide: ${guideName}`);
    doc.text(`Rôle: Guide freelance`);
    doc.text(`ID Guide: ${guide.id}`);
    doc.moveDown();

    doc.fontSize(14).text('CONDITIONS DU CONTRAT', { underline: true });
    doc.fontSize(10).text('\n1. INTRODUCTION: Ce contrat lie le guide à la plateforme Sabeel.\n' +
      '2. OBJET: Le guide propose ses services aux pèlerins via la plateforme.\n' +
      '3. OBLIGATIONS: Le guide doit fournir un service de qualité et respecter les principes religieux.\n' +
      '4. DURÉE: Le contrat est valide pour la période choisie lors de la signature.\n' +
      '5. CONFIDENTIALITÉ: Les données des pèlerins doivent rester confidentielles.\n' +
      '6. RESPONSABILITÉ: Le guide est responsable de ses prestations.');
    
    doc.moveDown(2);
    doc.fontSize(12).text(`DURÉE DU CONTRAT: ${durationMonths} mois`);
    const expiresAt = new Date(Date.now() + this.monthsToMs(durationMonths));
    doc.text(`DATE D'EXPIRATION: ${expiresAt.toLocaleDateString()}`);
    
    doc.moveDown(2);
    doc.text('SIGNATURE DU GUIDE:', { underline: true });

    // Embed signature (priority: uploaded file > base64 > text)
    let embeddedImage = false;
    if (signatureFile?.buffer) {
      try {
        doc.image(signatureFile.buffer, { fit: [150, 80] });
        embeddedImage = true;
      } catch {
        // ignore
      }
    }

    if (!embeddedImage && signatureBase64 && signatureBase64.startsWith('data:image/')) {
      try {
        const base64Part = signatureBase64.split(',')[1];
        const buf = Buffer.from(base64Part, 'base64');
        doc.image(buf, { fit: [150, 80] });
        embeddedImage = true;
      } catch {
        // ignore
      }
    }

    if (!embeddedImage) {
      if (signatureText) {
        doc.fontSize(16).text(signatureText, { oblique: true });
      } else {
        doc.text('[Signature non intégrée dans le PDF]');
      }
    }

    doc.moveDown();
    doc.fontSize(12).text('SIGNATURE SABEEL:', { underline: true });
    doc.text('Validé par Sabeel Platform');

    doc.end();

    const pdfBuffer = await pdfPromise;
    const contractKey = `freelance-contracts/${guide.id}/${Date.now()}-contract.pdf`;
    
    // 3. Upload Generated PDF
    await this.minioService.uploadFile(documentsBucket, contractKey, pdfBuffer, 'application/pdf');

    // 4. Update Guide Record
    guide.freelanceContractPdfKey = contractKey;
    guide.freelanceContractSignatureKey = signatureKey;
    guide.freelanceContractSignedAt = new Date();
    guide.freelanceContractDurationMonths = durationMonths;
    guide.freelanceContractExpiresAt = expiresAt;
    guide.freelanceContractExpirationNotifiedAt = null;

    await this.guideRepository.save(guide);
    return this.buildMeResponse(guide);
  }
}
