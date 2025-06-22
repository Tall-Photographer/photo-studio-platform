"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketService = void 0;
const logger_service_1 = require("./logger.service");
class SocketService {
  constructor() {
    this.logger = logger_service_1.LoggerService.getInstance();
  }
  static getInstance() {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }
  static initialize(io, redis) {
    const instance = SocketService.getInstance();
    instance.io = io;
    instance.setupEventHandlers();
  }
  setupEventHandlers() {
    if (!this.io) return;
    this.io.on("connection", (socket) => {
      this.logger.debug(`Socket connected: ${socket.id}`);
      socket.on("join:studio", (studioId) => {
        socket.join(`studio:${studioId}`);
      });
      socket.on("disconnect", () => {
        this.logger.debug(`Socket disconnected: ${socket.id}`);
      });
    });
  }
  emit(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }
  emitToStudio(studioId, event, data) {
    if (this.io) {
      this.io.to(`studio:${studioId}`).emit(event, data);
    }
  }
}
exports.SocketService = SocketService;
