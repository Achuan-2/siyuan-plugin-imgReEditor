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

        this.arrowHead = options?.arrowHead || 'right';
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
            ctx.lineTo(-headLength * direction, headWidth * -1);
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
