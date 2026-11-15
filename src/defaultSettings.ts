

export type ImageCompressionFormat = 'png' | 'jpeg' | 'webp' | 'original';

/** Resolve the new format preference before falling back to the legacy WebP switch. */
export function getCompressionFormat(settings: any): ImageCompressionFormat {
    const format = settings?.compressionFormat;
    if (['png', 'jpeg', 'webp', 'original'].includes(format)) return format;
    if (typeof settings?.convertToWebP === 'boolean') {
        return settings.convertToWebP ? 'webp' : 'original';
    }
    return 'webp';
}

export const getDefaultSettings = () => ({
    storageMode: 'embed', // 'embed' or 'backup'
    // Recent colors storage, keyed by color picker identifier
    recentColors: {} as Record<string, string[]>,
    // Last used tool settings, keyed by tool name
    enableImageCompression: true,
    saveCompressionSpeed: 'fast' as 'fast' | 'balanced',
    pngCompressionMode: 'lossless' as 'lossless' | 'lossy',
    pngQuality: 92,
    jpegQuality: 92,
    compressionFormat: 'webp' as ImageCompressionFormat,
    webpQuality: 100,
    imageCompressionQuality: 92,
    enablePasteImageCompression: false,
    limitImageLongEdge: false,
    imageMaxLongEdge: 2000,
    showPasteImageCompressionNotification: true,
    enableScreenshot: false,
    screenshotLimit: 200,
    screenshotSelectionHistory: [] as Array<{ x: number, y: number, width: number, height: number, ts: number }>,
    screenshotCaptureHistory: [] as Array<{
        id: string,
        imagePath: string,
        name: string,
        rect: { x: number, y: number, width: number, height: number },
        normalizedRect: { x: number, y: number, width: number, height: number },
        ts: number,
    }>,
});
