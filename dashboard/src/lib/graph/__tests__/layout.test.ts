import { computeLayout, type GraphLayout } from '@/lib/graph/layout';

// Helper to build minimal ticket input
function makeInput(
  id: string,
  dependsOn: string[] = [],
  stage = 'READY',
  title = `Ticket ${id}`,
) {
  return { id, title, stage, dependsOn };
}

describe('computeLayout', () => {
  describe('empty input', () => {
    it('returns empty layout for no tickets', () => {
      const layout = computeLayout([]);
      expect(layout.nodes).toEqual([]);
      expect(layout.edges).toEqual([]);
      expect(layout.width).toBe(0);
      expect(layout.height).toBe(0);
    });
  });

  describe('single node', () => {
    it('positions a single ticket at the origin padding', () => {
      const layout = computeLayout([makeInput('A')]);
      expect(layout.nodes).toHaveLength(1);
      expect(layout.edges).toHaveLength(0);
      const node = layout.nodes[0];
      expect(node.id).toBe('A');
      expect(node.x).toBe(60); // PADDING
      expect(node.y).toBe(60); // PADDING
      expect(node.width).toBe(180);
      expect(node.height).toBe(56);
    });

    it('preserves title and stage', () => {
      const layout = computeLayout([
        makeInput('X', [], 'BACKEND', 'My Custom Title'),
      ]);
      expect(layout.nodes[0].title).toBe('My Custom Title');
      expect(layout.nodes[0].stage).toBe('BACKEND');
    });
  });

  describe('edge generation', () => {
    it('creates edges from dependency to dependent', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
      ]);
      expect(layout.edges).toHaveLength(1);
      expect(layout.edges[0]).toEqual({ from: 'A', to: 'B' });
    });

    it('ignores dependencies referencing non-existent nodes', () => {
      const layout = computeLayout([
        makeInput('A', ['NONEXISTENT']),
      ]);
      expect(layout.edges).toHaveLength(0);
    });

    it('creates multiple edges for multiple dependencies', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B'),
        makeInput('C', ['A', 'B']),
      ]);
      expect(layout.edges).toHaveLength(2);
      const froms = layout.edges.map((e) => e.from).sort();
      expect(froms).toEqual(['A', 'B']);
      expect(layout.edges.every((e) => e.to === 'C')).toBe(true);
    });
  });

  describe('layer assignment (Sugiyama-style)', () => {
    it('places independent nodes in column 0', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B'),
      ]);
      // Both should be in column 0 (same x)
      expect(layout.nodes[0].x).toBe(layout.nodes[1].x);
    });

    it('places dependent node one layer after its dependency', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
      ]);
      const nodeA = layout.nodes.find((n) => n.id === 'A')!;
      const nodeB = layout.nodes.find((n) => n.id === 'B')!;
      // B should be to the right of A
      expect(nodeB.x).toBeGreaterThan(nodeA.x);
      // Exactly one column apart: PADDING + 1*(NODE_WIDTH + HORIZONTAL_GAP)
      expect(nodeB.x - nodeA.x).toBe(180 + 80); // NODE_WIDTH + HORIZONTAL_GAP
    });

    it('handles chain A → B → C across three layers', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
        makeInput('C', ['B']),
      ]);
      const xs = layout.nodes
        .sort((a, b) => a.x - b.x)
        .map((n) => n.id);
      expect(xs).toEqual(['A', 'B', 'C']);
    });

    it('handles diamond dependency: A → B, A → C, B&C → D', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
        makeInput('C', ['A']),
        makeInput('D', ['B', 'C']),
      ]);
      const nodeA = layout.nodes.find((n) => n.id === 'A')!;
      const nodeB = layout.nodes.find((n) => n.id === 'B')!;
      const nodeC = layout.nodes.find((n) => n.id === 'C')!;
      const nodeD = layout.nodes.find((n) => n.id === 'D')!;

      // A at layer 0, B&C at layer 1, D at layer 2
      expect(nodeA.x).toBeLessThan(nodeB.x);
      expect(nodeB.x).toBe(nodeC.x);
      expect(nodeD.x).toBeGreaterThan(nodeB.x);
    });
  });

  describe('non-overlapping placement', () => {
    it('nodes within the same layer have distinct y positions', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B'),
        makeInput('C'),
      ]);
      const ys = layout.nodes.map((n) => n.y);
      const uniqueYs = new Set(ys);
      expect(uniqueYs.size).toBe(3);
    });

    it('no two nodes overlap spatially', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
        makeInput('C'),
        makeInput('D', ['A']),
        makeInput('E', ['B', 'C']),
      ]);
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          const a = layout.nodes[i];
          const b = layout.nodes[j];
          const overlapX =
            a.x < b.x + b.width && a.x + a.width > b.x;
          const overlapY =
            a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlapX && overlapY).toBe(false);
        }
      }
    });
  });

  describe('canvas bounds', () => {
    it('width and height are at least minimum values', () => {
      const layout = computeLayout([makeInput('A')]);
      expect(layout.width).toBeGreaterThanOrEqual(400);
      expect(layout.height).toBeGreaterThanOrEqual(300);
    });

    it('bounds contain all nodes', () => {
      const layout = computeLayout([
        makeInput('A'),
        makeInput('B', ['A']),
        makeInput('C', ['A']),
        makeInput('D', ['B', 'C']),
      ]);
      for (const node of layout.nodes) {
        expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
        expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
      }
    });
  });

  describe('cycle handling', () => {
    it('does not crash on cycles — appends cycled nodes', () => {
      // Simulated cycle: A → B, B → A
      const layout = computeLayout([
        makeInput('A', ['B']),
        makeInput('B', ['A']),
      ]);
      expect(layout.nodes).toHaveLength(2);
      // Both nodes should be placed (positions may be deterministic but not specified)
    });
  });

  describe('large graph stress test', () => {
    it('handles 50 nodes with chain dependencies', () => {
      const tickets = Array.from({ length: 50 }, (_, i) => ({
        id: `T-${String(i).padStart(3, '0')}`,
        title: `Ticket ${i}`,
        stage: 'READY',
        dependsOn: i > 0 ? [`T-${String(i - 1).padStart(3, '0')}`] : [],
      }));
      const layout = computeLayout(tickets);
      expect(layout.nodes).toHaveLength(50);
      // Chain should produce 50 layers
      const uniqueXs = new Set(layout.nodes.map((n) => n.x));
      expect(uniqueXs.size).toBe(50);
    });

    it('handles 20 independent nodes in single layer', () => {
      const tickets = Array.from({ length: 20 }, (_, i) =>
        makeInput(`N-${i}`),
      );
      const layout = computeLayout(tickets);
      expect(layout.nodes).toHaveLength(20);
      // All should share the same x (layer 0)
      const uniqueXs = new Set(layout.nodes.map((n) => n.x));
      expect(uniqueXs.size).toBe(1);
      // All should have distinct y
      const uniqueYs = new Set(layout.nodes.map((n) => n.y));
      expect(uniqueYs.size).toBe(20);
    });
  });
});
