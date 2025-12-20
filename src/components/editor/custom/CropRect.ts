import { Rect, classRegistry } from 'fabric';

class CropRect extends Rect {
    static type = 'crop-rect';

    constructor(options: any) {
        super(options);
    }

    // Method to set custom controls
    setCustomControls(controls: any) {
        this.controls = controls;
        return this;
    }

    /**
     * Override render to draw the "shroud" (the darkened area outside the crop rect)
     */
    render(ctx: CanvasRenderingContext2D) {
        const canvas = this.canvas;
        if (!canvas) {
            super.render(ctx);
            return;
        }

        ctx.save();

        // The context already has viewportTransform applied by Fabric's render loop.
        // We draw the shroud in logical canvas coordinates to match the current zoom/pan.
        const vpt = canvas.viewportTransform;

        // Calculate visible viewport area in logical units
        let viewX = 0, viewY = 0, viewW = canvas.getWidth(), viewH = canvas.getHeight();
        if (vpt) {
            const zoomX = vpt[0];
            const zoomY = vpt[3];
            viewX = -vpt[4] / zoomX;
            viewY = -vpt[5] / zoomY;
            viewW = canvas.getWidth() / zoomX;
            viewH = canvas.getHeight() / zoomY;
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();

        // 1. Outer rectangle (the visible area)
        // Add a buffer to ensure no edges are visible during transitions
        ctx.rect(viewX - 50, viewY - 50, viewW + 100, viewH + 100);

        // 2. Inner hole (the crop rectangle)
        // We use the object's basic dimensions to match the "inside" of the stroke
        const left = this.left;
        const top = this.top;
        const w = this.width * this.scaleX;
        const h = this.height * this.scaleY;

        // Draw the hole in reverse to ensure 'evenodd' works correctly
        ctx.rect(left + w, top, -w, h);

        ctx.fill('evenodd');

        ctx.restore();

        // 3. Call super.render to draw the actual rectangle border and handles
        super.render(ctx);
    }
}

// Register the class in Fabric's registry
classRegistry.setClass(CropRect, 'crop-rect');

export default CropRect;

