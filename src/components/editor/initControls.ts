/*
 * 控制条样式
 */

import {
    util,
    Control,
    FabricObject,
    controlsUtils,
    InteractiveFabricObject,
    Canvas,
    TPointerEvent,
    Transform,
} from 'fabric';

// 资源预加载
// 将所有图像资源在模块顶层创建并赋值src，以便它们尽快开始加载。
import verticalImg from './assets/middlecontrol.svg';
import horizontalImg from './assets/middlecontrolhoz.svg';
import edgeImg from './assets/edgecontrol.svg';
import rotateImg from './assets/rotateicon.svg';

const verticalImgIcon = document.createElement('img');
verticalImgIcon.src = verticalImg;

const horizontalImgIcon = document.createElement('img');
horizontalImgIcon.src = horizontalImg;

const edgeImgIcon = document.createElement('img');
edgeImgIcon.src = edgeImg;

const rotateImgIcon = document.createElement('img');
rotateImgIcon.src = rotateImg;

const deleteIcon =
    "data:image/svg+xml,%3C%3Fxml version='1.0' encoding='utf-8'%3F%3E%3C!DOCTYPE svg PUBLIC '-//W3C//DTD SVG 1.1//EN' 'http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd'%3E%3Csvg version='1.1' id='Ebene_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' width='595.275px' height='595.275px' viewBox='200 215 230 470' xml:space='preserve'%3E%3Ccircle style='fill:%23F44336;' cx='299.76' cy='439.067' r='218.516'/%3E%3Cg%3E%3Crect x='267.162' y='307.978' transform='matrix(0.7071 -0.7071 0.7071 0.7071 -222.6202 340.6915)' style='fill:white;' width='65.545' height='262.18'/%3E%3Crect x='266.988' y='308.153' transform='matrix(0.7071 0.7071 -0.7071 0.7071 398.3889 -83.3116)' style='fill:white;' width='65.544' height='262.179'/%3E%3C/g%3E%3C/svg%3E";

const delImgIcon = document.createElement('img');
delImgIcon.src = deleteIcon;

const confirmIcon =
    `data:image/svg+xml,${encodeURIComponent('<svg t="1766119752080" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7311" width="24" height="24"><path d="M511.950005 512.049995m-447.956254 0a447.956254 447.956254 0 1 0 895.912508 0 447.956254 447.956254 0 1 0-895.912508 0Z" fill="#20B759" p-id="7312"></path><path d="M458.95518 649.636559L289.271751 479.95313c-11.698858-11.698858-30.697002-11.698858-42.39586 0s-11.698858 30.697002 0 42.395859l169.683429 169.68343c11.698858 11.698858 30.697002 11.698858 42.39586 0 11.798848-11.598867 11.798848-30.597012 0-42.39586z" fill="#FFFFFF" p-id="7313"></path><path d="M777.62406 332.267552c-11.698858-11.698858-30.697002-11.698858-42.39586 0L424.158578 643.437164c-11.698858 11.698858-11.698858 30.697002 0 42.39586s30.697002 11.698858 42.39586 0l311.069622-311.069622c11.798848-11.798848 11.798848-30.796992 0-42.49585z" fill="#FFFFFF" p-id="7314"></path></svg>')}`;

const confirmImgIcon = document.createElement('img');
confirmImgIcon.src = confirmIcon;

function createIconRenderer(
    icon: HTMLImageElement,
    width: number,
    height: number,
) {
    return (
        ctx: CanvasRenderingContext2D,
        left: number,
        top: number,
        _styleOverride: any,
        fabricObject: FabricObject,
    ) => {
        ctx.save();
        ctx.translate(left, top);
        ctx.rotate(util.degreesToRadians(fabricObject.angle));
        ctx.drawImage(icon, -width / 2, -height / 2, width, height);
        ctx.restore();
    };
}

/**
 * 始终等比例缩放的处理器，忽略 Shift 键
 */
function scalingEquallyAlways(eventData: TPointerEvent, transform: Transform, x: number, y: number) {
    // 强制不按 Shift，始终等比例缩放
    const fakeEventData = { ...eventData, shiftKey: false };
    return controlsUtils.scalingEqually(fakeEventData, transform, x, y);
}

// Controls 初始化
function initControls(canvas: Canvas) {
    // 中间横杠
    const mlControl = new Control({
        x: -0.5,
        y: 0,
        offsetX: -1,
        cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
        actionHandler: controlsUtils.scalingXOrSkewingY,
        getActionName: controlsUtils.scaleOrSkewActionName,
        render: createIconRenderer(verticalImgIcon, 20, 25),
    });

    const mrControl = new Control({
        x: 0.5,
        y: 0,
        offsetX: 1,
        cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
        actionHandler: controlsUtils.scalingXOrSkewingY,
        getActionName: controlsUtils.scaleOrSkewActionName,
        render: createIconRenderer(verticalImgIcon, 20, 25),
    });

    const mbControl = new Control({
        x: 0,
        y: 0.5,
        offsetY: 1,
        cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
        actionHandler: controlsUtils.scalingYOrSkewingX,
        getActionName: controlsUtils.scaleOrSkewActionName,
        render: createIconRenderer(horizontalImgIcon, 25, 20),
    });

    const mtControl = new Control({
        x: 0,
        y: -0.5,
        offsetY: -1,
        cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
        actionHandler: controlsUtils.scalingYOrSkewingX,
        getActionName: controlsUtils.scaleOrSkewActionName,
        render: createIconRenderer(horizontalImgIcon, 25, 20),
    });

    // 顶点
    const tlControl = new Control({
        x: -0.5,
        y: -0.5,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: scalingEquallyAlways,
        render: createIconRenderer(edgeImgIcon, 25, 25),
    });

    const blControl = new Control({
        x: -0.5,
        y: 0.5,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: scalingEquallyAlways,
        render: createIconRenderer(edgeImgIcon, 25, 25),
    });

    const trControl = new Control({
        x: 0.5,
        y: -0.5,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: scalingEquallyAlways,
        render: createIconRenderer(edgeImgIcon, 25, 25),
    });

    const brControl = new Control({
        x: 0.5,
        y: 0.5,
        cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
        actionHandler: scalingEquallyAlways,
        render: createIconRenderer(edgeImgIcon, 25, 25),
    });

    // 旋转
    const mtrControl = new Control({
        x: 0,
        y: 0.5, // 旋转点在底部中间
        cursorStyle: 'pointer',
        actionHandler: (eventData: TPointerEvent, transform: Transform, x: number, y: number) => {
            const target = transform.target;
            if (!target) return controlsUtils.rotationWithSnapping(eventData, transform, x, y);

            // 保存中心点，调用默认旋转逻辑来更新 transform（保持与 fabric 内部状态一致）
            const centerBefore = target.getCenterPoint();
            const result = controlsUtils.rotationWithSnapping(eventData, transform, x, y);

            // 当按住 Shift 时，将角度吸附到 45° 倍数，并把中心点还原，避免位置移动
            if (eventData.shiftKey) {
                const angle = target.angle;
                const snappedAngle = Math.round(angle / 45) * 45;
                target.set('angle', snappedAngle);
                target.setPositionByOrigin(centerBefore, 'center', 'center');
                target.setCoords();
            }

            return result;
        },
        offsetY: 30, // 旋转手柄的偏移量
        actionName: 'rotate',
        render: createIconRenderer(rotateImgIcon, 40, 40),
    });

    // 删除
    // 删除操作的 handler
    function deleteObjectHandler(_eventData: TPointerEvent, transform: Transform, _x: number, _y: number) {
        if (transform.action === 'rotate') return true;
        const activeObjects = canvas.getActiveObjects();
        if (activeObjects.length > 0) {
            activeObjects.forEach((obj) => canvas.remove(obj));
            canvas.requestRenderAll();
            canvas.discardActiveObject();
        }
        return true;
    }

    const deleteControlInstance = new Control({
        x: 0.5,
        y: -0.5,
        offsetY: -16,
        offsetX: 16,
        cursorStyle: 'pointer',
        mouseUpHandler: deleteObjectHandler,
        // 使用 control 定义的 24x24，而不是 fabricObject.cornerSize
        render: createIconRenderer(delImgIcon, 24, 24),
        sizeX: 24,
        sizeY: 24,
    });

    // 获取默认控件
    const ownDefaults = InteractiveFabricObject.ownDefaults;
    const controls = InteractiveFabricObject.ownDefaults.controls;

    // 设置全局样式
    InteractiveFabricObject.ownDefaults = {
        ...ownDefaults,
        transparentCorners: false,
        borderColor: '#51B9F9',
        cornerColor: '#FFF',
        borderScaleFactor: 2.5,
        cornerStyle: 'circle',
        cornerStrokeColor: '#0E98FC',
        borderOpacityWhenMoving: 1,
        controls: {
            ...controls,
            // 顶点
            tl: tlControl,
            bl: blControl,
            tr: trControl,
            br: brControl,
            // 中间
            ml: mlControl,
            mr: mrControl,
            mb: mbControl,
            mt: mtControl,
            // 旋转
            mtr: mtrControl,
            // 删除
            deleteControl: deleteControlInstance,
        },
    }
}

// Create custom controls for crop rectangle with confirm and delete buttons
export function createCropControls(
    onConfirm: (eventData: TPointerEvent, transform: Transform) => boolean,
    onDelete: (eventData: TPointerEvent, transform: Transform) => boolean
) {
    // Confirm button (green checkmark) - positioned to the left of delete button
    const confirmControl = new Control({
        x: 0.5,
        y: -0.5,
        offsetY: -16,
        offsetX: -8, // Position to the left of the delete button
        cursorStyle: 'pointer',
        mouseUpHandler: onConfirm,
        render: createIconRenderer(confirmImgIcon, 24, 24),
        sizeX: 24,
        sizeY: 24,
    });

    // Delete button (red X) - positioned at top right
    const deleteControl = new Control({
        x: 0.5,
        y: -0.5,
        offsetY: -16,
        offsetX: 16,
        cursorStyle: 'pointer',
        mouseUpHandler: onDelete,
        render: createIconRenderer(delImgIcon, 24, 24),
        sizeX: 24,
        sizeY: 24,
    });

    // Return controls object with standard resize controls plus confirm/delete
    return {
        // Corner controls for resizing
        tl: new Control({
            x: -0.5,
            y: -0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        tr: new Control({
            x: 0.5,
            y: -0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        bl: new Control({
            x: -0.5,
            y: 0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        br: new Control({
            x: 0.5,
            y: 0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        // Middle controls for resizing
        ml: new Control({
            x: -0.5,
            y: 0,
            offsetX: -1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingXOrSkewingY,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(verticalImgIcon, 20, 25),
        }),
        mr: new Control({
            x: 0.5,
            y: 0,
            offsetX: 1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingXOrSkewingY,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(verticalImgIcon, 20, 25),
        }),
        mt: new Control({
            x: 0,
            y: -0.5,
            offsetY: -1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingYOrSkewingX,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(horizontalImgIcon, 25, 20),
        }),
        mb: new Control({
            x: 0,
            y: 0.5,
            offsetY: 1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingYOrSkewingX,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(horizontalImgIcon, 25, 20),
        }),
        // Confirm and delete buttons
        confirmControl,
        deleteControl,
    };
}

export default initControls;

// Create custom controls for select canvas size rectangle with confirm and cancel buttons
export function createSelectCanvasSizeControls(
    onConfirm: (eventData: TPointerEvent, transform: Transform) => boolean,
    onCancel: (eventData: TPointerEvent, transform: Transform) => boolean
) {
    // Confirm button (green checkmark) - positioned to the left of cancel button
    const confirmControl = new Control({
        x: 0.5,
        y: -0.5,
        offsetY: -16,
        offsetX: -8, // Position to the left of the cancel button
        cursorStyle: 'pointer',
        mouseUpHandler: onConfirm,
        render: createIconRenderer(confirmImgIcon, 24, 24),
        sizeX: 24,
        sizeY: 24,
    });

    // Cancel button (red X) - positioned at top right
    const cancelControl = new Control({
        x: 0.5,
        y: -0.5,
        offsetY: -16,
        offsetX: 16,
        cursorStyle: 'pointer',
        mouseUpHandler: onCancel,
        render: createIconRenderer(delImgIcon, 24, 24),
        sizeX: 24,
        sizeY: 24,
    });

    // Return controls object with standard resize controls plus confirm/cancel
    return {
        // Corner controls for resizing
        tl: new Control({
            x: -0.5,
            y: -0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        tr: new Control({
            x: 0.5,
            y: -0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        bl: new Control({
            x: -0.5,
            y: 0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        br: new Control({
            x: 0.5,
            y: 0.5,
            cursorStyleHandler: controlsUtils.scaleCursorStyleHandler,
            actionHandler: scalingEquallyAlways,
            render: createIconRenderer(edgeImgIcon, 25, 25),
        }),
        // Middle controls for resizing
        mt: new Control({
            x: 0,
            y: -0.5,
            offsetY: -1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingYOrSkewingX,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(horizontalImgIcon, 25, 20),
        }),
        mb: new Control({
            x: 0,
            y: 0.5,
            offsetY: 1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingYOrSkewingX,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(horizontalImgIcon, 25, 20),
        }),
        ml: new Control({
            x: -0.5,
            y: 0,
            offsetX: -1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingXOrSkewingY,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(verticalImgIcon, 20, 25),
        }),
        mr: new Control({
            x: 0.5,
            y: 0,
            offsetX: 1,
            cursorStyleHandler: controlsUtils.scaleSkewCursorStyleHandler,
            actionHandler: controlsUtils.scalingXOrSkewingY,
            getActionName: controlsUtils.scaleOrSkewActionName,
            render: createIconRenderer(verticalImgIcon, 20, 25),
        }),
        // Confirm and cancel buttons
        confirmControl,
        cancelControl,
    };
}

