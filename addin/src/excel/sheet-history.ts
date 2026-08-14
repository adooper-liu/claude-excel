export type SheetRecord = { sheet: string; previous: string };

export class SheetHistory {
  private items: SheetRecord[] = [];
  private listeners: Array<() => void> = [];

  constructor(private readonly max = 20) {}

  get length(): number {
    return this.items.length;
  }

  peek(): SheetRecord | null {
    return this.items[this.items.length - 1] || null;
  }

  push(sheet: string, previous: string): void {
    this.items.push({ sheet, previous });
    while (this.items.length > this.max) this.items.shift();
    this.emit();
  }

  pop(): SheetRecord | null {
    const item = this.items.pop() || null;
    if (item) this.emit();
    return item;
  }

  list(): SheetRecord[] {
    return this.items.slice().reverse();
  }

  remove(sheet: string): SheetRecord | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].sheet === sheet) {
        const item = this.items[i];
        this.items.splice(i, 1);
        this.emit();
        return item;
      }
    }
    return null;
  }

  popIfTop(sheet: string): boolean {
    const top = this.peek();
    if (!top || top.sheet !== sheet) return false;
    this.pop();
    return true;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}

export const sheetHistory = new SheetHistory();
