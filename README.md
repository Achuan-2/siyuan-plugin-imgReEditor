插件 Github 地址：[https://github.com/Achuan-2/siyuan-plugin-image-editor](https://github.com/Achuan-2/siyuan-plugin-image-editor)

<img alt="" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/canvas-20251222150947-bnrki1b.png" />

## 📝更新日志

见[CHANGELOG.md](https://cdn.jsdelivr.net/gh/Achuan-2/siyuan-plugin-imgReEditor@main/CHANGELOG.md)

## 开发背景

写笔记写博客，常常需要对图片进行标注、编辑。虽然能用系统图片编辑器等外部软件编辑图片，但一直有一个痛点，那就是编辑的图片无法进行二次编辑。过去对图片进行裁剪、添加形状和文字，保存完图片之后就无法再修改原来的操作，只能在原有图片上再添加新内容，要么就直接替换新图片，这就给修改操作带来很大麻烦。（PPT、Photoshop虽然可以重复编辑，但是只是简单编辑笔记里的图片用它们太麻烦了）

于是，我开发了 ImgReEditor 这个插件，不仅仅实现了基础的图片编辑功能，还终于实现了保存的图片还能反复修改图片标注和编辑效果。

一开始是调用 tui.image-editor 这个开源编辑器，但是后来发现不方便修改，想要让裁剪能二次修改、还想添加序号、马赛克工具都很麻烦。于是就让ai使用 fabric.js 从无到有自己写了一个图片编辑器

## 如何使用

**图片编辑模式**：图片右键菜单选择「ImgReEditor 编辑」按钮打开 ImgReEditor 编辑器

<img alt="" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/canvas-20260111165115-aexapt2.png" />

**画布模式**：斜杆菜单输入 `/画布` 可以开启画布模式，在画布添加多个图片，比如上面的图片就是插件绘制的。可以简单替代PPT，用于制作拼图、制作文章封面等需求。

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20251219182552-59o8aso.png" />

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20260113101553-ecn9d05.png" />

**截图**：`Ctrl+~`进行截图，截图后可以贴图、回顾截图历史

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20260115165131-x52yv3x.png" style="width: 842px;" />

思源笔记顶栏添加了「截图」和「浏览历史截图功能」

<img alt="" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/canvas-20260115165419-7hl7uwo.png" style="width: 868px;" />



## 功能介绍

### 编辑功能

**用途**：编辑图片、标注图片、制作图片边框

在思源笔记中编辑图片，支持：

- **图片基础编辑功能**

  - 支持裁剪图片
  - 支持水平/垂直翻转、旋转图片
  - 添加文字
  - 添加矩形椭圆
  - 添加箭头
  - 添加数字序号
  - 添加画笔
  - 添加马赛克
  - 添加图片边框

  <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20260111170558-yzu6obf.png" />

  插件支持快速添加图片边框，把图改为精致的博客风格，如果你想要给笔记里的截图添加圆角 + 边框效果，过去要使用专门的软件才能做到

  <img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20251220233534-36afikv.png" />

  现在只需要在思源笔记里点击一下就可以创建这样的图了！

  <img alt="图片背景色" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/图片背景色-20251221001912-87u1v2p.gif" />
- **图片再编辑功能**

  - 保存的图片支持再编辑过去添加的图片修改和标注内容，再也不用重新做一张图，或者给笔记添加一张示意图还要折腾PPT、PS了

  <img alt="图片编辑器反复编辑" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/图片编辑器反复编辑-20260114220426-j3j9o7q.gif" />

### **画布模式**

**用途**：用于制作拼图、制作文章封面等需求。

**画布模式具备功能**

- 调节画布宽度和高度
- 设置背景色，支持设置渐变色
- 支持插入多张图片
- 具有对齐、分布功能
- 选中形状可以进行图层排列、组合操作

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20260113102430-w6vldff.png" />

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20260113102834-pk8f89m.png" />

## 使用细节

**常用快捷键**

- Esc：取消选中

  - 选中形状后取消选中；
  - 编辑文字后按 Esc 可变为选中状态进行移动，再按 Esc 则取消选中
- Ctrl+C/Ctrl+V：复制/粘贴
- Ctrl+Z/Ctrl+Y：撤回/重做

**矩形、箭头、文字等工具如何快速进入选择对象状态**

- 这些工具直接点击的话是新增对象状态，虽然也支持点击选择当前已有的对象，但是没点到的话就容易误增加对象，一个技巧是，按住Ctrl即可快速进入选择状态，只能选择对象，不会再误添加对象，并且支持多选对象进行批量设置样式和对齐等操作
- 文字工具参考了Adobe illustrator交互，按Ctrl可以拖动，不拖动还可以继续编辑，这样不影响Ctrl+C/Ctrl+V复制粘贴文字

**选中形状后，可以对形状进行拉伸和旋转，旋转技巧**

- 旋转按钮：选中形状的选框正下方有旋转按钮，四个角鼠标悬浮也会显示旋转按钮，可以进行调整形状角度
- 按住shift进行拖动，会吸附到 45° 倍数

<img alt="image" src="https://assets.b3logfile.com/siyuan/1610205759005/assets/image-20251220002536-h5obek8.png" style="width: 311px;" />

## 设置

- 设置图片编辑数据存储方式

  - Embed 存储模式：直接存储在当前图片里，图片永久存储编辑历史，不怕编辑历史丢失，图片发送给别人也能保留编辑数据，缺点是图片体积会变大
  - Backup 存储模式：存储在 backup 文件夹，减少图片体积，当不需要存储编辑数据再编辑图片时，可以把 backup 里的 json 文件直接删除

## 关于数据存储的注意事项

- Embed 存储模式：

  - 编辑数据存储在图片里，正常使用不会丢失，但是需要注意使用图片压缩等外部软件处理图片后可能会导致数据丢失，无法二次编辑
- Backup 模式：

  - 删除 backup 文件夹里的 json 文件，将无法二次编辑 backup 模式下编辑保存的图片
  - 保存的图片经过外部软件压缩等处理之后，也可能会丢失与 backup 里的 json 的链接关系，无法二次编辑

## 博客

- 文章

  - [思源笔记插件 ImgReEditor：图片编辑保存还可再编辑，让思源笔记成为你的图文笔记神器](https://zhuanlan.zhihu.com/p/1985459256305152111)
  - [思源笔记插件 ImgReEditor：一键添加图片背景色、边框、圆角，生成精美博客图片](https://zhuanlan.zhihu.com/p/1985856269366611979)
  - [在思源笔记里也能直接制作文章封面啦](https://zhuanlan.zhihu.com/p/1986456451837862115)
- 视频

  - [思源笔记插件 ImgReEditor：图片编辑保存还可再编辑，让思源笔记成为你的图文笔记神器](https://www.bilibili.com/video/BV11wBFBvEn8)

## 📄 许可证

AGPL v3.0 License

## 🔧 如何打包插件

```bash
pnpm install
pnpm run dev
```

## 🙏 致谢

- 基于 [plugin-sample-vite-svelte](https://github.com/siyuan-note/plugin-sample-vite-svelte/) 模板开发
- 图片编辑器基于[fabric.js v6](https://github.com/oyjt/interactive-whiteboard)开发
- Colorpicker组件调用了[svelte-awesome-color-picker](https://github.com/Ennoriel/svelte-awesome-color-picker)
- 参考了 [oyjt/interactive-whiteboard](https://github.com/oyjt/interactive-whiteboard) 的fabric的箭头绘制和形状控件实现

## ❤️用爱发电

如果喜欢我的插件，欢迎给GitHub仓库点star和微信赞赏，这会激励我继续完善此插件和开发新插件。

维护插件费时费力，个人时间和精力有限，开源只是分享，不等于我要浪费我的时间免费帮用户实现ta需要的功能，

我需要的功能我会慢慢改进（打赏可以催更），有些我觉得可以改进、但是现阶段不必要的功能需要打赏才改进（会标注打赏标签和需要打赏金额），而不需要的功能、实现很麻烦的功能会直接关闭issue不考虑实现

累积赞赏50元的朋友如果想加我微信和进我的粉丝交流群，可以在赞赏的时候备注微信号，或者发邮件到[achuan-2@outlook.com](mailto:achuan-2@outlook.com)来进行好友申请

<img alt="image" src="https://fastly.jsdelivr.net/gh/Achuan-2/PicBed/assets/20241128221208-2024-11-28.png" />
