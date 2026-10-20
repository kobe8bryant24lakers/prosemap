# 绘图工具交互参考

查阅日期：2026-10-19。以下产品行为来自官方文档；落地建议是针对 ProseMap 的工程判断，不表示已实现所有同类工具功能，也不构成性能对比结果。

## 已核实的产品行为

| 主题 | 官方做法 | 参考 |
| --- | --- | --- |
| 平移 | draw.io 支持空格、中键、右键拖动；触控板双指滚动；Shift+滚轮水平滚动 | [Pan and scroll](https://www.drawio.com/docs/manual/editor/pan-scroll/) |
| 缩放 | draw.io 支持工具栏、触控板捏合及 Ctrl+滚轮，并可设置滚轮默认平移或缩放 | [Change the zoom level](https://www.drawio.com/docs/manual/editor/zoom/) |
| 框选 | draw.io 普通框选选择完整包含的对象，Alt 框选选择相交对象；Shift/Ctrl 点击和框选支持切换选中状态 | [Select shapes and connectors](https://www.drawio.com/docs/reference/shortcuts/shortcut-select/) |
| 插入 | draw.io 支持点击形状库插入中央、拖到指定位置插入，以及方向箭头快捷创建邻居 | [Work with shapes](https://www.drawio.com/docs/manual/shapes/) |
| 连接 | draw.io 从方向箭头拖出连接，目标高亮后松手连接；区分沿外轮廓移动的浮动连接与固定锚点 | [Work with connectors](https://www.drawio.com/docs/manual/connectors/) |
| 快捷创建 | draw.io 支持 Ctrl/Cmd+拖动克隆，Alt+Shift+方向键克隆并连接 | [Modifier shortcuts](https://www.drawio.com/docs/reference/shortcuts/modifier-shortcuts-in-diagrams/)、[Connect shapes quickly](https://www.drawio.com/docs/manual/connectors/connect-shapes/) |
| 吸附 | draw.io 提供网格、边缘、中心线对齐；Alt 可临时绕过吸附，Shift+方向键按网格步进移动 | [Alignment tools](https://www.drawio.com/docs/manual/editor/alignment-tools/) |
| 撤销与取消 | tldraw 把一次复杂交互合并为一个历史单元；取消操作可回滚到开始标记且不留下重做项 | [History](https://tldraw.dev/sdk-features/history) |
| 相机 | tldraw 明确区分屏幕与画布坐标，支持向指定屏幕点缩放、适配全部和选区；用户操作优先于相机动画 | [Camera system](https://tldraw.dev/sdk-features/camera) |

## 对 ProseMap 的落地判断

优先保持跨图种一致的选择、平移、取消、吸附和撤销规则；图种语义限制应主要约束改变关系的操作。触控板优先使用双指平移和捏合缩放，不应只为模仿鼠标滚轮默认行为改变用户习惯。

插入、单个复制、批量复制、用例参与者等入口应共用放置与显示策略，防止一个入口寻找空位而另一个入口将对象放到屏幕外。连接应明确显示可用目标和成功结果，并能一步撤销。精确定位要求所有计算基于同一套屏幕/画布坐标；低缩放时控制点应保留可点击的屏幕面积。

源码编辑是另一个编辑表面。中间语法错误不应销毁画布实例；输入过程中临时有效的部分图也不应提前移除原有对象位置。返回画布时一次接收最新有效图，并建立外部编辑历史边界，避免旧画布撤销覆盖新源码。新模板明确替换原图时才重建画布。

## 验证建议

每种视图验证连续拖动、快速松手、取消、撤销/重做、连续插入、重叠选择、跨边界拖动、低缩放命中、连线目标反馈，以及修改源码后返回。应分别记录操作是否正确和连续操作是否稳定，不能用静态截图或起止坐标代替流畅度判断。

本轮未依据这些文档声称达到特定 FPS、输入延迟或与 draw.io 等量的功能覆盖。产品文档提供交互规则，实际性能仍须在应用中测量。
