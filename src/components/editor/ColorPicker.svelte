<script lang="ts">
    import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
    import ColorPicker from 'svelte-awesome-color-picker';

    export let value: string | null = '#ff0000';
    export let colorKey: string = 'default'; // unique key for this color picker to store recent colors
    export let recentColors: Record<string, string[]> = {}; // passed from parent, keyed by colorKey
    export let maxRecent: number = 8;

    const dispatch = createEventDispatcher();

    let showPopup = false;
    let showAwesomePicker = false;
    let containerEl: HTMLElement | null = null;
    let popupStyle = { top: 0, left: 0 };
    const uid = `colorpicker-${Math.random().toString(36).slice(2)}`;

    function onExternalOpen(e: Event) {
        try {
            const id = (e as CustomEvent).detail;
            if (id !== uid) {
                showPopup = false;
            }
        } catch (err) {
            // ignore
        }
    }

    // Default color palette
    const defaultColors = [
        '#ff0000',
        '#ff6600',
        '#ffcc00',
        '#33cc33',
        '#00ccff',
        '#0066ff',
        '#9933ff',
        '#ff33cc',
        '#ffffff',
        '#cccccc',
        '#666666',
        '#000000',
    ];

    // Get recent colors for this picker
    $: myRecentColors = (recentColors && recentColors[colorKey]) || [];

    $: displayValue = value || '#ff0000';

    function selectColor(color: string) {
        if (!color || typeof color !== 'string') return;
        value = color;
        dispatch('change', color);
        addToRecent(color);
        showPopup = false;
    }

    async function updatePopupPosition() {
        if (!containerEl) return;
        await tick();
        const popupEl = document.querySelector('.color-popup') as HTMLElement | null;
        if (!popupEl) return;

        const rect = containerEl.getBoundingClientRect();
        const popupRect = popupEl.getBoundingClientRect();

        let top = rect.bottom + 6; // default below the button
        let left = rect.left; // align left by default

        // constrain within window by default
        if (left + popupRect.width > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - popupRect.width - 8);
        }

        // If there is a right-side tool sidebar, keep popup inside its right edge
        try {
            const sidebarEl = document.querySelector('.tool-sidebar') as HTMLElement | null;
            if (sidebarEl) {
                const sidebarRect = sidebarEl.getBoundingClientRect();
                const maxRight = sidebarRect.right - 8; // keep a small margin
                if (left + popupRect.width > maxRight) {
                    left = Math.max(sidebarRect.left + 8, maxRight - popupRect.width);
                }
                // also ensure not placed left of the sidebar
                if (left < sidebarRect.left + 8) {
                    left = sidebarRect.left + 8;
                }
            }
        } catch (e) {
            // ignore DOM read errors
        }

        // If popup would overflow bottom edge, show above the button
        if (top + popupRect.height > window.innerHeight - 8) {
            top = rect.top - popupRect.height - 6;
        }

        popupStyle = { top, left };
    }

    const isSameColor = (c1: any, c2: any) => {
        if (!c1 || !c2 || typeof c1 !== 'string' || typeof c2 !== 'string') return c1 === c2;
        return c1.toLowerCase() === c2.toLowerCase();
    };

    function addToRecent(color: string) {
        if (!color || typeof color !== 'string') return;
        // Normalize color to lowercase
        const normalizedColor = color.toLowerCase();

        // Get current recent colors for this key
        let recent = [...(myRecentColors || [])];

        // Remove if already exists
        recent = recent.filter(c => typeof c === 'string' && c.toLowerCase() !== normalizedColor);

        // Add to front
        recent.unshift(normalizedColor);

        // Limit to max
        if (recent.length > maxRecent) {
            recent = recent.slice(0, maxRecent);
        }

        // Dispatch event to save
        dispatch('recentUpdate', { colorKey, colors: recent });
    }

    function openNativePicker() {
        showAwesomePicker = true;
    }

    function handleClickOutside(e: MouseEvent) {
        const target = e.target as HTMLElement;
        // allow clicks inside the picker or awesome popup
        if (
            !target.closest('.color-picker-container') &&
            !target.closest('.color-popup') &&
            !target.closest('.awesome-popup')
        ) {
            addToRecent(value);
            showPopup = false;
            showAwesomePicker = false;
        }
    }

    onMount(() => {
        document.addEventListener('click', handleClickOutside);
        window.addEventListener('resize', updatePopupPosition);
        // use capture so scroll events from ancestors are caught
        window.addEventListener('scroll', updatePopupPosition, true);
        // listen for other pickers opening so we can close
        document.addEventListener('colorpicker-open', onExternalOpen as EventListener);
        return () => {
            document.removeEventListener('click', handleClickOutside);
            window.removeEventListener('resize', updatePopupPosition);
            window.removeEventListener('scroll', updatePopupPosition, true);
            document.removeEventListener('colorpicker-open', onExternalOpen as EventListener);
        };
    });

    onDestroy(() => {
        // ensure cleanup if needed
        document.removeEventListener('colorpicker-open', onExternalOpen as EventListener);
    });
</script>

<div class="color-picker-container" bind:this={containerEl}>
    <button
        class="color-preview"
        style="background-color: {displayValue};"
        on:click|stopPropagation={() => {
            showPopup = !showPopup;
            if (showPopup) {
                // notify other pickers to close
                document.dispatchEvent(new CustomEvent('colorpicker-open', { detail: uid }));
                updatePopupPosition();
            }
        }}
        title="Select color"
    >
        <span class="color-indicator"></span>
    </button>

    {#if showPopup}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
            class="color-popup"
            on:click|stopPropagation
            style="top: {popupStyle.top}px; left: {popupStyle.left}px;"
        >
            {#if myRecentColors.length > 0}
                <div class="color-section">
                    <div class="section-title">Recently used</div>
                    <div class="color-grid recent">
                        {#each myRecentColors as color}
                            <button
                                class="color-swatch"
                                class:selected={isSameColor(displayValue, color)}
                                style="background-color: {color};"
                                on:click={() => selectColor(color)}
                                title={color}
                            ></button>
                        {/each}
                    </div>
                </div>
            {/if}

            <div class="color-section">
                <div class="section-title">Default colors</div>
                <div class="color-grid default">
                    {#each defaultColors as color}
                        <button
                            class="color-swatch"
                            class:selected={isSameColor(displayValue, color)}
                            style="background-color: {color};"
                            on:click={() => selectColor(color)}
                            title={color}
                        ></button>
                    {/each}
                </div>
            </div>

            <div class="color-section more">
                <button class="more-colors-btn" on:click={openNativePicker}>
                    <span class="rainbow-icon">🎨</span>
                    More colors...
                </button>
            </div>
        </div>
    {/if}

    <!-- native input removed, using svelte-awesome-color-picker -->
</div>

{#if showAwesomePicker}
    <div class="awesome-popup">
        <button
            class="close-btn"
            on:click={() => {
                addToRecent(value);
                showAwesomePicker = false;
            }}
            title="Close"
        >
            ×
        </button>
        <ColorPicker
            isDialog={false}
            isAlpha={false}
            bind:hex={value}
            on:input={e => {
                dispatch('change', e.detail.hex);
            }}
        />
    </div>
{/if}

<style>
    .color-picker-container {
        position: relative;
        display: inline-block;
    }

    .color-preview {
        width: 32px;
        height: 24px;
        border: 1px solid #ccc;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px;
        background-clip: content-box;
        transition: border-color 0.15s;
    }

    .color-preview:hover {
        border-color: #888;
    }

    .color-indicator {
        display: block;
        width: 100%;
        height: 100%;
    }

    .color-popup {
        position: fixed;
        z-index: 10001;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        padding: 8px;
        min-width: 180px;
        margin: 0;
    }

    .color-section {
        margin-bottom: 8px;
    }

    .color-section:last-child {
        margin-bottom: 0;
    }

    .section-title {
        font-size: 11px;
        color: #888;
        margin-bottom: 4px;
        font-weight: 500;
    }

    .color-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 4px;
    }

    .color-grid.default {
        grid-template-columns: repeat(4, 1fr);
    }

    .color-swatch {
        width: 20px;
        height: 20px;
        border: 1px solid #ddd;
        border-radius: 3px;
        cursor: pointer;
        padding: 0;
        transition:
            transform 0.1s,
            box-shadow 0.1s;
    }

    .color-swatch:hover {
        transform: scale(1.15);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
        z-index: 1;
    }

    .color-swatch.selected {
        border: 2px solid var(--b3-theme-primary, #1976d2);
        box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.3);
    }

    .more-colors-btn {
        width: 100%;
        padding: 6px 8px;
        border: 1px dashed #ccc;
        border-radius: 4px;
        background: #fafafa;
        cursor: pointer;
        font-size: 12px;
        color: #555;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        transition:
            background 0.15s,
            border-color 0.15s;
    }

    .more-colors-btn:hover {
        background: #f0f0f0;
        border-color: #999;
    }

    .rainbow-icon {
        font-size: 14px;
    }

    .awesome-popup {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10000;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .close-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 16px;
        color: #666;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background 0.15s;
    }

    .close-btn:hover {
        background: #f0f0f0;
    }
</style>
