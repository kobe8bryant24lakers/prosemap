# Mermaid 故意无效样例

预期逐块显示可恢复错误；不应崩溃、覆盖原文或让后续正文消失。

## 未闭合节点

```mermaid
flowchart TD
  A[未闭合节点
```

## 不完整连线

```mermaid
flowchart TD
  A -->
```

## 未闭合时序控制块

```mermaid
sequenceDiagram
  participant A
  participant B
  alt success
    A->>B: missing end
```

## 不存在的图种关键字

```mermaid
usecaseDiagram
  actor User
```

END-OF-INVALID-FIXTURE
