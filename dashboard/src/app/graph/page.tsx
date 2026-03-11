'use client';

import { useEffect, useState } from 'react';
import { GitBranch, Loader2, AlertTriangle } from 'lucide-react';
import { fetchTickets, type Ticket } from '@/lib/api';
import { DependencyGraph } from '@/components/graph/DependencyGraph';

export default function GraphPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadAllTickets() {
      try {
        setLoading(true);
        setError(null);

        // Fetch all tickets (paginated — keep fetching until exhausted)
        const allTickets: Ticket[] = [];
        let offset = 0;
        const limit = 100;
        let hasMore = true;

        while (hasMore) {
          const response = await fetchTickets({ limit, offset });
          allTickets.push(...response.data);
          hasMore = response.pagination.has_more;
          offset += limit;
        }

        if (!cancelled) {
          setTickets(allTickets);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load tickets',
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadAllTickets();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <GitBranch size={24} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Dependency Graph</h1>
      </div>

      {loading && (
        <div className="flex items-center justify-center h-96 gap-2 text-muted">
          <Loader2 size={20} className="animate-spin" aria-hidden="true" />
          <span>Loading dependency graph…</span>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-center h-96 gap-2 text-error">
          <AlertTriangle size={20} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && <DependencyGraph tickets={tickets} />}
    </div>
  );
}
