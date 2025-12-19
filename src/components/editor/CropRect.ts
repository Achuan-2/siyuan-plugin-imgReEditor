import { Rect, classRegistry } from 'fabric';

class CropRect extends Rect {
    static type = 'crop-rect';

    // Explicitly set the instance type property to match
    // This ensures obj.type returns 'crop-rect' immediately
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
classRegistry.setClass(CropRect, 'crop-rect');

export default CropRect;

