import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './auth.ts';

export const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
export const PRODUCT_IMAGE_URL_PREFIX = '/api/uploads/products/';

const SAFE_FILENAME_RE = /^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/;

const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const EXT_TO_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function getProductUploadsDir(): string {
  return path.resolve(process.cwd(), 'data', 'uploads', 'products');
}

function detectImageFormatFromBytes(buf: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'jpg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export function validateAndSaveProductImage(input: {
  mimeType: string;
  dataBase64: string;
  uploadsDir?: string;
}): { imageUrl: string; filename: string; byteLength: number } {
  const mime = (input.mimeType || '').trim().toLowerCase();
  const expectedExt = ALLOWED_MIME_TO_EXT[mime];
  if (!expectedExt) {
    throw new HttpError(
      400,
      'Unsupported image format. Allowed formats: JPG, JPEG, PNG, and WEBP.'
    );
  }

  const rawBase64 = (input.dataBase64 || '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!rawBase64) {
    throw new HttpError(400, 'Image file data is required.');
  }

  const buffer = Buffer.from(rawBase64, 'base64');
  if (buffer.length === 0) {
    throw new HttpError(400, 'Uploaded image file is empty.');
  }
  if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) {
    throw new HttpError(
      400,
      `Image file exceeds maximum allowed size of ${MAX_PRODUCT_IMAGE_BYTES / (1024 * 1024)} MB.`
    );
  }

  const detected = detectImageFormatFromBytes(buffer);
  if (!detected || detected !== expectedExt) {
    throw new HttpError(
      400,
      'Invalid or corrupted image file. File contents must match JPG, JPEG, PNG, or WEBP.'
    );
  }

  const dir = input.uploadsDir ?? getProductUploadsDir();
  fs.mkdirSync(dir, { recursive: true });

  const filename = `prod-${crypto.randomUUID()}.${detected}`;
  const fullPath = path.join(dir, filename);
  fs.writeFileSync(fullPath, buffer);

  return {
    imageUrl: `${PRODUCT_IMAGE_URL_PREFIX}${filename}`,
    filename,
    byteLength: buffer.length,
  };
}

export function normalizeProductImageUrl(imageUrl?: string | null): string {
  const trimmed = (imageUrl ?? '').trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith(PRODUCT_IMAGE_URL_PREFIX)) {
    throw new HttpError(400, 'Invalid product image reference.');
  }
  const filename = trimmed.slice(PRODUCT_IMAGE_URL_PREFIX.length);
  if (!SAFE_FILENAME_RE.test(filename)) {
    throw new HttpError(400, 'Invalid product image filename.');
  }
  return `${PRODUCT_IMAGE_URL_PREFIX}${filename}`;
}

export function readStoredProductImage(
  filename: string,
  uploadsDir?: string
): { buffer: Buffer; contentType: string } {
  const cleanName = path.basename(filename);
  if (cleanName !== filename || !SAFE_FILENAME_RE.test(cleanName)) {
    throw new HttpError(400, 'Invalid image filename.');
  }

  const dir = path.resolve(uploadsDir ?? getProductUploadsDir());
  const resolved = path.resolve(dir, cleanName);
  if (!resolved.startsWith(dir + path.sep)) {
    throw new HttpError(403, 'Forbidden image path.');
  }
  if (!fs.existsSync(resolved)) {
    throw new HttpError(404, 'Product image not found.');
  }

  const ext = path.extname(cleanName).slice(1).toLowerCase();
  const contentType = EXT_TO_CONTENT_TYPE[ext] ?? 'application/octet-stream';
  return {
    buffer: fs.readFileSync(resolved),
    contentType,
  };
}

export function cleanupUnreferencedUploadedImage(
  db: DatabaseSync,
  oldImageUrl: string,
  uploadsDir?: string
): void {
  if (!oldImageUrl || !oldImageUrl.startsWith(PRODUCT_IMAGE_URL_PREFIX)) return;
  const filename = oldImageUrl.slice(PRODUCT_IMAGE_URL_PREFIX.length);
  // Only delete user-uploaded UUID files (prod-*), keeping seeded assets intact
  if (!filename.startsWith('prod-') || !SAFE_FILENAME_RE.test(filename)) return;

  const refCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM inventory_items WHERE image_url = ?`)
    .get(oldImageUrl) as { cnt: number };
  if (refCount.cnt > 0) return;

  const dir = path.resolve(uploadsDir ?? getProductUploadsDir());
  const target = path.resolve(dir, filename);
  if (target.startsWith(dir + path.sep) && fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

