"use strict";
var __createBinding =
  (this && this.__createBinding) ||
  (Object.create
    ? function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        var desc = Object.getOwnPropertyDescriptor(m, k);
        if (
          !desc ||
          ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)
        ) {
          desc = {
            enumerable: true,
            get: function () {
              return m[k];
            },
          };
        }
        Object.defineProperty(o, k2, desc);
      }
    : function (o, m, k, k2) {
        if (k2 === undefined) k2 = k;
        o[k2] = m[k];
      });
var __setModuleDefault =
  (this && this.__setModuleDefault) ||
  (Object.create
    ? function (o, v) {
        Object.defineProperty(o, "default", { enumerable: true, value: v });
      }
    : function (o, v) {
        o["default"] = v;
      });
var __importStar =
  (this && this.__importStar) ||
  (function () {
    var ownKeys = function (o) {
      ownKeys =
        Object.getOwnPropertyNames ||
        function (o) {
          var ar = [];
          for (var k in o)
            if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
          return ar;
        };
      return ownKeys(o);
    };
    return function (mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null)
        for (var k = ownKeys(mod), i = 0; i < k.length; i++)
          if (k[i] !== "default") __createBinding(result, mod, k[i]);
      __setModuleDefault(result, mod);
      return result;
    };
  })();
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileGalleryService = void 0;
const aws_sdk_1 = require("aws-sdk");
const sharp_1 = __importDefault(require("sharp"));
const uuid_1 = require("uuid");
const path_1 = __importDefault(require("path"));
const database_service_1 = require("./database.service");
const logger_service_1 = require("./logger.service");
const audit_service_1 = require("./audit.service");
const notification_service_1 = require("./notification.service");
const email_service_1 = require("./email.service");
const dayjs_1 = __importDefault(require("dayjs"));
class FileGalleryService {
  constructor() {
    this.db = database_service_1.DatabaseService.getInstance().getClient();
    this.logger = logger_service_1.LoggerService.getInstance();
    this.auditService = audit_service_1.AuditService.getInstance();
    this.notificationService =
      notification_service_1.NotificationService.getInstance();
    this.emailService = email_service_1.EmailService.getInstance();
    this.thumbnailSizes = {
      small: { width: 150, height: 150 },
      medium: { width: 400, height: 400 },
      large: { width: 800, height: 800 },
    };
    this.supportedImageFormats = [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "webp",
      "tiff",
      "bmp",
    ];
    this.supportedVideoFormats = [
      "mp4",
      "mov",
      "avi",
      "mkv",
      "webm",
      "flv",
      "wmv",
    ];
    this.s3 = new aws_sdk_1.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
    });
  }
  static getInstance() {
    if (!FileGalleryService.instance) {
      FileGalleryService.instance = new FileGalleryService();
    }
    return FileGalleryService.instance;
  }
  async uploadFile(file, options, uploadedBy) {
    try {
      this.validateFile(file);
      const fileExtension = path_1.default
        .extname(file.originalname)
        .toLowerCase();
      const fileKey = `projects/${options.projectId}/${(0, uuid_1.v4)()}${fileExtension}`;
      const fileType = this.getFileType(file.mimetype, fileExtension);
      const uploadResult = await this.s3
        .upload({
          Bucket: process.env.AWS_S3_BUCKET,
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
      let thumbnailUrl;
      let watermarkUrl;
      let metadata = {};
      if (fileType === "IMAGE") {
        const imageMetadata = await (0, sharp_1.default)(
          file.buffer,
        ).metadata();
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
        if (options.generateThumbnail !== false) {
          thumbnailUrl = await this.generateThumbnail(
            file.buffer,
            fileKey,
            options.projectId,
          );
        }
        if (options.addWatermark) {
          watermarkUrl = await this.addWatermark(
            file.buffer,
            fileKey,
            options.projectId,
          );
        }
      }
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
          storageProvider: "s3",
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
      await this.db.project.update({
        where: { id: options.projectId },
        data: {
          totalFiles: { increment: 1 },
        },
      });
      await this.auditService.log({
        studioId: await this.getStudioIdFromProject(options.projectId),
        userId: uploadedBy,
        action: "FILE_UPLOADED",
        entity: "File",
        entityId: fileRecord.id,
        metadata: {
          filename: file.originalname,
          size: file.size,
          type: fileType,
        },
      });
      return fileRecord;
    } catch (error) {
      this.logger.error("File upload failed:", error);
      throw error;
    }
  }
  async batchUploadFiles(files, options, uploadedBy) {
    const uploadPromises = files.map((file) =>
      this.uploadFile(file, options, uploadedBy),
    );
    const results = await Promise.allSettled(uploadPromises);
    const successfulUploads = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    const failedUploads = results
      .filter((result) => result.status === "rejected")
      .map((result, index) => ({
        filename: files[index].originalname,
        error: result.reason.message,
      }));
    if (failedUploads.length > 0) {
      this.logger.warn("Some files failed to upload:", failedUploads);
    }
    return successfulUploads;
  }
  async getGallery(projectId, options = {}) {
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
      throw new Error("Project not found");
    }
    const metadata = {
      totalFiles: project.files.length,
      totalSize: project.files.reduce(
        (sum, file) => sum + Number(file.size),
        0,
      ),
      selectedCount: project.files.filter((f) => f.isSelected).length,
      editedCount: project.files.filter((f) => f.isEdited).length,
    };
    const groupedFiles = options.groupBy
      ? this.groupFiles(project.files, options.groupBy)
      : project.files;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      coverImage: project.files[0]?.thumbnailUrl,
      shareUrl: undefined,
      password: undefined,
      expiresAt: undefined,
      allowDownload: true,
      allowSelection: true,
      watermarkEnabled: false,
      files: groupedFiles,
      metadata,
    };
  }
  async createShareableGallery(projectId, options, createdBy) {
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
      throw new Error("Project not found");
    }
    const shareToken = (0, uuid_1.v4)();
    const shareUrl = `${process.env.APP_URL}/gallery/${shareToken}`;
    const gallerySettings = await this.db.systemSetting.create({
      data: {
        studioId: project.studioId,
        key: `gallery_${shareToken}`,
        category: "gallery",
        value: {
          projectId,
          name: options.name || project.name,
          description: options.description || project.description,
          password: options.password
            ? await this.hashPassword(options.password)
            : null,
          expiresAt: options.expiresIn
            ? (0, dayjs_1.default)().add(options.expiresIn, "days").toDate()
            : null,
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
    if (project.client?.portalEnabled) {
      await this.notificationService.notifyClient({
        clientId: project.clientId,
        type: "GALLERY_SHARED",
        title: "New Gallery Available",
        message: `Your photos from ${project.name} are ready to view!`,
        actionUrl: shareUrl,
      });
    }
    await this.auditService.log({
      studioId: project.studioId,
      userId: createdBy,
      action: "GALLERY_CREATED",
      entity: "Gallery",
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
      password: options.password ? "***" : undefined,
      expiresAt: options.expiresIn
        ? (0, dayjs_1.default)().add(options.expiresIn, "days").toDate()
        : undefined,
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
  async updateFile(fileId, updates, userId) {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new Error("File not found");
    }
    const updatedFile = await this.db.file.update({
      where: { id: fileId },
      data: updates,
    });
    if (updates.isSelected !== undefined) {
      await this.db.project.update({
        where: { id: file.projectId },
        data: {
          selectedFiles: updates.isSelected
            ? { increment: 1 }
            : { decrement: 1 },
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
    await this.auditService.log({
      studioId: await this.getStudioIdFromProject(file.projectId),
      userId,
      action: "FILE_UPDATED",
      entity: "File",
      entityId: fileId,
      oldValues: file,
      newValues: updatedFile,
    });
    return updatedFile;
  }
  async batchUpdateFiles(fileIds, updates, userId) {
    const result = await this.db.file.updateMany({
      where: { id: { in: fileIds } },
      data: updates,
    });
    const firstFile = await this.db.file.findFirst({
      where: { id: { in: fileIds } },
    });
    if (firstFile) {
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
  async deleteFile(fileId, userId) {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });
    if (!file) {
      throw new Error("File not found");
    }
    try {
      await this.s3
        .deleteObject({
          Bucket: process.env.AWS_S3_BUCKET,
          Key: file.storageKey,
        })
        .promise();
      if (file.thumbnailUrl) {
        const thumbnailKey = this.getKeyFromUrl(file.thumbnailUrl);
        await this.s3
          .deleteObject({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: thumbnailKey,
          })
          .promise();
      }
      if (file.watermarkUrl) {
        const watermarkKey = this.getKeyFromUrl(file.watermarkUrl);
        await this.s3
          .deleteObject({
            Bucket: process.env.AWS_S3_BUCKET,
            Key: watermarkKey,
          })
          .promise();
      }
    } catch (error) {
      this.logger.error("Failed to delete file from S3:", error);
    }
    await this.db.file.delete({
      where: { id: fileId },
    });
    await this.db.project.update({
      where: { id: file.projectId },
      data: {
        totalFiles: { decrement: 1 },
        selectedFiles: file.isSelected ? { decrement: 1 } : undefined,
        editedFiles: file.isEdited ? { decrement: 1 } : undefined,
      },
    });
    await this.auditService.log({
      studioId: await this.getStudioIdFromProject(file.projectId),
      userId,
      action: "FILE_DELETED",
      entity: "File",
      entityId: fileId,
      metadata: {
        filename: file.originalName,
        size: file.size,
      },
    });
  }
  async createDeliveryPackage(projectId, options, createdBy) {
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
      throw new Error("Project not found");
    }
    const packageId = (0, uuid_1.v4)();
    let downloadUrl;
    if (options.deliveryMethod === "download") {
      downloadUrl = await this.createDownloadPackage(project.files, packageId);
    }
    const deliveryPackage = await this.db.systemSetting.create({
      data: {
        studioId: project.studioId,
        key: `delivery_${packageId}`,
        category: "delivery",
        value: {
          id: packageId,
          projectId,
          name: options.name,
          files: options.fileIds,
          deliveryMethod: options.deliveryMethod,
          status: "ready",
          downloadUrl,
          expiresAt: options.expiresIn
            ? (0, dayjs_1.default)().add(options.expiresIn, "days").toDate()
            : null,
          createdBy,
          createdAt: new Date(),
        },
        description: `Delivery package for project ${project.name}`,
      },
    });
    await this.db.project.update({
      where: { id: projectId },
      data: {
        status: "DELIVERED",
        deliveredAt: new Date(),
      },
    });
    if (options.notifyClient && project.client) {
      await this.emailService.sendDeliveryNotification({
        email: project.client.email,
        firstName: project.client.firstName,
        projectName: project.name,
        deliveryMethod: options.deliveryMethod,
        downloadUrl,
        expiresAt: options.expiresIn
          ? (0, dayjs_1.default)().add(options.expiresIn, "days").toDate()
          : undefined,
      });
    }
    await this.auditService.log({
      studioId: project.studioId,
      userId: createdBy,
      action: "DELIVERY_CREATED",
      entity: "Delivery",
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
      status: "ready",
      downloadUrl,
      expiresAt: options.expiresIn
        ? (0, dayjs_1.default)().add(options.expiresIn, "days").toDate()
        : undefined,
      deliveredAt: new Date(),
    };
  }
  async processImage(fileId, options, processedBy) {
    const file = await this.db.file.findUnique({
      where: { id: fileId },
    });
    if (!file || file.type !== "IMAGE") {
      throw new Error("Image file not found");
    }
    const originalData = await this.s3
      .getObject({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: file.storageKey,
      })
      .promise();
    let processedImage = (0, sharp_1.default)(originalData.Body);
    if (options.resize) {
      processedImage = processedImage.resize(options.resize);
    }
    if (options.watermark) {
      processedImage = await this.applyWatermark(
        processedImage,
        options.watermark,
      );
    }
    if (options.format) {
      processedImage = processedImage.toFormat(options.format, {
        quality: options.quality || 90,
      });
    }
    const processedBuffer = await processedImage.toBuffer();
    const newKey = `projects/${file.projectId}/edited/${(0, uuid_1.v4)()}.${options.format || "jpg"}`;
    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: newKey,
        Body: processedBuffer,
        ContentType: `image/${options.format || "jpeg"}`,
      })
      .promise();
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
  validateFile(file) {
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || "52428800", 10);
    if (file.size > maxSize) {
      throw new Error(
        `File size exceeds maximum allowed size of ${maxSize / 1048576}MB`,
      );
    }
    const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(",") || [
      "jpg",
      "jpeg",
      "png",
      "gif",
      "pdf",
      "mp4",
      "mov",
    ];
    const fileExtension = path_1.default
      .extname(file.originalname)
      .toLowerCase()
      .slice(1);
    if (!allowedTypes.includes(fileExtension)) {
      throw new Error(`File type .${fileExtension} is not allowed`);
    }
  }
  getFileType(mimeType, extension) {
    const ext = extension.toLowerCase().replace(".", "");
    if (this.supportedImageFormats.includes(ext)) {
      return "IMAGE";
    }
    if (this.supportedVideoFormats.includes(ext)) {
      return "VIDEO";
    }
    if (ext === "pdf" || ext === "doc" || ext === "docx") {
      return "DOCUMENT";
    }
    return "OTHER";
  }
  async generateThumbnail(buffer, originalKey, projectId) {
    const thumbnailKey = `projects/${projectId}/thumbnails/${path_1.default.basename(originalKey)}`;
    const thumbnail = await (0, sharp_1.default)(buffer)
      .resize(this.thumbnailSizes.medium)
      .jpeg({ quality: 80 })
      .toBuffer();
    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: thumbnailKey,
        Body: thumbnail,
        ContentType: "image/jpeg",
      })
      .promise();
    return uploadResult.Location;
  }
  async addWatermark(buffer, originalKey, projectId) {
    const studio = await this.db.studio.findFirst({
      where: {
        projects: {
          some: { id: projectId },
        },
      },
    });
    if (!studio) {
      throw new Error("Studio not found");
    }
    const watermarkKey = `projects/${projectId}/watermarked/${path_1.default.basename(originalKey)}`;
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
    const watermarked = await (0, sharp_1.default)(buffer)
      .composite([
        {
          input: Buffer.from(svgWatermark),
          gravity: "southeast",
        },
      ])
      .toBuffer();
    const uploadResult = await this.s3
      .upload({
        Bucket: process.env.AWS_S3_BUCKET,
        Key: watermarkKey,
        Body: watermarked,
        ContentType: "image/jpeg",
      })
      .promise();
    return uploadResult.Location;
  }
  async applyWatermark(image, watermark) {
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
          gravity: watermark.position || "southeast",
        },
      ]);
    }
    if (watermark?.logo) {
      return image.composite([
        {
          input: watermark.logo,
          gravity: watermark.position || "southeast",
          blend: "over",
        },
      ]);
    }
    return image;
  }
  getOrderBy(sortBy) {
    switch (sortBy) {
      case "name":
        return { originalName: "asc" };
      case "size":
        return { size: "desc" };
      case "selected":
        return { isSelected: "desc" };
      case "date":
      default:
        return { uploadedAt: "desc" };
    }
  }
  groupFiles(files, groupBy) {
    return files;
  }
  async getStudioIdFromProject(projectId) {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { studioId: true },
    });
    if (!project) {
      throw new Error("Project not found");
    }
    return project.studioId;
  }
  getKeyFromUrl(url) {
    const urlParts = url.split("/");
    return urlParts.slice(3).join("/");
  }
  async hashPassword(password) {
    const bcrypt = await Promise.resolve().then(() =>
      __importStar(require("bcryptjs")),
    );
    return bcrypt.hash(password, 10);
  }
  async createDownloadPackage(files, packageId) {
    return `${process.env.APP_URL}/api/v1/delivery/${packageId}/download`;
  }
  async getGalleryAnalytics(galleryId) {
    const analytics = await this.db.$queryRaw`
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
  async handleClientSelection(galleryId, fileIds, clientInfo) {
    const selection = await this.db.systemSetting.create({
      data: {
        studioId: await this.getStudioIdFromGallery(galleryId),
        key: `selection_${galleryId}_${Date.now()}`,
        category: "client_selection",
        value: {
          galleryId,
          fileIds,
          clientInfo,
          submittedAt: new Date(),
        },
        description: `Client selection from gallery ${galleryId}`,
      },
    });
    await this.db.file.updateMany({
      where: { id: { in: fileIds } },
      data: { isSelected: true },
    });
    await this.notificationService.notifyStudioTeam({
      studioId: await this.getStudioIdFromGallery(galleryId),
      type: "CLIENT_SELECTION",
      title: "New Client Selection",
      message: `${clientInfo.name} has made selections from their gallery`,
      metadata: {
        galleryId,
        selectionCount: fileIds.length,
        clientEmail: clientInfo.email,
      },
    });
    await this.emailService.sendSelectionConfirmation({
      email: clientInfo.email,
      name: clientInfo.name,
      selectionCount: fileIds.length,
    });
  }
  async getStudioIdFromGallery(galleryId) {
    const setting = await this.db.systemSetting.findFirst({
      where: {
        key: `gallery_${galleryId}`,
        category: "gallery",
      },
    });
    if (!setting) {
      throw new Error("Gallery not found");
    }
    return setting.studioId;
  }
}
exports.FileGalleryService = FileGalleryService;
