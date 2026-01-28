import crypto from "crypto";
import SteamTotp from "steam-totp";
import { config } from "./config.js";
import logger from "./logger.js";

const sessions = new Map();
const attempts = new Map();

const ATTEMPT_LIMIT = 3;
const LOCKOUT_TIME = 30 * 60 * 1000; // 30 minutes

/**
 * Simple token signing using HMAC
 */
function signToken(payload) {
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
        .createHmac("sha256", config.security.sessionSecret)
        .update(`${head}.${body}`)
        .digest("base64url");
    return `${head}.${body}.${signature}`;
}

/**
 * Verify token and return payload
 */
function verifyToken(token) {
    try {
        const [head, body, signature] = token.split(".");
        const expected = crypto
            .createHmac("sha256", config.security.sessionSecret)
            .update(`${head}.${body}`)
            .digest("base64url");

        if (signature !== expected) return null;
        return JSON.parse(Buffer.from(body, "base64url").toString());
    } catch {
        return null;
    }
}

/**
 * Handle user login
 */
export function login(password, totpCode, ip) {
    // Check lockout
    const attempt = attempts.get(ip) || { count: 0, last: 0 };
    if (attempt.count >= ATTEMPT_LIMIT && Date.now() - attempt.last < LOCKOUT_TIME) {
        const remaining = Math.ceil((LOCKOUT_TIME - (Date.now() - attempt.last)) / 60000);
        throw new Error(`Too many attempts. Blocked for ${remaining} minutes.`);
    }

    // Validate Password
    if (password !== config.security.dashboardPassword) {
        attempt.count++;
        attempt.last = Date.now();
        attempts.set(ip, attempt);
        logger.warn(`[AUTH] Failed login attempt from ${ip} (Password mismatch)`);
        throw new Error("Invalid credentials");
    }

    // Validate 2FA
    if (config.security.dashboard2FA) {
        const isValid = SteamTotp.verify2faCode(config.security.dashboard2FA, totpCode);
        if (!isValid) {
            attempt.count++;
            attempt.last = Date.now();
            attempts.set(ip, attempt);
            logger.warn(`[AUTH] Failed login attempt from ${ip} (2FA mismatch)`);
            throw new Error("Invalid 2FA code");
        }
    }

    // Success
    attempts.delete(ip);
    const sessionID = crypto.randomBytes(32).toString("hex");
    const token = signToken({ sid: sessionID, created: Date.now() });

    sessions.set(sessionID, { ip, created: Date.now() });

    // Cleanup old sessions (basic)
    if (sessions.size > 100) sessions.clear();

    return token;
}

/**
 * Authenticate a request
 */
export function authenticate(req) {
    if (!config.security.dashboardPassword) return true;

    const cookie = req.headers.cookie;
    if (!cookie) return false;

    const token = cookie.split(";").find(c => c.trim().startsWith("rex_sid="))?.split("=")[1];
    if (!token) return false;

    const payload = verifyToken(token);
    if (!payload || !sessions.has(payload.sid)) return false;

    // Optional: check IP consistency
    // const session = sessions.get(payload.sid);
    // if (session.ip !== req.socket.remoteAddress) return false;

    return true;
}

/**
 * Get IP from request (handling proxy)
 */
export function getIP(req) {
    return req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
}
