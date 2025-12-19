import { Rect, classRegistry } from 'fabric';

class SelectCanvasSizeRect extends Rect {
    static type = 'select-canvas-size-rect';

    // Explicitly set the instance type property to match
    // This ensures obj.type returns 'select-canvas-size-rect' immediately
    constructor(options: any) {
        super(options);
    }

    // Method to set custom controls
    setCustomControls(controls: any) {
        this.controls = controls;
        return this;
    }
}

// Register the class in Fabric's registry so fromJSON/toJSON works if needed
// and so it's a first-class citizen
classRegistry.setClass(SelectCanvasSizeRect, 'select-canvas-size-rect');

export default SelectCanvasSizeRect;