# 复杂图表专项：甘特图

## 09 甘特图

```mermaid
gantt
  title 桌面绘图工具交付计划
  dateFormat YYYY-MM-DD
  axisFormat %m-%d
  excludes weekends
  todayMarker off
  section 设计
  需求调研 :done, req, 2026-10-05, 3d
  交互方案 :done, design, after req, 4d
  技术评估 :done, review, after req, 2d
  section 开发
  画布基础 :active, core, after design review, 5d
  文档集成 :docs, after design, 4d
  连线编辑 :crit, edges, after core, 3d
  性能优化 :perf, after core, 4d
  section 验证与发布
  自动回归 :tests, after edges docs, 3d
  原生验收 :crit, native, after tests perf, 2d
  发布准备 :release, after native, 1d
  交付里程碑 :milestone, launch, after release, 0d
```
