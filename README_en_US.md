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

## ❤️ Powered by Passion

If you like my plugin, feel free to give a star on the GitHub repository or send a WeChat appreciation. This will motivate me to continue improving this plugin and developing new ones.

Maintaining plugins is time-consuming and effort-intensive. Personal time and energy are limited. Open source is about sharing, not about me wasting my time implementing features for users for free.

I will gradually improve features *I* need (appreciations can nudge me along). Some features I think could be improved but aren't currently necessary will require an appreciation to implement (marked with a "sponsor" tag and required amount). Features I don't need or that are very troublesome to implement will have their issues closed and won't be considered.

Friends who have accumulated appreciations totaling 50 RMB and wish to add me on WeChat can send an email to <span data-type="a" data-href="mailto:achuan-2@outlook.com">achuan-2@outlook.com</span> to request a friend add (I will not reply to emails or add friends from those whose appreciations do not reach 50 RMB, as I do not wish to be a free customer service representative).

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />
