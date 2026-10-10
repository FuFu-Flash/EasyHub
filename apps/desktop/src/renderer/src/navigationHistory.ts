interface Page {
  key: string;
  restore: () => void;
}

/** Per-account browsing history. Restoring a page is not another visit. */
export class NavigationHistory {
  private current: Page | null = null;
  private readonly previous: Page[] = [];
  private returning = false;
  private replacing = false;

  constructor(private readonly limit = 50) {}

  record(key: string, restore: () => void): number {
    if (this.current && this.current.key !== key) {
      if (this.returning || this.replacing) { this.returning = false; this.replacing = false; }
      else {
        this.previous.push(this.current);
        if (this.previous.length > this.limit) this.previous.shift();
      }
    }
    this.returning = false;
    this.replacing = false;
    this.current = { key, restore };
    return this.previous.length;
  }

  replaceNext(): void { this.replacing = true; }

  prune(isValid: (key: string) => boolean): number {
    const valid = this.previous.filter((page) => isValid(page.key));
    this.previous.splice(0, this.previous.length, ...valid);
    return this.previous.length;
  }

  back(fallback: () => void): number {
    const page = this.previous.pop();
    if (page) {
      this.returning = true;
      page.restore();
    } else { this.replacing = true; fallback(); }
    return this.previous.length;
  }
}
