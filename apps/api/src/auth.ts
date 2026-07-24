import crypto from 'node:crypto'; import bcrypt from 'bcryptjs'; import jwt, { JwtPayload } from 'jsonwebtoken'; import { Request, Response, NextFunction } from 'express';
const accessSecret = () => process.env.JWT_ACCESS_SECRET || 'dev-access-secret'; const refreshSecret = () => process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';
export const hashToken = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const hashPassword = (value: string) => bcrypt.hash(value, 12); export const verifyPassword = (value: string, hash: string) => bcrypt.compare(value, hash);
export const issueTokens = (userId: string) => ({ accessToken: jwt.sign({ sub: userId, type: 'access' }, accessSecret(), { expiresIn: '15m' }), refreshToken: jwt.sign({ sub: userId, type: 'refresh' }, refreshSecret(), { expiresIn: '30d' }) });
export function auth(req: Request, res: Response, next: NextFunction) { const value = req.headers.authorization?.replace(/^Bearer\s+/i, ''); if (!value) return res.status(401).json({ error: 'Authentication required' }); try { const p = jwt.verify(value, accessSecret()) as JwtPayload; if (p.type !== 'access' || !p.sub) throw new Error(); req.userId = p.sub; next(); } catch { return res.status(401).json({ error: 'Invalid or expired access token' }); } }
declare global { namespace Express { interface Request { userId?: string } } }
