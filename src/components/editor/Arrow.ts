import { Line, TOptions, FabricObjectProps, classRegistry } from 'fabric';

export type ArrowHeadType = 'none' | 'left' | 'right' | 'both';

interface ArrowOptions extends TOptions<FabricObjectProps> {
    arrowHead?: ArrowHeadType;
}

/**
 * Custom Arrow class that extends Line
 * Draws arrow heads that don't deform when the arrow is scaled
 */
export class Arrow extends Line {
    static type = 'arrow';
    arrowHead: ArrowHeadType;

    constructor(points: [number, number, number, number], options?: ArrowOptions) {
        super(points, options);
        this.type = 'arrow';
        this.arrowHead = options?.arrowHead || 'right';
        this.strokeLineCap = 'butt'; // Flat ends as requested
        this.strokeLineJoin = 'round';
        this.objectCaching = false;
    }

    /**
     * Override _render to draw both the line and arrow heads with scale compensation
     * This prevents the line ends and heads from deforming during non-uniform scaling.
     */
    _render(ctx: CanvasRenderingContext2D) {
        if (!this.stroke) return;

        ctx.save();

        // Compensate for scaling to prevent deformation of all components
        // We move to a coordinate system where 1 unit = 1 physical pixel
        ctx.scale(1 / this.scaleX, 1 / this.scaleY);

        // Calculate properties in local space
        const localXDiff = this.x2 - this.x1;
        const localYDiff = this.y2 - this.y1;
        const localAngle = Math.atan2(localYDiff, localXDiff);

        // Calculate visual properties in pixels
        const xDiff = localXDiff * this.scaleX;
        const yDiff = localYDiff * this.scaleY;
        const visualAngle = Math.atan2(yDiff, xDiff);
        const visualLength = Math.sqrt(xDiff * xDiff + yDiff * yDiff);

        // Calculate the scale factor for the stroke (perpendicular to the line direction)
        // This ensures the visual thickness matches what the user expects on screen
        const perpScale = Math.sqrt(
            Math.pow(this.scaleX * Math.sin(localAngle), 2) +
            Math.pow(this.scaleY * Math.cos(localAngle), 2)
        );

        // Visual stroke width on screen
        const visualStrokeWidth = this.strokeWidth * (this.strokeUniform ? 1 : perpScale);

        // Arrow head size based on visual stroke width
        const headLength = Math.max(10, visualStrokeWidth * 2.5);
        const headWidth = Math.max(6, visualStrokeWidth * 1.5);

        ctx.rotate(visualAngle);

        // Set common styles
        ctx.strokeStyle = this.stroke as string;
        ctx.fillStyle = this.stroke as string;
        ctx.lineWidth = visualStrokeWidth;
        ctx.lineCap = this.strokeLineCap;
        ctx.lineJoin = this.strokeLineJoin;

        // 1. Draw the line segment
        // We draw it from -visualLength/2 to +visualLength/2 in the compensated space
        ctx.beginPath();
        ctx.moveTo(-visualLength / 2, 0);
        ctx.lineTo(visualLength / 2, 0);
        ctx.stroke();

        // 2. Helper to draw an arrow head
        const drawArrowHead = (x: number, direction: number) => {
            if (this.arrowHead === 'none') return; // Only draw if arrow heads are enabled
            ctx.save();
            ctx.translate(x, 0);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(-headLength * direction, headWidth);
            ctx.lineTo(-headLength * direction, -headWidth);
            ctx.closePath();
            ctx.fill();
            // Also stroke for sharp tips
            ctx.stroke();
            ctx.restore();
        };

        // 3. Draw arrow heads based on direction
        if (this.arrowHead === 'right' || this.arrowHead === 'both') {
            drawArrowHead(visualLength / 2, 1);
        }

        if (this.arrowHead === 'left' || this.arrowHead === 'both') {
            drawArrowHead(-visualLength / 2, -1);
        }

        ctx.restore();
    }

    /**
     * Override toObject to include custom properties
     */
    toObject(propertiesToInclude: any[] = []): any {
        return super.toObject(['arrowHead', ...propertiesToInclude] as any);
    }
}

classRegistry.setClass(Arrow);

export default Arrow;
