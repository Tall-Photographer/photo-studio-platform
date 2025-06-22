// packages/backend/src/services/fileGallery.service.ts
import { File, FileType, Project, Prisma } from '@prisma/client';
import { S3 } from 'aws-sdk';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { AuditService } from './audit.service';
import { NotificationService } from './notification.service';
import { EmailService } from './email.service';
import dayjs from 'dayjs';

interface FileUploadOptions {
  projectId: string;
  clientId?: string;
  tags?: string[];
  notes?: string;
  isSelected?: boolean;
  generateThumbnail?: boolean;
  addWatermark?: boolean;
}

interface GalleryOptions {
  projectId: string;
  includeRaw?: boolean;
  includeEdited?: boolean;
  sortBy?: 'date' | 'name' | 'size' | 'selected';
  groupBy?: 'date' | 'type' | 'status';
}

interface FileProcessingOptions {
  resize?: {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  };
  watermark?: {
    text?: string;
    logo?: Buffer;
    position?: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    opacity?: number;
  };
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

interface Gallery {
  id: string;
  name: string;
  description?: string;
  coverImage?: string;
  shareUrl?: string;
  password?: string;
  expiresAt?: Date;
  allowDownload: boolean;
  allowSelection: boolean;
  watermarkEnabled: boolean;
  files: File[];
  metadata: {
    totalFiles: number;
    totalSize: number;
    selectedCount: number;
    editedCount: number;
  };
}

interface DeliveryPackage {
  id: string;
  projectId: string;
  name: string;
  files: string[];
  deliveryMethod: 'download' | 'usb' | 'cloud';
  status: 'preparing' | 'ready' | 'delivered';
  downloadUrl?: string;
  expiresAt?: Date;
  deliveredAt?: Date;
}

export class FileGalleryService {
  private static instance: FileGalleryService;
  private db = DatabaseService.getInstance().getClient();
  private logger = LoggerService.getInstance();
  private auditService = AuditService.getInstance();
  private notificationService = NotificationService.getInstance();
  private emailService = EmailService.getInstance();
  private s3: S3;

  private readonly thumbnailSizes = {
    small: { width: 150, height: 150 },
    medium: { width: 400, height: 400 },
    large: { width: 800, height: 800 },
  };

  private readonly supportedImageFormats = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp'];

  private readonly supportedVideoFormats = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv'];

  private constructor() {
    this.s3 = new S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });
  }

  public static getInstance(): FileGalleryService {
    if (!FileGalleryService.instance) {
      FileGalleryService.instance = new FileGalleryService();
    }
    return FileGalleryService.instance;
  }

  // Upload file
  public async uploadFile(
    file: Express.Multer.File,
    options: FileUploadOptions,
    uploadedBy: string
  ): Promise<File> {
    try {
      // Validate file
      this.validateFile(file);

      // Generate unique key
      const fileExtension = path.extname(file.originalname).toLowerCase();
      const fileKey = `projects/${options.projectId}/${uuidv4()}${fileExtension}`;

      // Determine file type
      const fileType = this.getFileType(file.mimetype, fileExtension);

      // Upload to S3
      const uploadResult = await this.s3
        .upload({
          Bucket: process.env.AWS_S3_BUCKET!,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
          Metadata: {
            originalName: file.originalname,
            projectId: options.projectId,
            uploadedBy,
          },
        })
        .promise();

      // Process image if needed
      let thumbnailUrl: string | undefined;
      let watermarkUrl: string | undefined;
      let metadata: any = {};

      if (fileType === 'IMAGE') {
        // Get image metadata
        const imageMetadata = await sharp(file.buffer).metadata();
        metadata = {
          width: imageMetadata.width,
          height: imageMetadata.height,
          format: imageMetadata.format,
          space: imageMetadata.space,
          channels: imageMetadata.channels,
          depth: imageMetadata.depth,
          density: imageMetadata.density,
          hasAlpha: imageMetadata.hasAlpha,
        };

        // Generate thumbnail
        if (options.generateThumbnail !== false) {
          thumbnailUrl = await this.generateThumbnail(file.buffer, fileKey, options.projectId);
        }

        // Add watermark if requested
        if (options.addWatermark) {
          watermarkUrl = await this.addWatermark(file.buffer, fileKey, options.projectId);
        }
      }

      // Create file record
      const fileRecord = await this.db.file.create({
        data: {
          projectId: options.projectId,
          clientId: options.clientId,
          uploadedBy,
          filename: fileKey,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          type: fileType,
          storageProvider: 's3',
          storageKey: fileKey,
          url: uploadResult.Location,
          thumbnailUrl,
          watermarkUrl,
          width: metadata.width,
          height: metadata.height,
          metadata,
          isSelected: options.isSelected || false,
          tags: options.tags || [],
          notes: options.notes,
          hasWatermark: !!watermarkUrl,
        },
      });

      // Update project file count
      await this.db.project.update({
        where: { id: options.projectId },
        data: {
          totalFiles: { increment: 1 },
        },
      });

      // Audit log
      await this.auditService.log({
        studioId: await this.getStudioIdFromProject(options.projectId),
        userId: uploadedBy,
        action: 'FILE_UPLOADED',
        entity: 'File',
        entityId: fileRecord.id,
        metadata: {
          filename: file.originalname,
          size: file.size,
          type: fileType,
        },
      });

      return fileRecord;
    } catch (error) {
      this.logger.error('File upload failed:', error);
      throw error;
    }
  }

  // Batch upload files
  public async batchUploadFiles(
    files: Express.Multer.File[],
    options: FileUploadOptions,
    uploadedBy: string
  ): Promise<File[]> {
    const uploadPromises = files.map((file) => this.uploadFile(file, options, uploadedBy));

    const results = await Promise.allSettled(uploadPromises);

    const successfulUploads = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<File>).value);

    const failedUploads = results
      .filter((result) => result.status === 'rejected')
      .map((result, index) => ({
        filename: files[index].originalname,
        error: (result as PromiseRejectedResult).reason.message,
      }));

    if (failedUploads.length > 0) {
      this.logger.warn('Some files failed to upload:', failedUploads);
    }

    return successfulUploads;
  }

  // Get gallery
  public async getGallery(projectId: string, options: GalleryOptions = {}): Promise<Gallery> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        files: {
          where: {
            isEdited:
              options.includeEdited === true
                ? true
                : options.includeRaw === true
                  ? false
                  : undefined,
          },
          orderBy: this.getOrderBy(options.sortBy),
        },
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Calculate metadata
    const metadata = {
      totalFiles: project.files.length,
      totalSize: project.files.reduce((sum, file) => sum + Number(file.size), 0),
      selectedCount: project.files.filter((f) => f.isSelected).length,
      editedCount: project.files.filter((f) => f.isEdited).length,
    };

    // Group files if requested
    const groupedFiles = options.groupBy
      ? this.groupFiles(project.files, options.groupBy)
      : project.files;

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      coverImage: project.files[0]?.thumbnailUrl,
      shareUrl: undefined, // Will be generated when sharing
      password: undefined,
      expiresAt: undefined,
      allowDownload: true,
      allowSelection: true,
      watermarkEnabled: false,
      files: groupedFiles,
      metadata,
    };
  }

  // Create shareable gallery
  public async createShareableGallery(
    projectId: string,
    options: {
      name?: string;
      description?: string;
      password?: string;
      expiresIn?: number; // days
      allowDownload?: boolean;
      allowSelection?: boolean;
      watermarkEnabled?: boolean;
      fileIds?: string[];
    },
    createdBy: string
  ): Promise<Gallery> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      include: {
        files: {
          where: options.fileIds
            ? {
                id: { in: options.fileIds },
              }
            : undefined,
        },
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    // Generate share token
    const shareToken = uuidv4();
    const shareUrl = `${process.env.APP_URL}/gallery/${shareToken}`;

    // Store gallery settings
    const gallerySettings = await this.db.systemSetting.create({
      data: {
        studioId: project.studioId,
        key: `gallery_${shareToken}`,
        category: 'gallery',
        value: {
          projectId,
          name: options.name || project.name,
          description: options.description || project.description,
          password: options.password ? await this.hashPassword(options.password) : null,
          expiresAt: options.expiresIn ? dayjs().add(options.expiresIn, 'days').toDate() : null,
          allowDownload: options.allowDownload ?? true,
          allowSelection: options.allowSelection ?? true,
          watermarkEnabled: options.watermarkEnabled ?? false,
          fileIds: options.fileIds || project.files.map((f) => f.id),
          createdBy,
          createdAt: new Date(),
        },
        description: `Shareable gallery for project ${project.name}`,
      },
    });

    // Send notification to client
    if (project.client?.portalEnabled) {
      await this.notificationService.notifyClient({
        clientId: project.clientId,
        type: 'GALLERY_SHARED',
        title: 'New Gallery Available',
        message: `Your photos from ${project.name} are ready to view!`,
        actionUrl: shareUrl,
      });
    }

    // Audit log
    await this.auditService.log({
      studioId: project.studioId,
      userId: createdBy,
      action: 'GALLERY_CREATED',
      entity: 'Gallery',
      entityId: shareToken,
      metadata: {
        projectId,
        fileCount: project.files.length,
        expiresIn: options.expiresIn,
      },
    });

    return {
      id: shareToken,
      name: options.name || project.name,
      description: options.description,
      coverImage: project.files[0]?.thumbnailUrl,
      shareUrl,
      password: options.password ? '***' : undefined,
      expiresAt: options.expiresIn ? dayjs().add(options.expiresIn, 'days').toDate() : undefined,
      allowDownload: options.allowDownload ?? true,
      allowSelection: options.allowSelection ?? true,
      watermarkEnabled: options.watermarkEnabled ?? false,
      files: project.files,
      metadata: {
        totalFiles: project.files.length,
        totalSize: project.files.reduce((sum, f) => sum + Number(f.size), 0),
        selectedCount: 0,
        editedCount: project.files.filter((f) => f.isEdited).length,
      },
    };
  }

  // Update file
  public async updateFile(
    fileId: string,
    updates: {
      isSelected?: boolean;
      isEdited?: boolean;
      isFavorite?: boolean;
      tags?: string[];
      notes?: string;
    },
    userId: string
  ): Promise<File> {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new Error('File not found');
    }

    const updatedFile = await this.db.file.update({
      where: { id: fileId },
      data: updates,
    });

    // Update project counts
    if (updates.isSelected !== undefined) {
      await this.db.project.update({
        where: { id: file.projectId },
        data: {
          selectedFiles: updates.isSelected ? { increment: 1 } : { decrement: 1 },
        },
      });
    }

    if (updates.isEdited !== undefined) {
      await this.db.project.update({
        where: { id: file.projectId },
        data: {
          editedFiles: updates.isEdited ? { increment: 1 } : { decrement: 1 },
        },
      });
    }

    // Audit log
    await this.auditService.log({
      studioId: await this.getStudioIdFromProject(file.projectId),
      userId,
      action: 'FILE_UPDATED',
      entity: 'File',
      entityId: fileId,
      oldValues: file,
      newValues: updatedFile,
    });

    return updatedFile;
  }

  // Batch update files
  public async batchUpdateFiles(
    fileIds: string[],
    updates: {
      isSelected?: boolean;
      isEdited?: boolean;
      tags?: string[];
    },
    userId: string
  ): Promise<number> {
    const result = await this.db.file.updateMany({
      where: { id: { in: fileIds } },
      data: updates,
    });

    // Get project ID for count updates
    const firstFile = await this.db.file.findFirst({
      where: { id: { in: fileIds } },
    });

    if (firstFile) {
      // Update project counts
      if (updates.isSelected !== undefined) {
        const selectedDelta = updates.isSelected ? result.count : -result.count;
        await this.db.project.update({
          where: { id: firstFile.projectId },
          data: {
            selectedFiles: { increment: selectedDelta },
          },
        });
      }

      if (updates.isEdited !== undefined) {
        const editedDelta = updates.isEdited ? result.count : -result.count;
        await this.db.project.update({
          where: { id: firstFile.projectId },
          data: {
            editedFiles: { increment: editedDelta },
          },
        });
      }
    }

    return result.count;
  }

  // Delete file
  public async deleteFile(fileId: string, userId: string): Promise<void> {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new Error('File not found');
    }

    // Delete from S3
    try {
      await this.s3
        .deleteObject({
          Bucket: process.env.AWS_S3_BUCKET!,
          Key: file.storageKey,
        })
        .promise();

      // Delete thumbnail if exists
      if (file.thumbnailUrl) {
        const thumbnailKey = this.getKeyFromUrl(file.thumbnailUrl);
        await this.s3
          .deleteObject({
            Bucket: process.env.AWS_S3_BUCKET!,
            Key: thumbnailKey,
          })
          .promise();
      }

      // Delete watermark if exists
      if (file.watermarkUrl) {
        const watermarkKey = this.getKeyFromUrl(file.watermarkUrl);
        await this.s3
          .deleteObject({
            Bucket: process.env.AWS_S3_BUCKET!,
            Key: watermarkKey,
          })
          .promise();
      }
    } catch (error) {
      this.logger.error('Failed to delete file from S3:', error);
    }

    // Delete from database
    await this.db.file.delete({
      where: { id: fileId },
    });

    // Update project counts
    await this.db.project.update({
      where: { id: file.projectId },
      data: {
        totalFiles: { decrement: 1 },
        selectedFiles: file.isSelected ? { decrement: 1 } : undefined,
        editedFiles: file.isEdited ? { decrement: 1 } : undefined,
      },
    });

    // Audit log
    await this.auditService.log({
      studioId: await this.getStudioIdFromProject(file.projectId),
      userId,
      action: 'FILE_DELETED',
      entity: 'File',
      entityId: fileId,
      metadata: {
        filename: file.originalName,
        size: file.size,
      },
    });
  }

  // Create delivery package
  public async createDeliveryPackage(
    projectId: string,
    options: {
      name: string;
      fileIds: string[];
      deliveryMethod: 'download' | 'usb' | 'cloud';
      expiresIn?: number; // days
      notifyClient?: boolean;
    },
    createdBy: string
  ): Promise<DeliveryPackage> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      include: {
        client: true,
        files: {
          where: { id: { in: options.fileIds } },
        },
      },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    const packageId = uuidv4();
    let downloadUrl: string | undefined;

    if (options.deliveryMethod === 'download') {
      // Create zip file with selected files
      downloadUrl = await this.createDownloadPackage(project.files, packageId);
    }

    // Store delivery package
    const deliveryPackage = await this.db.systemSetting.create({
      data: {
        studioId: project.studioId,
        key: `delivery_${packageId}`,
        category: 'delivery',
        value: {
          id: packageId,
          projectId,
          name: options.name,
          files: options.fileIds,
          deliveryMethod: options.deliveryMethod,
          status: 'ready',
          downloadUrl,
          expiresAt: options.expiresIn ? dayjs().add(options.expiresIn, 'days').toDate() : null,
          createdBy,
          createdAt: new Date(),
        },
        description: `Delivery package for project ${project.name}`,
      },
    });

    // Update project status
    await this.db.project.update({
      where: { id: projectId },
      data: {
        status: 'DELIVERED',
        deliveredAt: new Date(),
      },
    });

    // Notify client
    if (options.notifyClient && project.client) {
      await this.emailService.sendDeliveryNotification({
        email: project.client.email,
        firstName: project.client.firstName,
        projectName: project.name,
        deliveryMethod: options.deliveryMethod,
        downloadUrl,
        expiresAt: options.expiresIn ? dayjs().add(options.expiresIn, 'days').toDate() : undefined,
      });
    }

    // Audit log
    await this.auditService.log({
      studioId: project.studioId,
      userId: createdBy,
      action: 'DELIVERY_CREATED',
      entity: 'Delivery',
      entityId: packageId,
      metadata: {
        projectId,
        fileCount: options.fileIds.length,
        method: options.deliveryMethod,
      },
    });

    return {
      id: packageId,
      projectId,
      name: options.name,
      files: options.fileIds,
      deliveryMethod: options.deliveryMethod,
      status: 'ready',
      downloadUrl,
      expiresAt: options.expiresIn ? dayjs().add(options.expiresIn, 'days').toDate() : undefined,
      deliveredAt: new Date(),
    };
  }

  // Process image
  public async processImage(
    fileId: string,
    options: FileProcessingOptions,
    processedBy: string
  ): Promise<File> {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });

    if (!file || file.type !== 'IMAGE') {
      throw new Error('Image file not found');
    }

    // Download original from S3
    const originalData = await this.s3
      .getObject({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: file.storageKey,
      })
      .promise();

    let processedImage = sharp(originalData.Body as Buffer);

    // Apply resize if specified
    if (options.resize) {
      processedImage = processedImage.resize(options.resize);
    }

    // Apply watermark if specified
    if (options.watermark) {
      processedImage = await this.applyWatermark(processedImage, options.watermark);
    }

    // Convert format if specified
    if (options.format) {
      processedImage = processedImage.toFormat(options.format, {
        quality: options.quality || 90,
      });
    }

    // Generate new filename
    const processedBuffer = await processedImage.toBuffer();
    const newKey = `projects/${file.projectId}/edited/${uuidv4()}.${options.format || 'jpg'}`;

    // Upload processed image
    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: newKey,
        Body: processedBuffer,
        ContentType: `image/${options.format || 'jpeg'}`,
      })
      .promise();

    // Create new file record for edited version
    const editedFile = await this.db.file.create({
      data: {
        ...file,
        id: undefined,
        filename: newKey,
        originalName: `edited_${file.originalName}`,
        storageKey: newKey,
        url: uploadResult.Location,
        isEdited: true,
        parentId: file.id,
        version: (file.version || 1) + 1,
        uploadedBy: processedBy,
        uploadedAt: new Date(),
        editedAt: new Date(),
      },
    });

    return editedFile;
  }

  // Helper methods
  private validateFile(file: Express.Multer.File): void {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10); // 50MB default

    if (file.size > maxSize) {
      throw new Error(`File size exceeds maximum allowed size of ${maxSize / 1048576}MB`);
    }

    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'pdf',
      'mp4',
      'mov',
    ];

    const fileExtension = path.extname(file.originalname).toLowerCase().slice(1);
    if (!allowedTypes.includes(fileExtension)) {
      throw new Error(`File type .${fileExtension} is not allowed`);
    }
  }

  private getFileType(mimeType: string, extension: string): FileType {
    const ext = extension.toLowerCase().replace('.', '');

    if (this.supportedImageFormats.includes(ext)) {
      return 'IMAGE';
    }

    if (this.supportedVideoFormats.includes(ext)) {
      return 'VIDEO';
    }

    if (ext === 'pdf' || ext === 'doc' || ext === 'docx') {
      return 'DOCUMENT';
    }

    return 'OTHER';
  }

  private async generateThumbnail(
    buffer: Buffer,
    originalKey: string,
    projectId: string
  ): Promise<string> {
    const thumbnailKey = `projects/${projectId}/thumbnails/${path.basename(originalKey)}`;

    const thumbnail = await sharp(buffer)
      .resize(this.thumbnailSizes.medium)
      .jpeg({ quality: 80 })
      .toBuffer();

    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: thumbnailKey,
        Body: thumbnail,
        ContentType: 'image/jpeg',
      })
      .promise();

    return uploadResult.Location;
  }

  private async addWatermark(
    buffer: Buffer,
    originalKey: string,
    projectId: string
  ): Promise<string> {
    const studio = await this.db.studio.findFirst({
      where: {
        projects: {
          some: { id: projectId },
        },
      },
    });

    if (!studio) {
      throw new Error('Studio not found');
    }

    const watermarkKey = `projects/${projectId}/watermarked/${path.basename(originalKey)}`;

    // Create watermark text
    const watermarkText = studio.name;
    const svgWatermark = `
      <svg width="300" height="100">
        <text x="50%" y="50%" 
              font-family="Arial" 
              font-size="30" 
              fill="white" 
              fill-opacity="0.5" 
              text-anchor="middle">
          ${watermarkText}
        </text>
      </svg>
    `;

    const watermarked = await sharp(buffer)
      .composite([
        {
          input: Buffer.from(svgWatermark),
          gravity: 'southeast',
        },
      ])
      .toBuffer();

    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET!,
        Key: watermarkKey,
        Body: watermarked,
        ContentType: 'image/jpeg',
      })
      .promise();

    return uploadResult.Location;
  }

  private async applyWatermark(
    image: sharp.Sharp,
    watermark: FileProcessingOptions['watermark']
  ): Promise<sharp.Sharp> {
    if (watermark?.text) {
      const svgWatermark = `
        <svg width="300" height="100">
          <text x="50%" y="50%" 
                font-family="Arial" 
                font-size="30" 
                fill="white" 
                fill-opacity="${watermark.opacity || 0.5}" 
                text-anchor="middle">
            ${watermark.text}
          </text>
        </svg>
      `;

      return image.composite([
        {
          input: Buffer.from(svgWatermark),
          gravity: watermark.position || 'southeast',
        },
      ]);
    }

    if (watermark?.logo) {
      return image.composite([
        {
          input: watermark.logo,
          gravity: watermark.position || 'southeast',
          blend: 'over',
        },
      ]);
    }

    return image;
  }

  private getOrderBy(sortBy?: string): Prisma.FileOrderByWithRelationInput {
    switch (sortBy) {
      case 'name':
        return { originalName: 'asc' };
      case 'size':
        return { size: 'desc' };
      case 'selected':
        return { isSelected: 'desc' };
      case 'date':
      default:
        return { uploadedAt: 'desc' };
    }
  }

  private groupFiles(files: File[], groupBy: string): any {
    // Implementation would group files by the specified criteria
    // For now, returning ungrouped files
    return files;
  }

  private async getStudioIdFromProject(projectId: string): Promise<string> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { studioId: true },
    });

    if (!project) {
      throw new Error('Project not found');
    }

    return project.studioId;
  }

  private getKeyFromUrl(url: string): string {
    const urlParts = url.split('/');
    return urlParts.slice(3).join('/'); // Remove protocol and bucket
  }

  private async hashPassword(password: string): Promise<string> {
    const bcrypt = await import('bcryptjs');
    return bcrypt.hash(password, 10);
  }

  private async createDownloadPackage(files: File[], packageId: string): Promise<string> {
    // This would create a zip file with all selected files
    // For now, returning a placeholder URL
    return `${process.env.APP_URL}/api/v1/delivery/${packageId}/download`;
  }

  // Gallery analytics
  public async getGalleryAnalytics(galleryId: string) {
    const analytics = await this.db.$queryRaw<any[]>`
      SELECT 
        COUNT(DISTINCT visitor_id) as unique_visitors,
        COUNT(*) as total_views,
        COUNT(DISTINCT CASE WHEN action = 'download' THEN file_id END) as downloads,
        COUNT(DISTINCT CASE WHEN action = 'select' THEN file_id END) as selections
      FROM gallery_analytics
      WHERE gallery_id = ${galleryId}
    `;

    return {
      uniqueVisitors: Number(analytics[0]?.unique_visitors || 0),
      totalViews: Number(analytics[0]?.total_views || 0),
      downloads: Number(analytics[0]?.downloads || 0),
      selections: Number(analytics[0]?.selections || 0),
    };
  }

  // Client selection handling
  public async handleClientSelection(
    galleryId: string,
    fileIds: string[],
    clientInfo: {
      name: string;
      email: string;
      notes?: string;
    }
  ): Promise<void> {
    // Store client selections
    const selection = await this.db.systemSetting.create({
      data: {
        studioId: await this.getStudioIdFromGallery(galleryId),
        key: `selection_${galleryId}_${Date.now()}`,
        category: 'client_selection',
        value: {
          galleryId,
          fileIds,
          clientInfo,
          submittedAt: new Date(),
        },
        description: `Client selection from gallery ${galleryId}`,
      },
    });

    // Update selected files
    await this.db.file.updateMany({
      where: { id: { in: fileIds } },
      data: { isSelected: true },
    });

    // Send notification to studio
    await this.notificationService.notifyStudioTeam({
      studioId: await this.getStudioIdFromGallery(galleryId),
      type: 'CLIENT_SELECTION',
      title: 'New Client Selection',
      message: `${clientInfo.name} has made selections from their gallery`,
      metadata: {
        galleryId,
        selectionCount: fileIds.length,
        clientEmail: clientInfo.email,
      },
    });

    // Send confirmation to client
    await this.emailService.sendSelectionConfirmation({
      email: clientInfo.email,
      name: clientInfo.name,
      selectionCount: fileIds.length,
    });
  }

  private async getStudioIdFromGallery(galleryId: string): Promise<string> {
    const setting = await this.db.systemSetting.findFirst({
      where: {
        key: `gallery_${galleryId}`,
        category: 'gallery',
      },
    });

    if (!setting) {
      throw new Error('Gallery not found');
    }

    return setting.studioId;
  }
}
