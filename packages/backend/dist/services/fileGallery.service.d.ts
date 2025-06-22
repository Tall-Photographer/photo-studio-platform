import { File } from "@prisma/client";
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
  sortBy?: "date" | "name" | "size" | "selected";
  groupBy?: "date" | "type" | "status";
}
interface FileProcessingOptions {
  resize?: {
    width?: number;
    height?: number;
    fit?: "cover" | "contain" | "fill" | "inside" | "outside";
  };
  watermark?: {
    text?: string;
    logo?: Buffer;
    position?:
      | "center"
      | "top-left"
      | "top-right"
      | "bottom-left"
      | "bottom-right";
    opacity?: number;
  };
  format?: "jpeg" | "png" | "webp";
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
  deliveryMethod: "download" | "usb" | "cloud";
  status: "preparing" | "ready" | "delivered";
  downloadUrl?: string;
  expiresAt?: Date;
  deliveredAt?: Date;
}
export declare class FileGalleryService {
  private static instance;
  private db;
  private logger;
  private auditService;
  private notificationService;
  private emailService;
  private s3;
  private readonly thumbnailSizes;
  private readonly supportedImageFormats;
  private readonly supportedVideoFormats;
  private constructor();
  static getInstance(): FileGalleryService;
  uploadFile(
    file: Express.Multer.File,
    options: FileUploadOptions,
    uploadedBy: string,
  ): Promise<File>;
  batchUploadFiles(
    files: Express.Multer.File[],
    options: FileUploadOptions,
    uploadedBy: string,
  ): Promise<File[]>;
  getGallery(projectId: string, options?: GalleryOptions): Promise<Gallery>;
  createShareableGallery(
    projectId: string,
    options: {
      name?: string;
      description?: string;
      password?: string;
      expiresIn?: number;
      allowDownload?: boolean;
      allowSelection?: boolean;
      watermarkEnabled?: boolean;
      fileIds?: string[];
    },
    createdBy: string,
  ): Promise<Gallery>;
  updateFile(
    fileId: string,
    updates: {
      isSelected?: boolean;
      isEdited?: boolean;
      isFavorite?: boolean;
      tags?: string[];
      notes?: string;
    },
    userId: string,
  ): Promise<File>;
  batchUpdateFiles(
    fileIds: string[],
    updates: {
      isSelected?: boolean;
      isEdited?: boolean;
      tags?: string[];
    },
    userId: string,
  ): Promise<number>;
  deleteFile(fileId: string, userId: string): Promise<void>;
  createDeliveryPackage(
    projectId: string,
    options: {
      name: string;
      fileIds: string[];
      deliveryMethod: "download" | "usb" | "cloud";
      expiresIn?: number;
      notifyClient?: boolean;
    },
    createdBy: string,
  ): Promise<DeliveryPackage>;
  processImage(
    fileId: string,
    options: FileProcessingOptions,
    processedBy: string,
  ): Promise<File>;
  private validateFile;
  private getFileType;
  private generateThumbnail;
  private addWatermark;
  private applyWatermark;
  private getOrderBy;
  private groupFiles;
  private getStudioIdFromProject;
  private getKeyFromUrl;
  private hashPassword;
  private createDownloadPackage;
  getGalleryAnalytics(galleryId: string): Promise<{
    uniqueVisitors: number;
    totalViews: number;
    downloads: number;
    selections: number;
  }>;
  handleClientSelection(
    galleryId: string,
    fileIds: string[],
    clientInfo: {
      name: string;
      email: string;
      notes?: string;
    },
  ): Promise<void>;
  private getStudioIdFromGallery;
}
export {};
