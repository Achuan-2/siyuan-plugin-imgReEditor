import { Shadow, Color, util } from 'fabric';
import { getTextShadowOptions, normalizeTextShadowOptions, textStrokeWidthToStrength } from './textStylePresets';
import { installTextInteractionSerializer } from './textInteractionState';

const INLINE_SHADOW = '_textShadow';

export function hasTextRange(text: any): boolean {
    return !!text.isEditing && Number(text.selectionEnd) > Number(text.selectionStart);
}

export function setRangeTextShadow(text: any, options: Record<string, unknown>) {
    text.setSelectionStyles({ [INLINE_SHADOW]: normalizeTextShadowOptions(options) });
}

export function clearRangeTextShadows(text: any) {
    text.removeStyle(INLINE_SHADOW);
}

export function getTextSelectionOptions(text: any) {
    if (!hasTextRange(text)) return {};
    const style = text.getSelectionStyles(text.selectionStart, text.selectionStart + 1, true)[0];
    if (!style) return {};
    const characterStyle = text.getSelectionStyles(text.selectionStart, text.selectionStart + 1)[0];
    const background = style.textBackgroundColor ? new Color(style.textBackgroundColor) : null;
    return {
        family: style.fontFamily, size: style.fontSize, fill: style.fill,
        stroke: style.stroke, textStrokeStrength: textStrokeWidthToStrength(style.strokeWidth, style.fontSize),
        bold: style.fontWeight === 'bold' || Number(style.fontWeight) >= 600,
        italic: style.fontStyle === 'italic', underline: !!style.underline,
        ...getTextShadowOptions(text),
        ...(Object.prototype.hasOwnProperty.call(characterStyle || {}, 'textBackgroundColor') ? {
            textBackgroundEnabled: !!background,
            textBackgroundFill: background?.toRgb() || '#ffffff',
            textBackgroundOpacity: background?.getAlpha() ?? 1,
            textBackgroundRadiusPercent: 0,
        } : {}),
    };
}

function shadowForStyle(text: any, style: any): Shadow | null {
    if (!style?.[INLINE_SHADOW]) return text.shadow;
    const options = normalizeTextShadowOptions(style[INLINE_SHADOW]);
    return options.textShadowEnabled ? new Shadow({
        color: options.textShadowColor, blur: options.textShadowBlur,
        offsetX: options.textShadowOffsetX, offsetY: options.textShadowOffsetY, affectStroke: true,
    }) : null;
}

function applyGlyphShadow(text: any, ctx: CanvasRenderingContext2D, shadow: Shadow | null) {
    const original = text.shadow;
    try {
        text.shadow = shadow;
        if (shadow) text._setShadow(ctx);
        else {
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
        }
    } finally { text.shadow = original; }
}

/** Keep native editing/layout, adding independent shadows to character styles.
 * Fabric clears shadows when painting character backgrounds, even empty pasted
 * backgrounds. Restore the glyph shadow after native fill/stroke setup.
 */
export function installTextRangeRenderer(text: any) {
    if (text?.getObjects) {
        text.getObjects().forEach(installTextRangeRenderer);
        return;
    }
    if (!text || !['text', 'textbox', 'i-text'].includes(text.type)) return;
    installTextInteractionSerializer(text);
    if (text.__imgReEditorRangeRenderer) return;
    text.__imgReEditorRangeRenderer = true;
    const renderChar = text._renderChar;
    for (const method of ['_setFillStyles', '_setStrokeStyles']) {
        const original = text[method];
        text[method] = function (ctx: CanvasRenderingContext2D, ...args: any[]) {
            const result = original.call(this, ctx, ...args);
            applyGlyphShadow(this, ctx, this.__imgReEditorGlyphShadow === undefined
                ? this.shadow : this.__imgReEditorGlyphShadow);
            return result;
        };
    }
    text._renderChar = function (method: string, ctx: CanvasRenderingContext2D, line: number,
        lastChar: number, value: string, left: number, top: number) {
        const graphemes = util.string.graphemeSplit(value);
        const firstChar = lastChar - graphemes.length + 1;
        const styles = graphemes.map((_, index) => this._getStyleDeclaration(line, firstChar + index));
        if (!styles.some(style => style[INLINE_SHADOW])) {
            return renderChar.call(this, method, ctx, line, lastChar, value, left, top);
        }
        // Fabric batches runs by font/fill/stroke, ignoring custom shadow fields.
        // Split them while retaining measured advances, kerning and RTL direction.
        const bounds = this.__charBounds[line];
        const sign = this.direction === 'rtl' ? -1 : 1;
        const first = bounds[firstChar];
        let advance = -(first.kernedWidth - first.width);
        const previousShadow = this.__imgReEditorGlyphShadow;
        try {
            graphemes.forEach((character, index) => {
                const charIndex = firstChar + index;
                const box = bounds[charIndex];
                this.__imgReEditorGlyphShadow = shadowForStyle(this, styles[index]);
                renderChar.call(this, method, ctx, line, charIndex, character,
                    left + sign * (advance + box.kernedWidth - box.width), top);
                advance += box.kernedWidth;
            });
        } finally { this.__imgReEditorGlyphShadow = previousShadow; }
    };

    // stylesToArray merges by a fixed property list that excludes shadows. Raw
    // style dictionaries are also accepted by Fabric.fromObject; preserve them
    // when custom shadows exist so equal-font runs keep different effects.
    const toObject = text.toObject;
    text.toObject = function (...args: any[]) {
        const styles = this.styles;
        const hasInlineShadow = Object.values(styles || {}).some((row: any) =>
            Object.values(row).some((style: any) => style[INLINE_SHADOW]));
        if (!hasInlineShadow) return toObject.apply(this, args);
        const nativeStyles: any = {};
        for (const [rowIndex, row] of Object.entries(styles) as [string, any][]) {
            for (const [charIndex, style] of Object.entries(row) as [string, any][]) {
                const { [INLINE_SHADOW]: _shadow, ...native } = style;
                if (Object.keys(native).length) (nativeStyles[rowIndex] ||= {})[charIndex] = native;
            }
        }
        try {
            this.styles = nativeStyles;
            const result = toObject.apply(this, args);
            result.styles = JSON.parse(JSON.stringify(styles));
            return result;
        } finally { this.styles = styles; }
    };
}
