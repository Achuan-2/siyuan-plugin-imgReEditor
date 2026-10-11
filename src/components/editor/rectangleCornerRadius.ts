import type { Rect } from 'fabric';

type RoundedRectangle = Rect & { _rectCornerRadiusPercent?: number };

export function normalizeRectangleCornerRadiusPercent(value: unknown): number {
    const percent = Number(value);
    return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

export function getRectangleCornerRadiusPercent(rect: RoundedRectangle): number {
    if (typeof rect._rectCornerRadiusPercent === 'number') {
        return normalizeRectangleCornerRadiusPercent(rect._rectCornerRadiusPercent);
    }
    // Legacy rectangles store only pixel radii. Derive the percentage from their size.
    const scaleX = Math.abs(rect.scaleX) || 1;
    const scaleY = Math.abs(rect.scaleY) || 1;
    const maxRadius = Math.min(rect.width * scaleX, rect.height * scaleY) / 2;
    const radius = Math.min(rect.rx * scaleX, rect.ry * scaleY);
    return maxRadius > 0 ? normalizeRectangleCornerRadiusPercent(radius / maxRadius * 100) : 0;
}

export function applyRectangleCornerRadius(
    rect: RoundedRectangle,
    percent: unknown = getRectangleCornerRadiusPercent(rect)
): void {
    const normalizedPercent = normalizeRectangleCornerRadiusPercent(percent);
    const scaleX = Math.abs(rect.scaleX) || 1;
    const scaleY = Math.abs(rect.scaleY) || 1;
    const maxRadius = Math.max(0, Math.min(rect.width * scaleX, rect.height * scaleY)) / 2;
    const radius = maxRadius * normalizedPercent / 100;
    // Compensate for independent X/Y scaling so corners remain circular on screen.
    rect.set({ rx: radius / scaleX, ry: radius / scaleY });
    rect._rectCornerRadiusPercent = normalizedPercent;
}
