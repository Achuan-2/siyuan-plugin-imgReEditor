<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import ColorPicker from './ColorPicker.svelte';

    export let value: string = 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)';
    export let recentColors: Record<string, string[]> = {};
    export let savedGradients: string[] = [];

    const dispatch = createEventDispatcher();

    let angle = 135;
    let color1 = '#f5f7fa';
    let color2 = '#c3cfe2';

    // Parse initial value if possible
    $: {
        const match = value.match(
            /linear-gradient\((\d+)deg,\s*(#[a-fA-F0-9]{3,6})\s+0%,\s*(#[a-fA-F0-9]{3,6})\s+100%\)/i
        );
        if (match) {
            angle = parseInt(match[1]);
            color1 = match[2];
            color2 = match[3];
        }
    }

    function update() {
        const newValue = `linear-gradient(${angle}deg, ${color1} 0%, ${color2} 100%)`;
        dispatch('change', newValue);
    }

    function handleAngleInput(e: Event) {
        angle = parseInt((e.target as HTMLInputElement).value);
        update();
    }

    function handleColor1(e: CustomEvent) {
        color1 = e.detail;
        update();
    }

    function handleColor2(e: CustomEvent) {
        color2 = e.detail;
        update();
    }

    function saveCurrent() {
        const newValue = `linear-gradient(${angle}deg, ${color1} 0%, ${color2} 100%)`;
        if (savedGradients.includes(newValue)) return;
        const newSaved = [...savedGradients, newValue];
        dispatch('updateSavedGradients', newSaved);
    }
</script>

<div class="gradient-designer">
    <div
        class="preview-box"
        style="background: linear-gradient({angle}deg, {color1} 0%, {color2} 100%)"
    ></div>

    <div class="controls">
        <div class="control-row">
            <label for="grad-angle">角度</label>
            <input
                id="grad-angle"
                type="range"
                min="0"
                max="360"
                value={angle}
                on:input={handleAngleInput}
            />
            <span class="val">{angle}°</span>
        </div>

        <div class="control-row">
            <span class="label">颜色 1</span>
            <ColorPicker
                value={color1}
                {recentColors}
                colorKey="gradient-c1"
                on:change={handleColor1}
                on:recentUpdate
            />
        </div>

        <div class="control-row">
            <span class="label">颜色 2</span>
            <ColorPicker
                value={color2}
                {recentColors}
                colorKey="gradient-c2"
                on:change={handleColor2}
                on:recentUpdate
            />
        </div>
    </div>

    <div class="actions">
        <button class="save-btn" on:click={saveCurrent}>保存渐变</button>
    </div>
</div>

<style>
    .gradient-designer {
        padding: 12px;
        background: #fcfcfc;
        border-radius: 10px;
        border: 1px solid #eee;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    .preview-box {
        width: 100%;
        height: 60px;
        border-radius: 6px;
        border: 1px solid #ddd;
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
    }
    .controls {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .control-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .control-row label,
    .control-row .label {
        width: 50px;
        font-size: 12px;
        color: #666;
    }
    .val {
        font-size: 11px;
        color: #888;
        width: 35px;
        text-align: right;
    }
    input[type='range'] {
        flex: 1;
        height: 4px;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
    }
    .save-btn {
        padding: 4px 10px;
        background: var(--b3-theme-primary, #1976d2);
        color: #fff;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
    }
    .save-btn:hover {
        background: var(--b3-theme-primary-light, #42a5f5);
    }
</style>
