import type { MermaidFlowNode } from './mermaid-workbench.ts';
import { MERMAID_STAGE_PADDING, type MermaidCanvasPoint, type MermaidCanvasResizeHandle } from './mermaid-canvas-layout.ts';

/** A side handle must not freeze or extend an implicit sequence lifeline. */
export function sequenceCanvasResizeUpdate(
  node: MermaidFlowNode,
  handle: MermaidCanvasResizeHandle,
  resized: { position: MermaidCanvasPoint; size: { width: number; height: number } },
  stage: { width: number; height: number },
) {
  const horizontal = handle !== 'south';
  const vertical = handle.startsWith('south');
  return {
    node: {
      ...node,
      data: {
        ...node.data,
        ...(horizontal ? { canvasWidth: resized.size.width } : {}),
        ...(vertical ? { canvasLifelineHeight: resized.size.height } : {}),
      },
    },
    width: horizontal ? Math.max(stage.width, Math.ceil(resized.position.x + resized.size.width + MERMAID_STAGE_PADDING)) : stage.width,
    height: vertical ? Math.max(stage.height, Math.ceil(resized.position.y + resized.size.height + MERMAID_STAGE_PADDING)) : stage.height,
  };
}
