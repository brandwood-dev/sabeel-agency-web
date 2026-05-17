import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class SanitizeMiddleware implements NestMiddleware {
    use(req: Request, res: Response, next: NextFunction) {
        try {
            // Skip sanitization for DELETE requests (no body expected)
            if (req.method === 'DELETE') {
                return next();
            }

            // Skip sanitization for delete-account endpoint since it carries a password.
            // Passwords may legitimately contain substrings like "delete" or other patterns.
            if (typeof (req as any).originalUrl === 'string' && (req as any).originalUrl.includes('/delete-account')) {
                return next();
            }

            // Sanitize request body
            if (req.body) {
                req.body = this.sanitizeObject(req.body);
            }

            // Sanitize query parameters
            if (req.query) {
                const sanitizedQuery = this.sanitizeObject(req.query);
                Object.keys(sanitizedQuery).forEach(key => {
                    (req.query as any)[key] = sanitizedQuery[key];
                });
            }

            // Sanitize URL parameters
            if (req.params) {
                req.params = this.sanitizeObject(req.params);
            }

            next();
        } catch (error) {
            next(error);
        }
    }

    private sanitizeObject(obj: any, parentKey?: string): any {
        if (typeof obj !== 'object' || obj === null) {
            return this.sanitizeString(obj, parentKey);
        }

        const sanitized = Array.isArray(obj) ? [] : {};

        Object.keys(obj).forEach(key => {
            const sanitizedKey = this.sanitizeString(key);
            if (typeof obj[key] === 'object' && obj[key] !== null) {
                sanitized[sanitizedKey] = this.sanitizeObject(obj[key], sanitizedKey);
            } else {
                sanitized[sanitizedKey] = this.sanitizeString(obj[key], sanitizedKey);
            }
        });

        return sanitized;
    }

    private sanitizeString(value: any, key?: string): any {
        if (typeof value !== 'string') {
            return value;
        }

        let sanitized = value
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .trim();

        const skipSqlCheckKeys = new Set([
            'password',
            'confirmPassword',
            'newPassword',
            'oldPassword',
        ]);

        const sqlPatterns = [
            /(\b(DROP|DELETE|TRUNCATE)\b)/gi,
            /(--|\#|\/\*|\*\/)/g,
        ];

        if (!key || !skipSqlCheckKeys.has(key)) {
            for (const pattern of sqlPatterns) {
                if (pattern.test(sanitized)) {
                    throw new HttpException('Invalid input detected', HttpStatus.BAD_REQUEST);
                }
            }
        }

        return sanitized;
    }
}
