# ChordTag

ChordTag 是一个纯前端和弦时间轴标注工作台。它将振幅/频谱、节拍网格、速度与拍号变化及和弦片段放在同一时间坐标系中，适合制作可交换的音乐和声数据。

## 功能

- 本地导入音频，使用 Web Audio API 生成振幅和对数频谱视图
- 空项目启动，不预置演示音频或和弦进行
- 时间轴平移、以指针为锚点缩放、播放头定位与吸附网格
- 每小节可切换 BPM 和拍号，可调整第一拍相对音频的偏移
- 拖动和弦、更改起止时间、切分、删除、撤销与重做
- 直接读取 Tonal `ChordType.all()` 的完整和弦性质库，覆盖基础、七和弦、延伸与变化和弦，并支持斜线低音、调性与罗马数字分析
- Tonal 驱动的和弦构成音与级数解析
- ChordTag Annotation Standard 1.0 JSON 导出
- 响应式 Material Design 3 风格界面与本地自动保存

## ChordTag Annotation Standard 1.0

标准使用绝对秒数作为无损交换坐标，并同时保留音乐时间信息：

- `timeline.firstBeatOffset` 定义音频开头到第 1 小节第 1 拍的秒数。
- `timeline.tempoMap` 只在小节边界创建段落；每段包含起始秒、小节号、BPM、拍子分子和分母。
- `annotations[].start/end` 为半开区间 `[start, end)`，避免相邻和弦边界重叠。
- `symbol` 为可显示和弦名；`root/quality/bass` 是规范化、可计算的字段。
- `romanNumeral` 是相对 `musicalContext` 的派生值，`confidence` 范围为 0–1。
- 所有时间值以秒为单位，建议输出到小数点后六位；数组按 `start` 升序排列。

完整的 JSON Schema 位于 [`public/chordtag-annotation.schema.json`](public/chordtag-annotation.schema.json)。

## 本地开发

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## GitHub Pages

合并到 `main` 后，`deploy-pages.yml` 会构建并发布 `dist`。首次发布前，请在仓库的 **Settings → Pages → Build and deployment** 中选择 **GitHub Actions**。

# chordtag
