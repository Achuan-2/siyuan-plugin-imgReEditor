## 📝 Changelog

See [CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md)

## Development Background

When taking notes or writing blog posts, there is often a need to annotate and edit images. A persistent pain point has been the inability to re-edit images after they have been edited. In the past, after cropping an image, adding shapes and text, and saving it, the original edits could no longer be modified. You could only add new content on top of the existing image or replace it entirely with a new one, which made modifications very troublesome.

Therefore, I developed the ImgReEditor plugin, finally achieving the ability to re-edit images that have already been edited.


## Features

Edit images within SiYuan Notes, supporting:

-   Crop, flip images, add text, add rectangles/ellipses, add arrows, add numbered labels, brush tool, and other functions.
-   Saved PNG images support re-editing of modifications and annotations added by the plugin.

![](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20251219121902-2025-12-19.png)

**Keyboard Shortcuts**
-   **Esc**:
    -   Deselect a selected shape.
    -   After editing text, press Esc to switch to selection mode for moving; press Esc again to deselect.
-   **Ctrl+C / Ctrl+V**: Copy / Paste
-   **Ctrl+Z / Ctrl+Y**: Undo / Redo

## Settings

-   **Edit Data Storage Method**
    -   **Store directly within the current image**: Permanently stores edit history within the image. Protects against loss of edit history, and edit data is retained even when the image is shared with others. The downside is that the image file size increases.
    -   **Store in the backup folder**: Reduces image file size. When you no longer need to store edit data for re-editing, you can simply delete the JSON files in the backup folder.

## 📄 License

AGPL v3.0 License

## 🔧 Development

```bash
pnpm install
pnpm run dev
```

## 🙏 Acknowledgments

-   Developed based on the [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) template.
-   Referenced the Fabric arrow drawing and shape control implementation from [oyjt/interactive-whiteboard](https://github.com/oyjt/interactive-whiteboard).

## ❤️ Tips Are Welcome

If you find this plugin useful, you're welcome to leave a tip or give the repository a star on GitHub. Your support helps me maintain and improve this plugin and develop new ones. Thank you for your support!

[Leave a tip](https://pancake.waffo.ai/store/achuan-2-fdbho4ye/product/PROD_3F7Aa7c2NQlz9KmxcgxjQ7?type=onetime&currency=USD)
