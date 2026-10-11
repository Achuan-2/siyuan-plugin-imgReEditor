import { Shadow, Color } from 'fabric';
import type { FabricText } from 'fabric';

export interface TextStylePreset {
    id: string;
    fill: string;
    stroke: string;
    strokeRatio: number;
    shadow: boolean;
    background?: string;
    bold?: boolean;
}

export const TEXT_STYLE_PRESETS: readonly TextStylePreset[] = [
    { id: 'default', fill: '#000000', stroke: '#ffffff', strokeRatio: 0, shadow: false, bold: false },
    { id: 'yellowShadow', fill: '#ffe600', stroke: '#000000', strokeRatio: 0, shadow: true },
    { id: 'whiteShadow', fill: '#ffffff', stroke: '#000000', strokeRatio: 0, shadow: true },
    { id: 'whiteOutline', fill: '#ffffff', stroke: '#000000', strokeRatio: 0.08, shadow: false },
    { id: 'yellowOutline', fill: '#ffe600', stroke: '#000000', strokeRatio: 0.08, shadow: false },
    { id: 'redOutline', fill: '#ed2424', stroke: '#ffffff', strokeRatio: 0.08, shadow: false },
    { id: 'blackOrangeOutline', fill: '#111111', stroke: '#ff9c00', strokeRatio: 0.10, shadow: false },
    { id: 'cyanOutline', fill: '#00e5ef', stroke: '#111111', strokeRatio: 0.06, shadow: false },
    { id: 'orangeOutline', fill: '#ff8a00', stroke: '#111111', strokeRatio: 0.08, shadow: false },
    { id: 'greenOutline', fill: '#8cff00', stroke: '#111111', strokeRatio: 0.08, shadow: false },
    { id: 'blueOutline', fill: '#1976ff', stroke: '#ffffff', strokeRatio: 0.08, shadow: false },
    { id: 'pinkOutline', fill: '#ff3b88', stroke: '#ffffff', strokeRatio: 0.08, shadow: false },
    { id: 'whiteOnRed', fill: '#ffffff', stroke: '#ffffff', strokeRatio: 0, shadow: false, background: '#df2020' },
    { id: 'blackOnYellow', fill: '#111111', stroke: '#111111', strokeRatio: 0, shadow: false, background: '#ffe600' },
];

function finiteNumber(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

/** Keep title size, font family, alignment and geometry; size effects to the current font. */
export function getTextStylePresetOptions(preset: TextStylePreset, fontSize = 24) {
    const size = Math.max(1, finiteNumber(fontSize, 24));
    return {
        textStylePreset: preset.id,
        bold: preset.bold ?? true,
        italic: false,
        underline: false,
        fill: preset.fill,
        stroke: preset.stroke,
        strokeWidth: Math.min(20, Math.round(size * preset.strokeRatio * 2) / 2),
        textShadowEnabled: preset.shadow,
        textShadowColor: '#000000',
        textShadowBlur: Math.round(size * 0.08 * 2) / 2,
        textShadowOffsetX: Math.round(size * 0.04 * 2) / 2,
        textShadowOffsetY: Math.round(size * 0.06 * 2) / 2,
        textBackgroundEnabled: !!preset.background,
        textBackgroundFill: preset.background || '#ffffff',
        textBackgroundOpacity: 1,
        textBackgroundRadiusPercent: 0,
        textBackgroundPadding: Math.round(size * 0.15),
        textBackgroundStrokeEnabled: false,
        textBackgroundStroke: preset.background || '#ffffff',
    };
}

/** Unfilled templates keep a transparent preview background. */
export function getTextStylePresetPreview(preset: TextStylePreset) {
    return getTextTemplatePreview(getTextStylePresetOptions(preset, 20), 20);
}

export interface CustomTextTemplate {
    id: string;
    name: string;
    style: Record<string, string | number | boolean>;
}

const TEXT_TEMPLATE_STYLE_KEYS = [
    'family', 'bold', 'italic', 'underline', 'fill', 'stroke', 'strokeWidth',
    'textShadowEnabled', 'textShadowColor', 'textShadowBlur', 'textShadowOffsetX', 'textShadowOffsetY',
    'textBackgroundEnabled', 'textBackgroundFill', 'textBackgroundOpacity',
    'textBackgroundRadiusPercent', 'textBackgroundPadding', 'textBackgroundStrokeEnabled', 'textBackgroundStroke',
] as const;

/** Save style only: content, position, size and alignment belong to the text object. */
export function captureTextTemplateStyle(options: Record<string, unknown>) {
    const defaults = getTextStylePresetOptions(TEXT_STYLE_PRESETS[0]);
    const style: CustomTextTemplate['style'] = {};
    for (const key of TEXT_TEMPLATE_STYLE_KEYS) {
        const fallback = defaults[key];
        let value = options[key] ?? (key === 'family' ? options.fontFamily : fallback);
        if (fallback !== undefined && (typeof value !== typeof fallback ||
            (typeof value === 'number' && !Number.isFinite(value)))) value = fallback;
        if (typeof value === 'string' || typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value))) style[key] = value;
    }
    style.strokeWidth = Math.max(0, Math.min(20, Number(style.strokeWidth)));
    style.textBackgroundRadiusPercent = normalizePercent(style.textBackgroundRadiusPercent);
    style.textBackgroundOpacity = Math.max(0, Math.min(1, Number(style.textBackgroundOpacity)));
    style.textBackgroundPadding = Math.max(0, Math.min(120, Number(style.textBackgroundPadding)));
    Object.assign(style, normalizeTextShadowOptions(style));
    return style;
}

export function normalizeCustomTextTemplates(value: unknown): CustomTextTemplate[] {
    if (!Array.isArray(value)) return [];
    const ids = new Set<string>();
    return value.flatMap(template => {
        if (!template || typeof template.id !== 'string' || !template.id.startsWith('custom-') ||
            ids.has(template.id) || typeof template.name !== 'string' || !template.name.trim() ||
            !template.style || typeof template.style !== 'object' || Array.isArray(template.style)) return [];
        ids.add(template.id);
        return [{ id: template.id, name: template.name.trim().slice(0, 60), style: captureTextTemplateStyle(template.style) }];
    });
}

export function textTemplateMatches(options: Record<string, unknown>, template: Record<string, unknown>) {
    const current = captureTextTemplateStyle(options);
    const expected = captureTextTemplateStyle(template);
    return TEXT_TEMPLATE_STYLE_KEYS.every(key => {
        if (key === 'family' && expected.family === undefined) return true;
        if ((key === 'stroke' && !expected.strokeWidth) ||
            (key.startsWith('textShadow') && key !== 'textShadowEnabled' && !expected.textShadowEnabled) ||
            (key.startsWith('textBackground') && key !== 'textBackgroundEnabled' && !expected.textBackgroundEnabled) ||
            (key === 'textBackgroundStroke' && !expected.textBackgroundStrokeEnabled)) return true;
        return typeof expected[key] === 'number' && typeof current[key] === 'number'
            ? Math.abs(Number(expected[key]) - Number(current[key])) < 0.01
            : expected[key] === current[key];
    });
}

/** Custom and built-in options share the same preview rendering. */
export function getTextTemplatePreview(options: Record<string, unknown>, fontSize = 24) {
    const style = captureTextTemplateStyle(options);
    const scale = 20 / Math.max(1, finiteNumber(fontSize, 24));
    const shadow = normalizeTextShadowOptions(style);
    const padding = style.textBackgroundEnabled ? Math.max(0, Number(style.textBackgroundPadding) * scale) : 0;
    const radius = (30 + padding * 2) / 2 * normalizePercent(style.textBackgroundRadiusPercent) / 100;
    const background = style.textBackgroundEnabled
        ? new Color(String(style.textBackgroundFill)).setAlpha(Number(style.textBackgroundOpacity)).toRgba()
        : 'transparent';
    return `color:${style.fill};background:${background};` +
        `font-weight:${style.bold ? 'bold' : 'normal'};font-style:${style.italic ? 'italic' : 'normal'};` +
        `text-decoration:${style.underline ? 'underline' : 'none'};` +
        (style.family ? `font-family:${JSON.stringify(style.family)},sans-serif;` : '') +
        `padding:${padding}px;border-radius:${radius}px;` +
        `border:${style.textBackgroundEnabled && style.textBackgroundStrokeEnabled ? `1px solid ${style.textBackgroundStroke}` : 'none'};` +
        `-webkit-text-stroke:${Number(style.strokeWidth) * scale}px ${style.stroke};paint-order:stroke fill;` +
        `text-shadow:${shadow.textShadowEnabled ? `${shadow.textShadowOffsetX * scale}px ${shadow.textShadowOffsetY * scale}px ${shadow.textShadowBlur * scale}px ${shadow.textShadowColor}` : 'none'};`;
}

function normalizePercent(value: unknown) {
    return Math.max(0, Math.min(100, finiteNumber(value, 0)));
}

const TEXT_SHADOW_KEYS = [
    'textShadowEnabled', 'textShadowColor', 'textShadowBlur',
    'textShadowOffsetX', 'textShadowOffsetY',
];

export function hasTextShadowOption(options: Record<string, unknown>) {
    return TEXT_SHADOW_KEYS.some(key => typeof options[key] !== 'undefined');
}

/** Fabric's native shadow already persists through project saves and undo/redo. */
export function getTextShadowOptions(text: Pick<FabricText, 'shadow'>) {
    const editable = text as any;
    if (editable.isEditing && editable.selectionEnd > editable.selectionStart) {
        const style = editable.getSelectionStyles?.(editable.selectionStart, editable.selectionStart + 1)[0];
        if (style?._textShadow) return normalizeTextShadowOptions(style._textShadow);
    }
    return normalizeTextShadowOptions({
        textShadowEnabled: !!text.shadow,
        textShadowColor: text.shadow?.color,
        textShadowBlur: text.shadow?.blur,
        textShadowOffsetX: text.shadow?.offsetX,
        textShadowOffsetY: text.shadow?.offsetY,
    });
}

export function normalizeTextShadowOptions(options: Record<string, unknown> = {}) {
    return {
        textShadowEnabled: !!options.textShadowEnabled,
        textShadowColor: typeof options.textShadowColor === 'string' && options.textShadowColor
            ? options.textShadowColor : '#000000',
        textShadowBlur: Math.max(0, finiteNumber(options.textShadowBlur, 2)),
        textShadowOffsetX: finiteNumber(options.textShadowOffsetX, 1),
        textShadowOffsetY: finiteNumber(options.textShadowOffsetY, 2),
    };
}

export function applyTextShadow(text: FabricText, options: Record<string, unknown>) {
    const normalized = normalizeTextShadowOptions(options);
    text.set('shadow', normalized.textShadowEnabled ? new Shadow({
        color: normalized.textShadowColor,
        blur: normalized.textShadowBlur,
        offsetX: normalized.textShadowOffsetX,
        offsetY: normalized.textShadowOffsetY,
        affectStroke: true,
    }) : null);
}
