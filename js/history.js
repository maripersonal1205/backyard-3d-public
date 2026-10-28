// Undo/redo over whole-layout snapshots (see ItemStore.getState). Layouts are
// small (a dozen or so items), so snapshots keep undo trivially correct for
// moves, copies, removals, resizes and turns alike.
const LIMIT = 200;
const MERGE_WINDOW_MS = 1000;

export class History {
  constructor(initial) {
    this.stack = [initial];
    this.index = 0;
    this.lastKey = null;
    this.lastTime = 0;
  }

  // `mergeKey` folds rapid repeats (arrow-key nudges, turn clicks) on the same
  // item into a single undo step.
  push(state, mergeKey = null) {
    const now = performance.now();
    this.stack.length = this.index + 1;
    if (mergeKey && mergeKey === this.lastKey && now - this.lastTime < MERGE_WINDOW_MS && this.index > 0) {
      this.stack[this.index] = state;
    } else {
      this.stack.push(state);
      this.index++;
      if (this.stack.length > LIMIT) {
        this.stack.shift();
        this.index--;
      }
    }
    this.lastKey = mergeKey;
    this.lastTime = now;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }

  undo() {
    if (!this.canUndo) return null;
    this.lastKey = null;
    return this.stack[--this.index];
  }

  redo() {
    if (!this.canRedo) return null;
    this.lastKey = null;
    return this.stack[++this.index];
  }
}
