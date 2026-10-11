interface TextBackgroundGeometry {
    width?: number;
    height?: number;
    textBackgroundPadding?: number;
    textBackgroundRadius?: number;
    textBackgroundRadiusPercent?: number;
}

export const DEFAULT_TEXT_BACKGROUND_RADIUS_PERCENT = 20;

export function normalizeTextBackgroundRadiusPercent(value: unknown) {
    const percent = Number(value);
    return Number.isFinite(percent)
        ? Math.max(0, Math.min(100, percent))
        : DEFAULT_TEXT_BACKGROUND_RADIUS_PERCENT;
}

function getMaximumRadius(options: TextBackgroundGeometry) {
    const padding = Number(options.textBackgroundPadding ?? 6);
    const safePadding = Number.isFinite(padding) ? Math.max(0, Math.min(120, padding)) : 6;
    const width = Number(options.width);
    const height = Number(options.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 0;
    }
    return Math.min(width + safePadding * 2, height + safePadding * 2) / 2;
}

/** Legacy pixel values are converted using the actual background size, without changing appearance. */
export function getTextBackgroundRadiusPercent(options: TextBackgroundGeometry): number | undefined {
    if (options.textBackgroundRadiusPercent !== undefined) {
        return normalizeTextBackgroundRadiusPercent(options.textBackgroundRadiusPercent);
    }
    if (options.textBackgroundRadius !== undefined) {
        const maximum = getMaximumRadius(options);
        // Saved tool defaults have no geometry. Keep their pixel value until a text object exists.
        if (maximum === 0) return undefined;
        return normalizeTextBackgroundRadiusPercent(Number(options.textBackgroundRadius) / maximum * 100);
    }
    return DEFAULT_TEXT_BACKGROUND_RADIUS_PERCENT;
}

export function getTextBackgroundPixelRadius(options: TextBackgroundGeometry) {
    const maximum = getMaximumRadius(options);
    const percent = getTextBackgroundRadiusPercent(options);
    return maximum * (percent ?? 0) / 100;
}
