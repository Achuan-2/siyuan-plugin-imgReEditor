Plugin GitHub repository: [https://github.com/Achuan-2/siyuan-plugin-image-editor](https://github.com/Achuan-2/siyuan-plugin-image-editor)

<img alt="" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/canvas-20261010174206-eeg51rb.png" />

## 📝 Changelog

See [CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md).

## 📝 Development Background

When taking notes or writing blog posts, I often need to annotate and edit images. Although external tools such as the system image editor can handle these tasks, one problem has always bothered me: the edits cannot be modified after saving. Once an image has been cropped or annotated with shapes and text, I can only add new content on top of the saved image or replace it entirely. PowerPoint and Photoshop allow repeated editing, but they are cumbersome for simple edits to images in notes.

That's why I developed ImgReEditor. It provides basic image editing tools and lets you reopen saved images to modify their annotations and editing effects.

## How to Use

### Image Editing

Right-click an image and choose **ImgReEditor edit** to open the editor.

![17916233368471791623336790.png](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/canvas-20261010165301-4g4ivn9.png)

**Use it to:**  edit images, add annotations, and create image borders.

**Supported features:**

- **Basic image editing**

  - Crop images.
  - Flip images horizontally or vertically, and rotate them.
  - Add text.
  - Add rectangles and ellipses.
  - Add arrows.

    - Straight, elbow, and curved arrows.
    - Pointed and swallowtail arrowheads, with filled or outline styles.
  - Add numbered labels.
  - Draw with the brush tool.
  - Apply mosaic effects.
  - Add a magnifier.
  - Add image borders.

  Quickly add borders to give your images a polished look for blog posts. Adding rounded corners and borders to screenshots in your notes used to require a separate application.

  <img alt="1791623976781PixPin_2026-10-10_17-11-29-20261010171131-pe9sd3v.png" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-11-29-20261010171131-pe9sd3v.png" />

  Now you can create this effect with a single click in SiYuan!

  <img alt="1791623568773PixPin_2026-10-10_17-12-24.gif" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/1791623568773PixPin_2026-10-10_17-12-24.gif" />
- **Re-editing saved images**

  - Reopen a saved image to modify the edits and annotations you previously added. You no longer need to recreate an image or use PowerPoint or Photoshop just to update an illustration in your notes.

  ![1791624011968动图.gif](https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/1791624011968%E5%8A%A8%E5%9B%BE.gif)

### Canvas Mode

Type `/canvas` in the slash menu and choose **Create canvas (ImgReEditor)**  to open canvas mode. You can add multiple images to the canvas; the image shown above was also created with this plugin. Canvas mode can serve as a simple alternative to PowerPoint for creating collages, article covers, and similar layouts.

<img alt="PixPin_2026-10-10_17-20-29" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-20-29-20261010172035-46ab7mz.png" />

<img alt="PixPin_2026-10-10_17-22-15" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-22-15-20261010172218-yk3qkp1.png" />

**Canvas mode features:**

- Adjust the canvas width and height.
- Set a background color, including gradients.
- Insert multiple images.
- Align and distribute objects.
- Change the stacking order of selected shapes and group them.

<img alt="PixPin_2026-10-10_17-25-09" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-25-09-20261010172816-2sux8lc.png" />

<img alt="PixPin_2026-10-10_17-30-21" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-30-21-20261010173031-3bejyc6.png" />

### Screenshots

Press `Ctrl+~` to take a screenshot. After capturing it, you can pin it on screen and browse your screenshot history.

<img alt="PixPin_2026-10-10_17-47-40" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed@pic/assets/PixPin_2026-10-10_17-47-40-20261010174751-0fni4t7.png" />

The plugin also adds buttons to SiYuan's top bar for taking screenshots and browsing screenshot history.

### Image Compression

Compress PNG, JPG/JPEG, and WebP images to reduce the space used by attachments in your notes. The plugin offers several ways to compress images:

- **Compress a single image**: Right-click an image and choose **Compress image**.
- **Batch compress document images**: Open the document title icon menu and choose **Batch compress document images** to process images in the current document.
- **Compress all asset images**: In the plugin's **Compression** settings, click **Compress all images** to process images in `data/assets` and its subfolders. This preserves formats, filenames, and note references regardless of the WebP conversion setting. Unchanged images already processed with the same settings are skipped automatically.
- **Automatically compress on save**: Compress images when saving edits. Enabled by default; you can turn it off in settings.
- **Automatically compress pasted or dropped images**: Enable **Compress pasted images** in settings to insert the original image first, then compress it in the background while you continue editing your notes. Disabled by default. You can separately turn off notifications showing file size changes after successful compression.

The **Compression** settings let you choose lossless or lossy PNG compression, adjust JPG/JPEG and WebP quality, and enable PNG/JPG conversion to WebP. PNG compression is lossless by default, and the default WebP quality is 100 (lossless).

Manual compression, batch compression, and automatic paste/drop compression use the result only if it is smaller; otherwise, the original image is kept. Same-format compression preserves the filename and link. WebP conversion changes only the extension and updates the corresponding image references. Saving edits follows the WebP conversion setting when choosing the output format.

## Usage Tips

**Common keyboard shortcuts**

- **Esc**: Deselect.

  - Deselect a selected shape.
  - When editing text, press Esc to select the text object so you can move it. Press Esc again to deselect it.
- **Ctrl+C / Ctrl+V**: Copy / Paste.
- **Ctrl+Z / Ctrl+Y**: Undo / Redo.

**Quickly select objects while using the rectangle, arrow, or text tools**

- These tools normally create new objects when you click. Although you can also click an existing object to select it, missing the object may accidentally create a new one. Hold **Ctrl** to temporarily switch to selection mode, so clicks only select objects. You can also select multiple objects to change their styles together or align them.
- The text tool follows Adobe Illustrator's interaction: hold **Ctrl** and drag to move the text object. If you do not drag, you can continue editing the text, so **Ctrl+C / Ctrl+V** still works for copying and pasting text.

**Resizing and rotating selected shapes**

- Once a shape is selected, you can resize or rotate it. A rotation handle appears below the selection box, and hovering over any of its four corners also provides a rotation control.
- Hold **Shift** while rotating to snap to multiples of 45°.

## Settings

Choose how to store image editing data:

- **Embed mode**: Stores editing data directly in the image, so it stays with the image even when you share it with others. This increases the image file size.
- **Backup mode**: Stores editing data in the `backup` folder to keep the image file smaller. When you no longer need to re-edit an image, you can delete its JSON file from that folder.

## Important Notes About Data Storage

- **Embed mode**: Editing data is stored inside the image and is retained during normal use. However, processing the image with external tools, such as image compression software, may remove this data and prevent further editing of the original objects.
- **Backup mode**:

  - Deleting the JSON files in the `backup` folder prevents you from re-editing images saved in this mode with their original editing data.
  - Processing saved images with external tools, such as compression software, may also break the link to their backup JSON files and prevent re-editing.

## 📄 License

AGPL v3.0 License

## 🙏 Acknowledgments

- Developed based on the [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) template.
- The image editor is built with [Fabric.js v6](https://github.com/oyjt/interactive-whiteboard).
- The color picker uses [svelte-awesome-color-picker](https://github.com/Ennoriel/svelte-awesome-color-picker).
- The Fabric.js arrow drawing and shape control implementations reference [oyjt/interactive-whiteboard](https://github.com/oyjt/interactive-whiteboard).

## ❤️ Buy me a coffee

If you find this plugin useful, you're welcome to buy me a coffee. Your support helps me maintain and improve this plugin and develop new ones.

[Buy me a coffee](https://pancake.waffo.ai/store/achuan-2-fdbho4ye/product/PROD_3F7Aa7c2NQlz9KmxcgxjQ7?type=onetime&currency=USD)
