"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
class AuthService {
    constructor() { }
    static getInstance() {
        if (!AuthService.instance) {
            AuthService.instance = new AuthService();
        }
        return AuthService.instance;
    }
    async login(email, password) {
        return {
            success: true,
            message: 'Login functionality coming soon',
            user: { email }
        };
    }
    async register(userData) {
        return {
            success: true,
            message: 'Registration functionality coming soon',
            user: userData
        };
    }
}
exports.AuthService = AuthService;
