import { Rect } from 'fabric';
import type { FabricImage } from 'fabric';

type RoundedImage = FabricImage & {
    _cornerRadius?: number;
    _imageCornerRadiusPercent?: number;
};

export function normalizeCornerRadiusPercent(value: unknown): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function maximumRadius(width: number, height: number) {
    return Number.isFinite(width) && Number.isFinite(height)
        ? Math.max(0, Math.min(width, height)) / 2 : 0;
}

export function cornerRadiusPercentToPixels(percent: unknown, width: number, height: number) {
    return maximumRadius(width, height) * normalizeCornerRadiusPercent(percent) / 100;
}

export function cornerRadiusPixelsToPercent(pixels: unknown, width: number, height: number) {
    const maximum = maximumRadius(width, height);
    return maximum > 0 ? normalizeCornerRadiusPercent(Number(pixels) / maximum * 100) : 0;
}

export function getImageCornerRadiusPercent(image: RoundedImage) {
    return image._imageCornerRadiusPercent !== undefined
        ? normalizeCornerRadiusPercent(image._imageCornerRadiusPercent)
        : cornerRadiusPixelsToPercent(image._cornerRadius ?? 0, image.getScaledWidth(), image.getScaledHeight());
}

/** Store percentages and compensate independent axis scaling so visible corners remain circular. */
export function applyImageCornerRadius(image: RoundedImage, percent?: unknown) {
    if (!image || image.type !== 'image') return;
    const normalized = normalizeCornerRadiusPercent(percent === undefined ? getImageCornerRadiusPercent(image) : percent);
    const radius = cornerRadiusPercentToPixels(normalized, image.getScaledWidth(), image.getScaledHeight());
    image._imageCornerRadiusPercent = normalized;
    image._cornerRadius = radius;
    if (radius === 0) {
        image.set('clipPath', null);
    } else {
        const scaleX = Math.abs(image.scaleX || 1);
        const scaleY = Math.abs(image.scaleY || 1);
        image.set('clipPath', new Rect({
            width: image.width,
            height: image.height,
            rx: radius / scaleX,
            ry: radius / scaleY,
            originX: 'center', originY: 'center', left: 0, top: 0,
        }));
    }
    image.dirty = true;
}

/** Baked border dimensions include the margin; legacy radii use those original pixel dimensions. */
export function getImageBorderSourceSize(background: any) {
    const original = background?._unborderedImage || background?._mainImage;
    if (original?.getBoundingRect) {
        const bounds = original.getBoundingRect();
        return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    }
    if (background?._appliedMargin === undefined && background?.getBoundingRect) {
        const bounds = background.getBoundingRect();
        return { width: Math.round(bounds.width), height: Math.round(bounds.height) };
    }
    const margin = Number(background?._appliedMargin) || 0;
    return {
        width: Math.max(0, Number(background?.width || 0) - margin * 2),
        height: Math.max(0, Number(background?.height || 0) - margin * 2),
    };
}

export function getImageBorderRadiusOptions(options: any, width: number, height: number) {
    const margin = Math.max(0, Number(options.margin ?? 40) || 0);
    return {
        radiusPercent: options.radiusPercent !== undefined
            ? normalizeCornerRadiusPercent(options.radiusPercent)
            : cornerRadiusPixelsToPercent(options.radius ?? 12, width, height),
        outerRadiusPercent: options.outerRadiusPercent !== undefined
            ? normalizeCornerRadiusPercent(options.outerRadiusPercent)
            : cornerRadiusPixelsToPercent(options.outerRadius ?? 0, width + margin * 2, height + margin * 2),
    };
}
