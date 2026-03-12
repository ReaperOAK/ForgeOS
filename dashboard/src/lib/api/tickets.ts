import type {
  EventHistory,
  PaginatedResponse,
  PipelineOverview,
  Ticket,
  TicketDetail,
  TicketFilters,
} from './types';
import { apiClient, buildQueryString } from './client';

/**
 * Fetch paginated, filterable ticket list.
 * Backend endpoint: GET /api/tickets?stage=...&type=...&limit=...&offset=...
 */
export async function fetchTickets(
  filters?: TicketFilters,
): Promise<PaginatedResponse<Ticket>> {
  const query = buildQueryString({
    stage: filters?.stage,
    type: filters?.type,
    status: filters?.status,
    priority: filters?.priority,
    claimed_by: filters?.claimed_by,
    limit: filters?.limit,
    offset: filters?.offset,
  });
  return apiClient.get<PaginatedResponse<Ticket>>(`/api/tickets${query}`);
}

/**
 * Fetch full ticket detail by human-readable ticket ID.
 * Backend endpoint: GET /api/tickets/:id
 */
export async function fetchTicket(ticketId: string): Promise<TicketDetail> {
  return apiClient.get<TicketDetail>(
    `/api/tickets/${encodeURIComponent(ticketId)}`,
  );
}

/**
 * Fetch pipeline overview with counts per stage.
 * Backend endpoint: GET /api/stages
 */
export async function fetchPipelineOverview(): Promise<PipelineOverview> {
  return apiClient.get<PipelineOverview>('/api/stages');
}

/**
 * Fetch ordered event timeline for a specific ticket.
 * Backend endpoint: GET /api/tickets/:id/history
 */
export async function fetchTicketHistory(
  ticketId: string,
): Promise<EventHistory[]> {
  const res = await apiClient.get<{ ticket_id: string; events: EventHistory[]; count: number }>(
    `/api/tickets/${encodeURIComponent(ticketId)}/history`,
  );
  return res.events;
}
