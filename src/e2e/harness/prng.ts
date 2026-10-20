/** Small seeded PRNG (mulberry32) so randomized tests are reproducible from a printed seed. */
export class Prng {
    private state: number;

    constructor(public readonly seed: number) {
        this.state = seed >>> 0;
    }

    /** float in [0, 1) */
    next(): number {
        this.state = (this.state + 0x6D2B79F5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** integer in [min, max] inclusive */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    chance(probability: number): boolean {
        return this.next() < probability;
    }

    pick<T>(items: readonly T[]): T {
        return items[this.int(0, items.length - 1)];
    }

    shuffle<T>(items: readonly T[]): T[] {
        const copy = [...items];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }
}
