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
import edgeImg from '../assets/edgecontrol.svg';
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
    eventData: TPointerEvent,
    transform: Transform,
    x: number,
    y: number
) => {
    const { target, corner } = transform;
    const line = target as any;
    const canvas = line.canvas;
    if (!canvas) return false;
    // x, y are already in canvas coordinates - use them directly
    const currentMouseCanvas = new Point(x, y);
    // Get current canvas positions of both endpoints
    const matrix = line.calcTransformMatrix();
    const centerX = (line.x1 + line.x2) / 2;
    const centerY = (line.y1 + line.y2) / 2;
    let p1Local = new Point(line.x1 - centerX, line.y1 - centerY);
    let p2Local = new Point(line.x2 - centerX, line.y2 - centerY);
    let p1Canvas = util.transformPoint(p1Local, matrix);
    let p2Canvas = util.transformPoint(p2Local, matrix);
    // Update the canvas position of the dragged endpoint to mouse position
    if (corner === 'p1') {
        p1Canvas = currentMouseCanvas;
    } else {
        p2Canvas = currentMouseCanvas;
    }
    // Recalculate line properties from the two canvas endpoints
    // Set new x1, y1, x2, y2 as if creating a new line (absolute canvas coords temporarily)
    line.set({
        x1: p1Canvas.x,
        y1: p1Canvas.y,
        x2: p2Canvas.x,
        y2: p2Canvas.y,
        left: undefined,
        top: undefined,
    });
    // Recalculate width, height and position
    if (typeof line._setWidthHeight === 'function') {
        line._setWidthHeight();
    }
    // Now make x1,y1,x2,y2 relative to the new left/top
    line.x1 -= line.left;
    line.y1 -= line.top;
    line.x2 -= line.left;
    line.y2 -= line.top;
    line.setCoords();
    line.set('dirty', true);
    return true;
};
// --- MODIFIED POSITION HANDLERS ---
// Custom position handlers to map controls to x1,y1 and x2,y2
function p1PositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const line = fabricObject as any;
    const canvas = line.canvas;
    // 计算端点相对于对象中心的局部坐标
    const centerX = (line.x1 + line.x2) / 2;
    const centerY = (line.y1 + line.y2) / 2;
    const localPoint = new Point(line.x1 - centerX, line.y1 - centerY);
    // 转换到画布坐标
    const canvasPoint = util.transformPoint(localPoint, line.calcTransformMatrix());
    // 应用 viewport transform 转换到屏幕坐标
    if (canvas && canvas.viewportTransform) {
        return util.transformPoint(canvasPoint, canvas.viewportTransform);
    }
    return canvasPoint;
}
function p2PositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const line = fabricObject as any;
    const canvas = line.canvas;
    // 计算端点相对于对象中心的局部坐标
    const centerX = (line.x1 + line.x2) / 2;
    const centerY = (line.y1 + line.y2) / 2;
    const localPoint = new Point(line.x2 - centerX, line.y2 - centerY);
    // 转换到画布坐标
    const canvasPoint = util.transformPoint(localPoint, line.calcTransformMatrix());
    // 应用 viewport transform 转换到屏幕坐标
    if (canvas && canvas.viewportTransform) {
        return util.transformPoint(canvasPoint, canvas.viewportTransform);
    }
    return canvasPoint;
}
// Delete control position handler - positioned at the 1/4 position of the arrow
function deletePositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const arrow = fabricObject as any;
    const canvas = arrow.canvas;

    const isCurved = Math.abs(arrow.controlOffsetX) > 0.1 || Math.abs(arrow.controlOffsetY) > 0.1;
    let localPoint: Point;

    if (isCurved) {
        // Calculate point on curve at t=0.25
        const t = 0.25;
        const centerX = (arrow.x1 + arrow.x2) / 2;
        const centerY = (arrow.y1 + arrow.y2) / 2;
        const p1x = centerX + arrow.controlOffsetX;
        const p1y = centerY + arrow.controlOffsetY;
        const x = Math.pow(1 - t, 2) * arrow.x1 +
            2 * (1 - t) * t * p1x +
            Math.pow(t, 2) * arrow.x2;
        const y = Math.pow(1 - t, 2) * arrow.y1 +
            2 * (1 - t) * t * p1y +
            Math.pow(t, 2) * arrow.y2;
        localPoint = new Point(x - centerX, y - centerY);
    } else {
        // Straight line 1/4 position
        const x = arrow.x1 + (arrow.x2 - arrow.x1) * 0.25;
        const y = arrow.y1 + (arrow.y2 - arrow.y1) * 0.25;
        const centerX = (arrow.x1 + arrow.x2) / 2;
        const centerY = (arrow.y1 + arrow.y2) / 2;
        localPoint = new Point(x - centerX, y - centerY);
    }

    // Transform to canvas coordinates
    const canvasPoint = util.transformPoint(localPoint, arrow.calcTransformMatrix());
    // Apply viewport transform to screen coordinates
    if (canvas && canvas.viewportTransform) {
        return util.transformPoint(canvasPoint, canvas.viewportTransform);
    }
    return canvasPoint;
}
// Center control point position handler for curve control
function centerControlPositionHandler(_dim: any, finalMatrix: any, fabricObject: any) {
    const arrow = fabricObject as any;
    const canvas = arrow.canvas;
    // 计算曲线控制点在 t=0.5 处的位置（在对象局部坐标系中）
    const t = 0.5;
    // 对于二次贝塞尔曲线，中点的控制点影响为：2*t*(1-t)*controlOffset
    const localX = arrow.controlOffsetX * 2 * t * (1 - t);
    const localY = arrow.controlOffsetY * 2 * t * (1 - t);
    const localPoint = new Point(localX, localY);
    // 转换到画布坐标
    const canvasPoint = util.transformPoint(localPoint, arrow.calcTransformMatrix());
    // 应用 viewport transform 转换到屏幕坐标
    if (canvas && canvas.viewportTransform) {
        return util.transformPoint(canvasPoint, canvas.viewportTransform);
    }
    return canvasPoint;
}
// --- END OF MODIFIED HANDLERS ---
// Action handler for center control point
const centerControlActionHandler = (
    eventData: TPointerEvent,
    transform: Transform,
    x: number,
    y: number
) => {
    const { target } = transform;
    const arrow = target as any;
    const canvas = arrow.canvas;
    if (!canvas) return false;
    // x, y are already in canvas coordinates - use them directly
    const currentMouseCanvas = new Point(x, y);
    // Convert mouse position to local coordinates
    const matrix = arrow.calcTransformMatrix();
    const invertedMatrix = util.invertTransform(matrix);
    const newLocal = util.transformPoint(currentMouseCanvas, invertedMatrix);
    // Update control offsets
    arrow.controlOffsetX = newLocal.x * 2;
    arrow.controlOffsetY = newLocal.y * 2;
    arrow.setCoords();
    arrow.set('dirty', true);
    return true;
};
export type ArrowHeadType = 'none' | 'left' | 'right' | 'both';
export type ArrowHeadStyle = 'sharp' | 'swallowtail' | 'sharp-hollow' | 'swallowtail-hollow';
export type ArrowLineStyle = 'solid' | 'dashed' | 'dotted' | 'dash-dot';
export type ArrowThicknessStyle = 'uniform' | 'varying';
interface ArrowOptions extends TOptions<FabricObjectProps> {
    arrowHead?: ArrowHeadType;
    headStyle?: ArrowHeadStyle;
    lineStyle?: ArrowLineStyle;
    thicknessStyle?: ArrowThicknessStyle;
    useCustomSelection?: boolean;
    controlOffsetX?: number;
    controlOffsetY?: number;
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
    useCustomSelection: boolean;
    controlOffsetX: number;
    controlOffsetY: number;
    constructor(points: [number, number, number, number], options?: ArrowOptions) {
        super(points, options);
        this.arrowHead = options?.arrowHead || 'right';
        this.headStyle = options?.headStyle || 'sharp';
        this.lineStyle = options?.lineStyle || 'solid';
        this.thicknessStyle = options?.thicknessStyle || 'uniform';
        this.useCustomSelection = true;
        this.strokeLineCap = 'butt'; // Flat ends as requested
        this.strokeLineJoin = 'round';
        this.objectCaching = false;
        this.hasBorders = !this.useCustomSelection;
        // Enable per-pixel target finding for accurate curve hit detection
        this.perPixelTargetFind = true;
        this.targetFindTolerance = 10;
        // Initialize control point offset at 0 (on the line, straight arrow by default)
        this.controlOffsetX = options?.controlOffsetX ?? 0;
        this.controlOffsetY = options?.controlOffsetY ?? 0;

        // Ensure points are normalized right from the start
        if (points && points.length === 4) {
            this.setEndpoints(points[0], points[1], points[2], points[3]);
        }

        if (this.useCustomSelection) {
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
                centerControl: new Control({
                    actionHandler: centerControlActionHandler,
                    cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
                    actionName: 'modifyCurve',
                    mouseDownHandler: (_eventData: TPointerEvent, transform: Transform) => {
                        // Check for double click to reset curve to straight line
                        const arrow = transform.target as any;
                        const now = Date.now();
                        const lastClick = arrow._lastCenterControlClick || 0;
                        const timeDiff = now - lastClick;

                        if (timeDiff < 300) {
                            // Double click detected - reset to straight line
                            arrow.controlOffsetX = 0;
                            arrow.controlOffsetY = 0;
                            arrow.setCoords();
                            arrow.set('dirty', true);
                            if (arrow.canvas) {
                                arrow.canvas.requestRenderAll();
                            }
                            arrow._lastCenterControlClick = 0; // Reset
                            return true;
                        }

                        arrow._lastCenterControlClick = now;
                        return false;
                    },
                    render: (ctx: CanvasRenderingContext2D, left: number, top: number) => {
                        const size = 12;
                        ctx.save();
                        ctx.translate(left, top);
                        ctx.beginPath();
                        ctx.arc(0, 0, size / 2, 0, 2 * Math.PI);
                        ctx.fillStyle = '#4285f4';
                        ctx.fill();
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 2;
                        ctx.stroke();
                        ctx.restore();
                    },
                    positionHandler: centerControlPositionHandler,
                }),
                deleteControl: new Control({
                    x: 0,
                    y: 0,
                    offsetY: 0,
                    offsetX: 0,
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
                    positionHandler: deletePositionHandler,
                    sizeX: 24,
                    sizeY: 24,
                }),
            };
        }
    }

    /**
     * Updates the endpoints of the arrow and normalizes its position/dimensions.
     * This ensures the arrow is correctly centered and the bounding box is accurate.
     */
    public setEndpoints(x1: number, y1: number, x2: number, y2: number) {
        this.set({
            x1,
            y1,
            x2,
            y2,
            left: undefined,
            top: undefined,
        });

        // Recalculate width, height and position
        // @ts-ignore
        if (typeof this._setWidthHeight === 'function') {
            // @ts-ignore
            this._setWidthHeight();
        }

        // Now make x1,y1,x2,y2 relative to the new left/top
        this.x1 -= this.left;
        this.y1 -= this.top;
        this.x2 -= this.left;
        this.y2 -= this.top;

        this.setCoords();
        this.set('dirty', true);
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
     * Calculate the visual stroke width taking scale into account.
     */
    getVisualStrokeWidth(): number {
        const localXDiff = this.x2 - this.x1;
        const localYDiff = this.y2 - this.y1;
        const localAngle = Math.atan2(localYDiff, localXDiff);
        const perpScale = Math.sqrt(
            Math.pow(this.scaleX * Math.sin(localAngle), 2) +
            Math.pow(this.scaleY * Math.cos(localAngle), 2)
        );
        return this.strokeWidth * (this.strokeUniform ? 1 : perpScale);
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
        // Visual stroke width on screen
        const visualStrokeWidth = this.getVisualStrokeWidth();
        // Calculate visual properties for rendering
        const localXDiff = this.x2 - this.x1;
        const localYDiff = this.y2 - this.y1;
        const xDiff = localXDiff * this.scaleX;
        const yDiff = localYDiff * this.scaleY;
        const visualAngle = Math.atan2(yDiff, xDiff);
        const visualLength = Math.sqrt(xDiff * xDiff + yDiff * yDiff);
        // Check if the arrow is curved BEFORE rotation transformation
        // This ensures vertical arrows are properly detected as curved
        const isCurved = Math.abs(this.controlOffsetX) > 0.1 || Math.abs(this.controlOffsetY) > 0.1;

        // Calculate control point in the rotated coordinate system
        // controlOffsetX/Y are already relative to center (0,0)
        const controlXLocal = this.controlOffsetX;
        const controlYLocal = this.controlOffsetY;
        // Transform control point to match the rotated canvas
        const cosA = Math.cos(-visualAngle);
        const sinA = Math.sin(-visualAngle);
        const rotatedControlX =
            controlXLocal * this.scaleX * cosA - controlYLocal * this.scaleY * sinA;
        const rotatedControlY =
            controlXLocal * this.scaleX * sinA + controlYLocal * this.scaleY * cosA;

        // Helper to get point on quadratic bezier curve at parameter t (0 to 1)
        const getPoint = (t: number) => {
            const x =
                (-visualLength / 2) * (1 - t) * (1 - t) +
                rotatedControlX * 2 * (1 - t) * t +
                (visualLength / 2) * t * t;
            const y = 2 * (1 - t) * t * rotatedControlY;
            return { x, y };
        };

        // Helper to get normalized tangent at parameter t
        const getTangent = (t: number) => {
            if (!isCurved) {
                return { x: 1, y: 0 };
            }
            // P'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
            const dx =
                2 * (1 - t) * (rotatedControlX - -visualLength / 2) +
                2 * t * (visualLength / 2 - rotatedControlX);
            const dy = 2 * (1 - t) * rotatedControlY + 2 * t * -rotatedControlY;
            const mag = Math.sqrt(dx * dx + dy * dy);
            return mag === 0 ? { x: 1, y: 0 } : { x: dx / mag, y: dy / mag };
        };

        // Arrow head size based on original stroke width to prevent disappearing at certain angles
        const headLength = Math.max(10, this.strokeWidth * 5.5);
        const headWidth = Math.max(6, this.strokeWidth * 2.5);
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
            const hL = Math.max(10, this.strokeWidth * 7.5);
            const hW = Math.max(6, this.strokeWidth * 3.5);
            // For sharp triangle, the neck point is at the same X as the wings (flat back)
            // For swallowtail, the neck is indented towards the tip
            const indent = style === 'swallowtail' ? hL * 0.75 : hL;
            const bWNeck = this.strokeWidth * 2.0;
            const bWStart = this.thicknessStyle === 'varying' ? this.strokeWidth * 0.2 : bWNeck;
            // Use a thinner stroke for the outline in hollow mode to match user expectation
            ctx.lineWidth = Math.max(1, this.strokeWidth * 0.4);
            ctx.lineJoin = 'miter';
            ctx.miterLimit = 10;
            ctx.beginPath();

            const dir = this.arrowHead === 'right' ? 1 : -1;
            const L = visualLength;

            const tTip = dir === 1 ? 1 : 0;
            const tStart = dir === 1 ? 0 : 1;
            // Use a slightly more accurate estimate for t at the neck indent
            const tNeck = dir === 1 ? Math.max(0, 1 - indent / visualLength) : Math.min(1, indent / visualLength);

            if (isCurved) {
                const steps = 50; // Increased steps for smoother curves

                const tip = getPoint(tTip);
                const tanTip = getTangent(tTip);
                const normTip = { x: -tanTip.y, y: tanTip.x };

                const start = getPoint(tStart);
                const tanStart = getTangent(tStart);
                const normStart = { x: -tanStart.y, y: tanStart.x };

                // direction factor for head elements: head points 'away' from tip relative to tangent
                const hDir = dir === 1 ? -1 : 1;

                // --- RIGID HEAD CALCULATION ---
                // All head points are calculated relative to the Tip and its tangent
                // to ensure the triangle/swallowtail is NOT deformed by the curve.
                const wing1 = {
                    x: tip.x + hDir * tanTip.x * hL + normTip.x * hW,
                    y: tip.y + hDir * tanTip.y * hL + normTip.y * hW,
                };
                const wing2 = {
                    x: tip.x + hDir * tanTip.x * hL - normTip.x * hW,
                    y: tip.y + hDir * tanTip.y * hL - normTip.y * hW,
                };

                // Use Tip's tangent for Neck as well to keep the head shape rigid
                const neck1 = {
                    x: tip.x + hDir * tanTip.x * indent + normTip.x * (bWNeck / 2),
                    y: tip.y + hDir * tanTip.y * indent + normTip.y * (bWNeck / 2),
                };
                const neck2 = {
                    x: tip.x + hDir * tanTip.x * indent - normTip.x * (bWNeck / 2),
                    y: tip.y + hDir * tanTip.y * indent - normTip.y * (bWNeck / 2),
                };

                // Rigid Start Points (flat end perpendicular to start tangent)
                const start1 = {
                    x: start.x + normStart.x * (bWStart / 2),
                    y: start.y + normStart.y * (bWStart / 2),
                };
                const start2 = {
                    x: start.x - normStart.x * (bWStart / 2),
                    y: start.y - normStart.y * (bWStart / 2),
                };

                ctx.moveTo(tip.x, tip.y);
                ctx.lineTo(wing1.x, wing1.y);
                ctx.lineTo(neck1.x, neck1.y);

                // Stem Bottom (Neck1 -> Start1)
                // We transition from the rigid neck point to the curve's profile
                for (let i = 1; i < steps; i++) {
                    const f = i / steps;
                    const t = tNeck * (1 - f) + tStart * f;
                    const p = getPoint(t);
                    const tan = getTangent(t);
                    const norm = { x: -tan.y, y: tan.x };
                    const w = bWNeck * (1 - f) + bWStart * f;
                    ctx.lineTo(p.x + norm.x * (w / 2), p.y + norm.y * (w / 2));
                }
                ctx.lineTo(start1.x, start1.y);
                ctx.lineTo(start2.x, start2.y);

                // Stem Top (Start2 -> Neck2)
                for (let i = 1; i < steps; i++) {
                    const f = i / steps;
                    const t = tStart * (1 - f) + tNeck * f;
                    const p = getPoint(t);
                    const tan = getTangent(t);
                    const norm = { x: -tan.y, y: tan.x };
                    const w = bWStart * (1 - f) + bWNeck * f;
                    ctx.lineTo(p.x - norm.x * (w / 2), p.y - norm.y * (w / 2));
                }
                ctx.lineTo(neck2.x, neck2.y);
                ctx.lineTo(wing2.x, wing2.y);
            } else {
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
            }

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
            const startWidth = this.arrowHead === 'right' ? this.strokeWidth * 0.2 : this.strokeWidth;
            const endWidth =
                this.arrowHead === 'right' ? this.strokeWidth : this.strokeWidth * 0.2;
            ctx.beginPath();
            if (isCurved) {
                // For curved varying thickness, approximate with line segments
                const steps = 50;
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    const p = getPoint(t);
                    const tan = getTangent(t);
                    const norm = { x: -tan.y, y: tan.x };
                    const width = startWidth * (1 - t) + endWidth * t;
                    if (i === 0) {
                        ctx.moveTo(p.x + norm.x * (width / 2), p.y + norm.y * (width / 2));
                    } else {
                        ctx.lineTo(p.x + norm.x * (width / 2), p.y + norm.y * (width / 2));
                    }
                }
                for (let i = steps; i >= 0; i--) {
                    const t = i / steps;
                    const p = getPoint(t);
                    const tan = getTangent(t);
                    const norm = { x: -tan.y, y: tan.x };
                    const width = startWidth * (1 - t) + endWidth * t;
                    ctx.lineTo(p.x - norm.x * (width / 2), p.y - norm.y * (width / 2));
                }
            } else {
                ctx.moveTo(-visualLength / 2, -startWidth / 2);
                ctx.lineTo(visualLength / 2, -endWidth / 2);
                ctx.lineTo(visualLength / 2, endWidth / 2);
                ctx.lineTo(-visualLength / 2, startWidth / 2);
            }
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
            if (isCurved) {
                // Draw quadratic bezier curve
                ctx.quadraticCurveTo(rotatedControlX, rotatedControlY, visualLength / 2, 0);
            } else {
                // Draw straight line
                ctx.lineTo(visualLength / 2, 0);
            }
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
            // Calculate tangent angle at the endpoint for curved arrows
            if (isCurved) {
                const t = direction === 1 ? 1 : 0;
                const tangent = getTangent(t);
                const tangentAngle = Math.atan2(tangent.y, tangent.x);
                ctx.rotate(tangentAngle);
            }
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
     * Override _getNonTransformedDimensions to account for curve
     * This is used by Fabric for internal calculations
     */
    _getNonTransformedDimensions(): Point {
        const isCurved = Math.abs(this.controlOffsetX) > 0.1 || Math.abs(this.controlOffsetY) > 0.1;

        if (!isCurved) {
            return super._getNonTransformedDimensions();
        }

        // Calculate actual curve bounds in local coordinates
        const centerX = (this.x1 + this.x2) / 2;
        const centerY = (this.y1 + this.y2) / 2;
        const p1x = centerX + this.controlOffsetX;
        const p1y = centerY + this.controlOffsetY;

        let minX = Math.min(this.x1, this.x2, p1x);
        let maxX = Math.max(this.x1, this.x2, p1x);
        let minY = Math.min(this.y1, this.y2, p1y);
        let maxY = Math.max(this.y1, this.y2, p1y);

        // Sample curve for more accurate bounds
        const samples = 20;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const x = Math.pow(1 - t, 2) * this.x1 +
                2 * (1 - t) * t * p1x +
                Math.pow(t, 2) * this.x2;
            const y = Math.pow(1 - t, 2) * this.y1 +
                2 * (1 - t) * t * p1y +
                Math.pow(t, 2) * this.y2;

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        const padding = Math.max(this.strokeWidth * 2, 15);
        return new Point(maxX - minX + padding * 2, maxY - minY + padding * 2);
    }

    /**
     * Override getCoords to return corner points that include the curve
     */
    getCoords(): Point[] {
        const isCurved = Math.abs(this.controlOffsetX) > 0.1 || Math.abs(this.controlOffsetY) > 0.1;

        if (!isCurved) {
            return super.getCoords();
        }

        // Calculate bounds in local coordinates
        const centerX = (this.x1 + this.x2) / 2;
        const centerY = (this.y1 + this.y2) / 2;
        const p1x = centerX + this.controlOffsetX;
        const p1y = centerY + this.controlOffsetY;

        let minX = Math.min(this.x1, this.x2, p1x);
        let maxX = Math.max(this.x1, this.x2, p1x);
        let minY = Math.min(this.y1, this.y2, p1y);
        let maxY = Math.max(this.y1, this.y2, p1y);

        // Sample curve
        const samples = 20;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const x = Math.pow(1 - t, 2) * this.x1 +
                2 * (1 - t) * t * p1x +
                Math.pow(t, 2) * this.x2;
            const y = Math.pow(1 - t, 2) * this.y1 +
                2 * (1 - t) * t * p1y +
                Math.pow(t, 2) * this.y2;

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        const padding = Math.max(this.strokeWidth * 2, 15);
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        // Transform the four corners
        const matrix = this.calcTransformMatrix();
        const tl = util.transformPoint(new Point(minX, minY), matrix);
        const tr = util.transformPoint(new Point(maxX, minY), matrix);
        const br = util.transformPoint(new Point(maxX, maxY), matrix);
        const bl = util.transformPoint(new Point(minX, maxY), matrix);

        return [tl, tr, br, bl];
    }

    /**
     * Override getBoundingRect to include the curved path
     * This ensures the bounding box encompasses the entire curve
     */
    getBoundingRect(): any {
        const isCurved = Math.abs(this.controlOffsetX) > 0.1 || Math.abs(this.controlOffsetY) > 0.1;

        if (!isCurved) {
            return super.getBoundingRect();
        }

        // For curved arrows, calculate bounding box that includes the curve
        const matrix = this.calcTransformMatrix();
        const points: Point[] = [];

        // Line's x1,y1,x2,y2 are relative to left,top
        // controlOffsetX/Y are relative to object center
        // So we need to adjust: center of line is at ((x1+x2)/2, (y1+y2)/2)
        const centerX = (this.x1 + this.x2) / 2;
        const centerY = (this.y1 + this.y2) / 2;

        // Sample points along the curve
        const samples = 30;
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            // Calculate point on quadratic bezier curve
            // Control point is at center + controlOffset
            const p1x = centerX + this.controlOffsetX;
            const p1y = centerY + this.controlOffsetY;

            const x = Math.pow(1 - t, 2) * this.x1 +
                2 * (1 - t) * t * p1x +
                Math.pow(t, 2) * this.x2;
            const y = Math.pow(1 - t, 2) * this.y1 +
                2 * (1 - t) * t * p1y +
                Math.pow(t, 2) * this.y2;

            // Transform to canvas coordinates
            const transformed = util.transformPoint(new Point(x, y), matrix);
            points.push(transformed);
        }

        // Find min/max coordinates
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const p of points) {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        }

        // Add generous padding for stroke width and hit detection
        const padding = Math.max(this.strokeWidth * 3, 20);

        return {
            left: minX - padding,
            top: minY - padding,
            width: maxX - minX + padding * 2,
            height: maxY - minY + padding * 2,
        };
    }

    /**
     * Override containsPoint to support curve hit detection
     * This allows clicking on the curved line to select the arrow
     */
    containsPoint(point: Point): boolean {
        // Check if the arrow is curved
        const isCurved = Math.abs(this.controlOffsetX) > 0.1 || Math.abs(this.controlOffsetY) > 0.1;

        if (!isCurved) {
            // For straight arrows, use default line hit detection
            return super.containsPoint(point);
        }

        // For curved arrows, check distance to bezier curve
        const visualStrokeWidth = this.getVisualStrokeWidth();
        const threshold = Math.max(visualStrokeWidth / 2 + 15, 20); // Increased hit area threshold

        // Transform point to local coordinates
        const localPoint = util.transformPoint(
            point,
            util.invertTransform(this.calcTransformMatrix())
        );

        // Line's x1,y1,x2,y2 are relative to left,top
        // controlOffsetX/Y are relative to object center
        const centerX = (this.x1 + this.x2) / 2;
        const centerY = (this.y1 + this.y2) / 2;

        // Control point is at center + controlOffset
        const p1x = centerX + this.controlOffsetX;
        const p1y = centerY + this.controlOffsetY;

        // Sample points along the quadratic bezier curve
        const samples = 50; // Increased samples for better accuracy
        let minDistance = Infinity;

        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            // Calculate point on quadratic bezier curve in local coordinates
            // P(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
            const curveX = Math.pow(1 - t, 2) * this.x1 +
                2 * (1 - t) * t * p1x +
                Math.pow(t, 2) * this.x2;
            const curveY = Math.pow(1 - t, 2) * this.y1 +
                2 * (1 - t) * t * p1y +
                Math.pow(t, 2) * this.y2;

            const dx = localPoint.x - curveX;
            const dy = localPoint.y - curveY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        return minDistance <= threshold;
    }

    /**
     * Override toObject to include custom properties
     */
    toObject(propertiesToInclude: any[] = []): any {
        return super.toObject(['arrowHead', 'headStyle', 'lineStyle', 'thicknessStyle', 'useCustomSelection', 'controlOffsetX', 'controlOffsetY', ...propertiesToInclude] as any);
    }
}
classRegistry.setClass(Arrow);
export default Arrow;