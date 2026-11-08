export interface CanvasGuide {
    axis: 'horizontal' | 'vertical';
    position: number; // Percentage of the logical canvas height or width.
}

export interface CanvasLayout {
    width: number;
    height: number;
    fill: any;
    lockAspectRatio: boolean;
    ratioLabel: string;
    guidesVisible: boolean;
    guides: CanvasGuide[];
}

export interface CanvasPreset {
    id: string;
    name: string;
    layout: CanvasLayout;
}

/** Convert a point in viewport pixels back to a guide's logical percentage. */
export function canvasGuidePositionAtPoint(
    axis: CanvasGuide['axis'],
    point: { x: number; y: number },
    bounds: { left: number; top: number; width: number; height: number },
    viewport: number[],
): number | null {
    const [a, b, c, d, e, f] = viewport;
    const determinant = a * d - b * c;
    const size = axis === 'vertical' ? bounds.width : bounds.height;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 || size <= 0) return null;
    const x = point.x - e;
    const y = point.y - f;
    const coordinate = axis === 'vertical' ? (d * x - c * y) / determinant : (a * y - b * x) / determinant;
    const origin = axis === 'vertical' ? bounds.left : bounds.top;
    const position = (coordinate - origin) / size * 100;
    return Number.isFinite(position) ? position : null;
}

export const CANVAS_RATIOS = [
    { label: '3:4', ratio: 3 / 4 },
    { label: '2.35:1', ratio: 2.35 },
    { label: '4:3', ratio: 4 / 3 },
    { label: '9:16', ratio: 9 / 16 },
    { label: '16:9', ratio: 16 / 9 },
    { label: '16:10', ratio: 16 / 10 },
];

export function normalizeCanvasLayout(value: any = {}): CanvasLayout {
    const dimension = (input: unknown, fallback: number) =>
        Number.isFinite(Number(input)) && Number(input) > 0 ? Math.max(1, Math.round(Number(input))) : fallback;
    const width = dimension(value?.width, 800);
    const height = dimension(value?.height, 600);
    const ratio = CANVAS_RATIOS.find(r => r.label === value?.ratioLabel);
    return {
        width, height,
        fill: JSON.parse(JSON.stringify(value?.fill ?? '#ffffff')),
        lockAspectRatio: value?.lockAspectRatio === true,
        ratioLabel: ratio && (Math.round(width / ratio.ratio) === height || Math.round(height * ratio.ratio) === width)
            ? ratio.label : '',
        guidesVisible: value?.guidesVisible !== false,
        guides: Array.isArray(value?.guides) ? value.guides
            .filter((g: any) => g && ['horizontal', 'vertical'].includes(g.axis) &&
                Number.isFinite(g.position) && g.position >= 0 && g.position <= 100)
            .map((g: CanvasGuide) => ({ axis: g.axis, position: g.position })) : [],
    };
}

export function normalizeCanvasPresets(value: unknown): CanvasPreset[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter(p => {
        if (!p || typeof p.id !== 'string' || seen.has(p.id) || typeof p.name !== 'string' || !p.name.trim()) return false;
        seen.add(p.id);
        return true;
    }).map(p => ({ id: p.id, name: p.name.trim(), layout: normalizeCanvasLayout(p.layout) }));
}

/** Project guide coordinates through Fabric's viewport without adding exportable objects. */
export function projectCanvasGuides(layout: CanvasLayout, bounds: { left: number; top: number; width: number; height: number }, viewport: number[]) {
    if (!layout.guidesVisible) return [];
    const point = (x: number, y: number) => ({
        x: viewport[0] * x + viewport[2] * y + viewport[4],
        y: viewport[1] * x + viewport[3] * y + viewport[5],
    });
    return layout.guides.map(guide => {
        const vertical = guide.axis === 'vertical';
        const x = bounds.left + (vertical ? bounds.width * guide.position / 100 : 0);
        const y = bounds.top + (vertical ? 0 : bounds.height * guide.position / 100);
        return { start: point(x, y), end: point(vertical ? x : x + bounds.width, vertical ? y + bounds.height : y) };
    });
}
