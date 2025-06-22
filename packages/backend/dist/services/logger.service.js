"use strict";
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.LoggerService = void 0;
const winston_1 = __importDefault(require("winston"));
const path_1 = __importDefault(require("path"));
class LoggerService {
  constructor() {
    this.logger = winston_1.default.createLogger({
      level: process.env.LOG_LEVEL || "info",
      format: winston_1.default.format.combine(
        winston_1.default.format.timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston_1.default.format.errors({ stack: true }),
        winston_1.default.format.json(),
        winston_1.default.format.prettyPrint(),
      ),
      defaultMeta: {
        service: "shootlinks-backend",
        environment: process.env.NODE_ENV || "development",
      },
      transports: [
        new winston_1.default.transports.Console({
          format: winston_1.default.format.combine(
            winston_1.default.format.colorize(),
            winston_1.default.format.simple(),
            winston_1.default.format.printf(
              ({ level, message, timestamp, ...meta }) => {
                let metaStr = "";
                if (Object.keys(meta).length > 0) {
                  metaStr = "\n" + JSON.stringify(meta, null, 2);
                }
                return `${timestamp} [${level}]: ${message}${metaStr}`;
              },
            ),
          ),
        }),
      ],
    });
    if (process.env.NODE_ENV === "production") {
      this.addFileTransports();
    }
  }
  static getInstance() {
    if (!LoggerService.instance) {
      LoggerService.instance = new LoggerService();
    }
    return LoggerService.instance;
  }
  addFileTransports() {
    const logDir = process.env.LOG_DIR || "logs";
    this.logger.add(
      new winston_1.default.transports.File({
        filename: path_1.default.join(logDir, "error.log"),
        level: "error",
        maxsize: 5242880,
        maxFiles: 5,
        format: winston_1.default.format.combine(
          winston_1.default.format.timestamp(),
          winston_1.default.format.json(),
        ),
      }),
    );
    this.logger.add(
      new winston_1.default.transports.File({
        filename: path_1.default.join(logDir, "combined.log"),
        maxsize: 5242880,
        maxFiles: 5,
        format: winston_1.default.format.combine(
          winston_1.default.format.timestamp(),
          winston_1.default.format.json(),
        ),
      }),
    );
  }
  debug(message, meta) {
    this.logger.debug(message, meta);
  }
  info(message, meta) {
    this.logger.info(message, meta);
  }
  warn(message, meta) {
    this.logger.warn(message, meta);
  }
  error(message, error) {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
      });
    } else {
      this.logger.error(message, { error });
    }
  }
  getLogger() {
    return this.logger;
  }
}
exports.LoggerService = LoggerService;
