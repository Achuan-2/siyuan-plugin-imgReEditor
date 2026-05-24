import { Rect, classRegistry, Canvas } from 'fabric';

/**
 * MosaicRect - A custom rectangle that applies a mosaic/pixelation effect
 * to the area it covers
 */
export class MosaicRect extends Rect {
    blockSize: number = 15;
    static type = 'mosaic-rect';
    constructor(options?: any) {
        if (options) {
            const { type, ...otherOptions } = options;
            super(otherOptions);
        } else {
            super(options);
        }
        this.blockSize = options?.blockSize || 15;
        this.fill = 'transparent'; // We'll use a pattern instead
        this.stroke = options?.stroke || 'transparent';
        this.strokeWidth = options?.strokeWidth || 0;
        this.strokeDashArray = null;
        this.objectCaching = false; // Disable caching to update effect on move
    }

    _render(ctx: CanvasRenderingContext2D): void {
        const w = this.width || 0;
        const h = this.height || 0;

        const fabricCanvas = this.canvas as Canvas;
        if (!fabricCanvas) {
            this._drawGrayMosaic(ctx, w, h);
        } else {
            this._drawMosaicEffect(ctx, w, h, fabricCanvas);
        }

        if (this.stroke && this.strokeWidth) {
            ctx.save();
            ctx.strokeStyle = this.stroke as string;
            ctx.lineWidth = this.strokeWidth;
            if (this.strokeDashArray && this.strokeDashArray.length > 0) {
                ctx.setLineDash(this.strokeDashArray);
            }
            ctx.strokeRect(-w / 2, -h / 2, w, h);
            ctx.restore();
        }
    }

    /**
     * Draw gray mosaic blocks when no background is available
     */
    private _drawGrayMosaic(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        const blockSize = this.blockSize;
        ctx.fillStyle = '#cccccc';

        for (let x = -width / 2; x < width / 2; x += blockSize) {
            for (let y = -height / 2; y < height / 2; y += blockSize) {
                const blockW = Math.min(blockSize, width / 2 - x);
                const blockH = Math.min(blockSize, height / 2 - y);
                ctx.fillRect(x, y, blockW, blockH);

                // Draw a subtle border
                ctx.strokeStyle = '#999999';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x, y, blockW, blockH);
            }
        }
    }

    private _drawMosaicEffect(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        fabricCanvas: Canvas
    ): void {
        const blockSize = Math.max(1, Math.round(this.blockSize || 15));
        if (width <= 0 || height <= 0) return;

        const sourceBounds = this.getBoundingRect();
        const sourceWidth = Math.max(1, Math.ceil(sourceBounds.width));
        const sourceHeight = Math.max(1, Math.ceil(sourceBounds.height));

        if (sourceWidth <= 0 || sourceHeight <= 0) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        const sceneCanvas = document.createElement('canvas');
        sceneCanvas.width = sourceWidth;
        sceneCanvas.height = sourceHeight;
        const sceneCtx = sceneCanvas.getContext('2d');
        if (!sceneCtx) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        sceneCtx.save();
        sceneCtx.clearRect(0, 0, sourceWidth, sourceHeight);

        const backgroundColor = (fabricCanvas as any).backgroundColor;
        if (
            typeof backgroundColor === 'string' &&
            backgroundColor &&
            backgroundColor !== 'transparent'
        ) {
            sceneCtx.fillStyle = backgroundColor;
            sceneCtx.fillRect(0, 0, sourceWidth, sourceHeight);
        }

        sceneCtx.translate(-sourceBounds.left, -sourceBounds.top);

        const bgImage = fabricCanvas.backgroundImage as any;
        if (bgImage && bgImage.visible !== false) {
            bgImage.render(sceneCtx);
        }

        const objects = fabricCanvas.getObjects();
        const selfIndex = objects.indexOf(this);
        const renderLimit = selfIndex === -1 ? objects.length : selfIndex;
        let renderedObjectCount = bgImage && bgImage.visible !== false ? 1 : 0;

        for (let index = 0; index < renderLimit; index++) {
            const obj = objects[index] as any;
            if (!obj || obj === this || obj.visible === false) continue;
            if (this._shouldSkipSourceObject(obj)) continue;

            obj.render(sceneCtx);
            renderedObjectCount++;
        }

        sceneCtx.restore();

        if (renderedObjectCount === 0) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        const pixelWidth = Math.max(1, Math.ceil(width / blockSize));
        const pixelHeight = Math.max(1, Math.ceil(height / blockSize));
        const pixelCanvas = document.createElement('canvas');
        pixelCanvas.width = pixelWidth;
        pixelCanvas.height = pixelHeight;
        const pixelCtx = pixelCanvas.getContext('2d');

        if (!pixelCtx) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        pixelCtx.imageSmoothingEnabled = true;
        pixelCtx.drawImage(sceneCanvas, 0, 0, pixelWidth, pixelHeight);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(pixelCanvas, -width / 2, -height / 2, width, height);
        ctx.restore();
    }

    private _shouldSkipSourceObject(obj: any): boolean {
        return (
            obj._isCropRect ||
            obj.type === 'crop-rect' ||
            obj.type === 'select-canvas-size-rect' ||
            obj.type === 'magnifier-source-rect' ||
            obj.type === 'magnifier-connection-line'
        );
    }

    /**
     * Override toObject to include custom properties
     */
    toObject(propertiesToInclude?: any): any {
        return super.toObject(['blockSize', ...(propertiesToInclude || [])] as any);
    }

    /**
     * Static method for creating from object (for deserialization)
     */
    static fromObject(object: any): Promise<MosaicRect> {
        return Promise.resolve(new MosaicRect(object));
    }
}

// Register the class
classRegistry.setClass(MosaicRect, 'mosaic-rect');

export default MosaicRect;
