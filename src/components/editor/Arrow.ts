import {
    Line,
    TOptions,
    FabricObjectProps,
    classRegistry,
    Control,
    controlsUtils,
    util,
    Point,
    FabricObject,
    TPointerEvent,
    Transform,
} from 'fabric';
import edgeImg from '../../assets/editor/edgecontrol.svg';

const edgeImgIcon = document.createElement('img');
edgeImgIcon.src = edgeImg;

const deleteIcon =
    "data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'%3E%3Csvg version='1.1' id='Ebene_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' width='595.275px' height='595.275px' viewBox='200 215 230 470' xml:space='preserve'%3E%3Ccircle style='fill:%23F44336;' cx='299.76' cy='439.067' r='218.516'/%3E%3Cg%3E%3Crect x='267.162' y='307.978' transform='matrix(0.7071 -0.7071 0.7071 0.7071 -222.6202 340.6915)' style='fill:white;' width='65.545' height='262.18'/%3E%3Crect x='266.988' y='308.153' transform='matrix(0.7071 0.7071 -0.7071 0.7071 398.3889 -83.3116)' style='fill:white;' width='65.544' height='262.179'/%3E%3C/g%3E%3C/svg%3E";

const delImgIcon = document.createElement('img');
delImgIcon.src = deleteIcon;

function createIconRenderer(icon: HTMLImageElement, width: number, height: number) {
    return (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        _styleOverride: any,
        fabricObject: FabricObject
    ) => {
        ctx.save();
        ctx.translate(left, top);
        ctx.rotate(util.degreesToRadians(fabricObject.angle));
        ctx.drawImage(icon, -width / 2, -height / 2, width, height);
        ctx.restore();
    };
}

// Custom action handler for Line endpoints (Fabric 6)
const lineActionHandler = (
    _eventData: TPointerEvent,
    transform: Transform,
    x: number,
    y: number
) => {
    const { target, corner } = transform;
    const line = target as any;

    if (corner === 'p1') {
        line.set({ x1: x, y1: y });
    } else {
        line.set({ x2: x, y2: y });
    }

    // Recalculate width, height and position
    if (typeof line._setWidthHeight === 'function') {
        line._setWidthHeight();
    }

    line.set('dirty', true);
    return true;
};

// Custom position handlers to map controls to x1,y1 and x2,y2
function p1PositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const p = fabricObject.calcLinePoints();
    return util.transformPoint({ x: p.x1, y: p.y1 } as Point, finalMatrix);
}

function p2PositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const p = fabricObject.calcLinePoints();
    return util.transformPoint({ x: p.x2, y: p.y2 } as Point, finalMatrix);
}

export type ArrowHeadType = 'none' | 'left' | 'right' | 'both';
export type ArrowHeadStyle = 'sharp' | 'swallowtail' | 'sharp-hollow' | 'swallowtail-hollow';
export type ArrowLineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';
export type ArrowThicknessStyle = 'uniform' | 'varying';

interface ArrowOptions extends TOptions<FabricObjectProps> {
    arrowHead?: ArrowHeadType;
    headStyle?: ArrowHeadStyle;
    lineStyle?: ArrowLineStyle;
    thicknessStyle?: ArrowThicknessStyle;
}

/**
 * Custom Arrow class that extends Line
 * Draws arrow heads that don't deform when the arrow is scaled
 */
export class Arrow extends Line {
    static type = 'arrow';
    arrowHead: ArrowHeadType;
    headStyle: ArrowHeadStyle;
    lineStyle: ArrowLineStyle;
    thicknessStyle: ArrowThicknessStyle;

    constructor(points: [number, number, number, number], options?: ArrowOptions) {
        super(points, options);

        this.arrowHead = options?.arrowHead || 'right';
        this.headStyle = options?.headStyle || 'sharp';
        this.lineStyle = options?.lineStyle || 'solid';
        this.thicknessStyle = options?.thicknessStyle || 'uniform';
        this.strokeLineCap = 'butt'; // Flat ends as requested
        this.strokeLineJoin = 'round';
        this.objectCaching = false;
        this.hasBorders = false;

        // Define custom controls for arrow endpoints
        this.controls = {
            p1: new Control({
                actionHandler: lineActionHandler,
                cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
                actionName: 'modifyLine',
                render: createIconRenderer(edgeImgIcon, 25, 25),
                positionHandler: p1PositionHandler,
            }),
            p2: new Control({
                actionHandler: lineActionHandler,
                cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
                actionName: 'modifyLine',
                render: createIconRenderer(edgeImgIcon, 25, 25),
                positionHandler: p2PositionHandler,
            }),
            deleteControl: new Control({
                x: 0.5,
                y: -0.5,
                offsetY: -16,
                offsetX: 16,
                cursorStyle: 'pointer',
                mouseUpHandler: (_eventData, transform: any) => {
                    const target = transform.target;
                    const canvas = target.canvas;
                    if (canvas) {
                        canvas.remove(target);
                        canvas.requestRenderAll();
                    }
                    return true;
                },
                render: createIconRenderer(delImgIcon, 24, 24),
                sizeX: 24,
                sizeY: 24,
            }),
        };
    }

    /**
     * Helper to get dash array based on line style
     */
    private getDashArray(visualStrokeWidth: number): number[] {
        switch (this.lineStyle) {
            case 'dashed':
                return [visualStrokeWidth * 3, visualStrokeWidth * 3];
            case 'dotted':
                return [visualStrokeWidth, visualStrokeWidth * 2];
            case 'dash-dot':
                return [
                    visualStrokeWidth * 4,
                    visualStrokeWidth * 2,
                    visualStrokeWidth,
                    visualStrokeWidth * 2,
                ];
            default:
                return [];
        }
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

        // 1. Check for Hollow Integrated Contour Mode
        const isHollowContour = this.headStyle.endsWith('-hollow');

        if (isHollowContour && (this.arrowHead === 'right' || this.arrowHead === 'left')) {
            // Draw the entire arrow as a single closed path (Contour)
            const style = this.headStyle.replace('-hollow', '');

            // Increased multipliers for a much larger hollow area
            const hL = Math.max(10, visualStrokeWidth * 7.5);
            const hW = Math.max(6, visualStrokeWidth * 3.5);

            // For sharp triangle, the neck point is at the same X as the wings (flat back)
            // For swallowtail, the neck is indented towards the tip
            const indent = style === 'swallowtail' ? hL * 0.75 : hL;

            const bWNeck = visualStrokeWidth * 2.0;
            const bWStart = this.thicknessStyle === 'varying' ? visualStrokeWidth * 0.2 : bWNeck;

            // Use a thinner stroke for the outline in hollow mode to match user expectation
            ctx.lineWidth = Math.max(1, visualStrokeWidth * 0.4);
            ctx.lineJoin = 'miter';
            ctx.miterLimit = 10;

            ctx.beginPath();
            const dir = this.arrowHead === 'right' ? 1 : -1;
            const L = visualLength;

            // Calculate key points
            const tipX = (L / 2) * dir;
            const startX = (-L / 2) * dir;
            const neckX = tipX - indent * dir;
            const wingX = tipX - hL * dir;

            ctx.moveTo(tipX, 0);
            ctx.lineTo(wingX, hW);
            ctx.lineTo(neckX, bWNeck / 2);
            ctx.lineTo(startX, bWStart / 2);
            ctx.lineTo(startX, -bWStart / 2);
            ctx.lineTo(neckX, -bWNeck / 2);
            ctx.lineTo(wingX, -hW);
            ctx.closePath();

            const dashes = this.getDashArray(visualStrokeWidth);
            if (dashes.length > 0) ctx.setLineDash(dashes);
            ctx.stroke();
            if (dashes.length > 0) ctx.setLineDash([]);

            ctx.restore();
            return;
        }

        // 2. Default Rendering Mode (Solid or traditional hollow heads)
        const isVarying =
            this.thicknessStyle === 'varying' &&
            (this.arrowHead === 'left' || this.arrowHead === 'right');

        if (isVarying) {
            // Draw tapered line as a filled polygon
            const startWidth = this.arrowHead === 'right' ? visualStrokeWidth * 0.2 : visualStrokeWidth;
            const endWidth = this.arrowHead === 'right' ? visualStrokeWidth : visualStrokeWidth * 0.2;

            ctx.beginPath();
            ctx.moveTo(-visualLength / 2, -startWidth / 2);
            ctx.lineTo(visualLength / 2, -endWidth / 2);
            ctx.lineTo(visualLength / 2, endWidth / 2);
            ctx.lineTo(-visualLength / 2, startWidth / 2);
            ctx.closePath();
            ctx.fill();
        } else {
            const dashes = this.getDashArray(visualStrokeWidth);
            const hasDashes = dashes.length > 0;
            if (hasDashes) {
                ctx.setLineDash(dashes);
            }

            ctx.beginPath();
            ctx.moveTo(-visualLength / 2, 0);
            ctx.lineTo(visualLength / 2, 0);
            ctx.stroke();

            // Disable dashes for arrow heads
            if (hasDashes) {
                ctx.setLineDash([]);
            }
        }

        // 3. Helper to draw an arrow head
        const drawArrowHead = (x: number, direction: number) => {
            if (this.arrowHead === 'none') return; // Only draw if arrow heads are enabled
            ctx.save();
            ctx.translate(x, 0);

            const isHollow = this.headStyle.endsWith('-hollow');
            const style = isHollow ? this.headStyle.replace('-hollow', '') : this.headStyle;

            // Make heads larger for traditional hollow to ensure visibility
            const currentHeadLength = isHollow ? headLength * 1.5 : headLength;
            const currentHeadWidth = isHollow ? headWidth * 1.5 : headWidth;

            ctx.beginPath();
            if (style === 'swallowtail') {
                // Swallowtail: indented back
                ctx.moveTo(0, 0);
                ctx.lineTo(-currentHeadLength * direction, currentHeadWidth);
                ctx.lineTo(-currentHeadLength * 0.6 * direction, 0);
                ctx.lineTo(-currentHeadLength * direction, -currentHeadWidth);
            } else {
                // Sharp (default triangle)
                ctx.moveTo(0, 0);
                ctx.lineTo(-currentHeadLength * direction, currentHeadWidth);
                ctx.lineTo(-currentHeadLength * direction, -currentHeadWidth);
            }
            ctx.closePath();

            if (isHollow) {
                // Hollow: only stroke and clear background
                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fill();
                ctx.restore();
                ctx.stroke();
            } else {
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();
        };

        // 4. Draw arrow heads based on direction
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
        return super.toObject(['arrowHead', 'headStyle', 'lineStyle', 'thicknessStyle', ...propertiesToInclude] as any);
    }
}

classRegistry.setClass(Arrow);

export default Arrow;
