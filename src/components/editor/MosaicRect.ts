import { Rect, classRegistry, Canvas, util } from 'fabric';

/**
 * MosaicRect - A custom rectangle that applies a mosaic/pixelation effect
 * to the area it covers
 */
export class MosaicRect extends Rect {
    blockSize: number = 15;
    static type = 'mosaic-rect';
    constructor(options?: any) {
        super(options);
        this.blockSize = options?.blockSize || 15;
        this.fill = 'transparent'; // We'll use a pattern instead
        this.stroke = options?.stroke || 'transparent';
        this.strokeWidth = options?.strokeWidth || 0;
        this.strokeDashArray = null;
        this.objectCaching = false; // Disable caching to update effect on move
    }

    /**
     * Override _render to draw the mosaic effect
     */
    _render(ctx: CanvasRenderingContext2D): void {
        const w = this.width || 0;
        const h = this.height || 0;

        // Draw the stroke first
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

        // Get the canvas to sample from
        const fabricCanvas = this.canvas as Canvas;
        if (!fabricCanvas || !fabricCanvas.backgroundImage) {
            // If no background, draw gray blocks
            this._drawGrayMosaic(ctx, w, h);
            return;
        }

        // Draw mosaic effect
        this._drawMosaicEffect(ctx, w, h, fabricCanvas);
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

    /**
     * Draw mosaic effect by sampling from background image
     */
    private _drawMosaicEffect(ctx: CanvasRenderingContext2D, width: number, height: number, fabricCanvas: Canvas): void {
        const bgImage = fabricCanvas.backgroundImage as any;
        if (!bgImage) return;

        const blockSize = this.blockSize;

        // Create a temporary canvas to sample from
        const tempCanvas = document.createElement('canvas');
        const bgElement = bgImage.getElement();
        if (!bgElement) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        // Get bounding rect to determine temp canvas size
        const boundingRect = bgImage.getBoundingRect();
        tempCanvas.width = Math.ceil(boundingRect.width);
        tempCanvas.height = Math.ceil(boundingRect.height);
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
            this._drawGrayMosaic(ctx, width, height);
            return;
        }

        // Draw the background image to temp canvas with transformations
        tempCtx.save();
        // Clear temp canvas first
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

        // Translate to align bounding rect to 0,0
        tempCtx.translate(-boundingRect.left, -boundingRect.top);

        // Apply background image transformations in correct order: translate -> rotate -> scale -> flip -> origin
        tempCtx.translate(bgImage.left || 0, bgImage.top || 0);
        tempCtx.rotate((bgImage.angle || 0) * Math.PI / 180);
        tempCtx.scale(bgImage.scaleX || 1, bgImage.scaleY || 1);
        if (bgImage.flipX) {
            tempCtx.scale(-1, 1);
            tempCtx.translate(-bgImage.width, 0);
        }
        if (bgImage.flipY) {
            tempCtx.scale(1, -1);
            tempCtx.translate(0, -bgImage.height);
        }
        // Handle origin (assuming background image default origin is top-left, but if center we need adjustment)
        if (bgImage.originX === 'center') tempCtx.translate(-bgImage.width / 2, 0);
        if (bgImage.originY === 'center') tempCtx.translate(0, -bgImage.height / 2);

        tempCtx.drawImage(bgElement, 0, 0);
        tempCtx.restore();

        // Get transform matrix to convert local object coordinates to global canvas coordinates
        const matrix = this.calcTransformMatrix();

        // Draw mosaic blocks
        for (let x = -width / 2; x < width / 2; x += blockSize) {
            for (let y = -height / 2; y < height / 2; y += blockSize) {
                const blockW = Math.min(blockSize, width / 2 - x);
                const blockH = Math.min(blockSize, height / 2 - y);

                // Calculate the center of this block in local coordinates
                const localX = x + blockW / 2;
                const localY = y + blockH / 2;

                // Convert local coordinates to global canvas coordinates
                const point = util.transformPoint({ x: localX, y: localY } as any, matrix);
                const canvasX = point.x;
                const canvasY = point.y;

                // Adjust for bounding rect offset
                const tempX = Math.floor(canvasX - boundingRect.left);
                const tempY = Math.floor(canvasY - boundingRect.top);

                // Check if we are within the temp canvas bounds to avoid unnecessary getImageData calls
                if (tempX < 0 || tempX >= tempCanvas.width || tempY < 0 || tempY >= tempCanvas.height) {
                    continue;
                }

                try {
                    // Sample the color from the center of the block
                    const imageData = tempCtx.getImageData(tempX, tempY, 1, 1);
                    const pixel = imageData.data;

                    // If the pixel is fully transparent, skip drawing this block
                    if (pixel[3] === 0) {
                        continue;
                    }

                    const color = `rgba(${pixel[0]}, ${pixel[1]}, ${pixel[2]}, ${pixel[3] / 255})`;

                    // Draw the block
                    ctx.fillStyle = color;
                    ctx.fillRect(x, y, blockW, blockH);
                } catch (e) {
                    // If sampling fails (out of bounds), skip drawing to make it transparent
                }
            }
        }
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
