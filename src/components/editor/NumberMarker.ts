import { FabricObject, classRegistry, TOptions, FabricObjectProps } from 'fabric';

export interface NumberMarkerOptions extends TOptions<FabricObjectProps> {
    count?: number;
    fill?: string;
    textColor?: string;
    radius?: number;
}

/**
 * Custom NumberMarker class
 * Draws a circle with a number inside
 */
export class NumberMarker extends FabricObject {
    static type = 'number-marker';

    count: number;
    textColor: string;
    radius: number;

    constructor(options?: NumberMarkerOptions) {
        super(options);

        this.count = options?.count || 1;
        // Default fill is handled by super if passed in options, usually red from callsite
        this.fill = options?.fill || 'red';
        this.textColor = options?.textColor || 'white';
        this.radius = options?.radius || 15;

        // precise dimensions
        this.width = this.radius * 2;
        this.height = this.radius * 2;

        // Centered origin by default usually works best for these markers, 
        // but fabric defaults to top-left. Let's keep fabric defaults but render centered relative to 0,0 
        // if originX/Y are center. 
        // Actually, _render is called with (0,0) being the center of the object if originX/Y are 'center'.
        // Fabric standard: _render is called with coordinate system translated to center of object (minus padding).
        // Let's rely on standard center-based rendering.

        this.objectCaching = false;

        // No stroke by default unless specified
        this.stroke = options?.stroke || null;
        this.strokeWidth = options?.strokeWidth || 0;
    }

    _render(ctx: CanvasRenderingContext2D) {
        ctx.save();

        // Render Circle
        // The coordinate system in _render is already at the object's center (width/2, height/2)
        // relative to left/top.
        // Actually, in standard fabric, (0,0) is the center of the object's bounding box 
        // if we assume standard transform setup.

        // Draw the circle background
        ctx.beginPath();
        // Since this.width/height are set, we draw within the box [-w/2, -w/2, w/2, h/2]
        // But let's just use radius.

        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);

        if (this.fill) {
            ctx.fillStyle = this.fill as string;
            ctx.fill();
        }

        if (this.stroke) {
            ctx.strokeStyle = this.stroke as string;
            ctx.lineWidth = this.strokeWidth || 0;
            ctx.stroke();
        }

        // Draw the number
        ctx.fillStyle = this.textColor;
        // Font size should scale with radius?
        ctx.font = `bold ${this.radius * 1.2}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Minor optical adjustment for vertical centering
        ctx.fillText(this.count.toString(), 0, this.radius * 0.1);

        ctx.restore();
    }

    /**
     * Override toObject to include custom properties
     */
    toObject(propertiesToInclude: any[] = []): any {
        return super.toObject(['count', 'textColor', 'radius', ...propertiesToInclude]);
    }
}

classRegistry.setClass(NumberMarker);

export default NumberMarker;
