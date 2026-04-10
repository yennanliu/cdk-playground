import { issueToken, verifyToken } from '../auth-util';

// Use a consistent test secret
process.env.JWT_SECRET = 'test-secret';

describe('auth-util', () => {
  describe('issueToken', () => {
    it('should issue a valid JWT token', () => {
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
    });

    it('should encode correct claims in token', () => {
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

      expect(payload.empId).toBe('emp123');
      expect(payload.teamId).toBe('team456');
      expect(payload.deptId).toBe('dept789');
      expect(payload.phone).toBe('555-1234');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should set expiration to 1 hour from now', () => {
      const before = Math.floor(Date.now() / 1000);
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      const after = Math.floor(Date.now() / 1000);

      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      const expiresIn = payload.exp - payload.iat;

      expect(expiresIn).toBe(3600); // 1 hour
      expect(payload.iat).toBeGreaterThanOrEqual(before);
      expect(payload.iat).toBeLessThanOrEqual(after);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      const claims = verifyToken(`Bearer ${token}`);

      expect(claims).not.toBeNull();
      expect(claims!.empId).toBe('emp123');
      expect(claims!.teamId).toBe('team456');
      expect(claims!.deptId).toBe('dept789');
      expect(claims!.phone).toBe('555-1234');
    });

    it('should reject token without Bearer prefix', () => {
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      const claims = verifyToken(token); // Missing "Bearer " prefix

      expect(claims).toBeNull();
    });

    it('should reject undefined auth header', () => {
      const claims = verifyToken(undefined);
      expect(claims).toBeNull();
    });

    it('should reject malformed token', () => {
      const claims = verifyToken('Bearer invalid.token');
      expect(claims).toBeNull();
    });

    it('should reject expired token', () => {
      // Manually create an expired token
      const SECRET = 'test-secret';
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const now = Math.floor(Date.now() / 1000);
      const body = Buffer.from(JSON.stringify({
        empId: 'emp123',
        teamId: 'team456',
        deptId: 'dept789',
        phone: '555-1234',
        iat: now - 7200, // 2 hours ago
        exp: now - 3600, // 1 hour ago (expired)
      })).toString('base64url');

      const { createHmac } = require('crypto');
      const signature = createHmac('sha256', SECRET)
        .update(`${header}.${body}`)
        .digest('base64url');
      const expiredToken = `${header}.${body}.${signature}`;

      const claims = verifyToken(`Bearer ${expiredToken}`);
      expect(claims).toBeNull();
    });

    it('should reject token with invalid signature', () => {
      const token = issueToken('emp123', 'team456', 'dept789', '555-1234');
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1]}.invalidsignature`;

      const claims = verifyToken(`Bearer ${tamperedToken}`);
      expect(claims).toBeNull();
    });
  });
});
