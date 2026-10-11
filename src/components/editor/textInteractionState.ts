const isText = (object: any) => ['text', 'i-text', 'textbox'].includes(object?.type);

/** Fabric temporarily disables controls/movement while editing; persist the pre-edit values. */
export function installTextInteractionSerializer(text: any) {
    if (!isText(text) || text.__imgReEditorInteractionSerializer) return;
    text.__imgReEditorInteractionSerializer = true;
    const toObject = text.toObject;
    text.toObject = function (...args: any[]) {
        const data = toObject.apply(this, args);
        if (this.isEditing && this._savedProps) {
            for (const key of ['hasControls', 'selectable', 'lockMovementX', 'lockMovementY']) {
                if (typeof this._savedProps[key] === 'boolean') data[key] = this._savedProps[key];
            }
        }
        return data;
    };
}

/** Repair legacy snapshots saved in editing mode, without unlocking normally locked objects. */
export function restoreTextInteractionState(object: any) {
    if (isText(object) && !object.isEditing && object.hasControls === false &&
        object.lockMovementX === true && object.lockMovementY === true &&
        object.lockRotation === false && object.lockScalingX === false && object.lockScalingY === false) {
        object.set({ hasControls: true, lockMovementX: false, lockMovementY: false });
        object.setCoords();
    }
    object?.getObjects?.().forEach(restoreTextInteractionState);
}
