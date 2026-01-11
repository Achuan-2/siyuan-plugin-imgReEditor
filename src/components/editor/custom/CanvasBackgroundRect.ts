import { Rect, classRegistry } from 'fabric';

/**
 * CanvasBackgroundRect - A custom rectangle for canvas background in canvas mode
 */
export default class CanvasBackgroundRect extends Rect {
    static type = 'canvas-background';
    _isCanvasBackground: boolean = true;
    constructor(options?: any) {
        super(options);
        this._isCanvasBackground = true;
    }

    /**
     * Static method for creating from object (for deserialization)
     */
    static fromObject(object: any): Promise<CanvasBackgroundRect> {
        return Promise.resolve(new CanvasBackgroundRect(object));
    }
}

// Register the class
classRegistry.setClass(CanvasBackgroundRect, 'canvas-background');