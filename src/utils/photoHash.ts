import crypto from 'crypto';

/**
 * Generate SHA-256 hash from base64 image data
 * @param base64Data - Base64 encoded image string
 * @returns SHA-256 hash string
 */
export function generatePhotoHash(base64Data: string): string {
    // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');

    return crypto
        .createHash('sha256')
        .update(base64Clean)
        .digest('hex');
}

/**
 * Validate base64 image data
 * @param base64Data - Base64 encoded image string
 * @returns boolean indicating validity
 */
export function isValidBase64Image(base64Data: string): boolean {
    try {
        // Check if it's a data URL
        if (base64Data.startsWith('data:image/')) {
            const matches = base64Data.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!matches) return false;

            const base64 = matches[2];
            // Try to decode to verify it's valid base64
            Buffer.from(base64, 'base64');
            return true;
        }

        // If not a data URL, try to decode directly
        Buffer.from(base64Data, 'base64');
        return true;
    } catch {
        return false;
    }
}
