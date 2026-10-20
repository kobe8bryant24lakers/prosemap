export type CanvasLabelEdit<T> = {
  key: string;
  snapshot: T;
  undo: T[];
  redo: T[];
};

/** Capture history before the first character changes the shared graph. */
export function beginCanvasLabelEdit<T>(key: string, snapshot: T, undo: T[], redo: T[]): CanvasLabelEdit<T> {
  return { key, snapshot, undo: [...undo], redo: [...redo] };
}

/** Cancel is a rollback, so the abandoned text never becomes a redo item. */
export function cancelCanvasLabelEdit<T>(edit: CanvasLabelEdit<T>) {
  return { snapshot: edit.snapshot, undo: [...edit.undo], redo: [...edit.redo] };
}

export function canvasLabelKeyAction(event: { key: string; isComposing?: boolean; keyCode?: number }): 'commit' | 'cancel' | null {
  // Some WebViews report the final composition Enter with isComposing=false.
  if (event.isComposing || event.keyCode === 229) return null;
  if (event.key === 'Enter') return 'commit';
  if (event.key === 'Escape') return 'cancel';
  return null;
}
