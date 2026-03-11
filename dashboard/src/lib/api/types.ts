/** SDLC pipeline stage. Matches backend TicketStage enum. */
export type TicketStage =
  | 'READY'
  | 'RESEARCH'
  | 'ARCHITECT'
  | 'PRODUCT_MANAGER'
  | 'UI_DESIGN'
  | 'BACKEND'
  | 'FRONTEND'
  | 'QA'
  | 'SECURITY'
  | 'CI'
  | 'DOCUMENTATION'
  | 'VALIDATOR'
  | 'DONE';

/** Ticket operational status. Matches backend TicketStatus enum. */
export type TicketStatus =
  | 'READY'
  | 'BLOCKED'
  | 'CLAIMED'
  | 'IN_PROGRESS'
  | 'DONE'
  | 'FAILED'
  | 'ESCALATED';

/** Ticket classification type. Determines SDLC flow. */
export type TicketType =
  | 'backend'
  | 'frontend'
  | 'fullstack'
  | 'infra'
  | 'security'
  | 'docs'
  | 'research'
  | 'architecture'
  | 'product'
  | 'design';

/** Ticket priority level. */
export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

/** Audit event type. Matches backend EventType enum. */
export type EventType =
  | 'CREATED'
  | 'CLAIMED'
  | 'RELEASED'
  | 'STAGE_ADVANCED'
  | 'STAGE_REJECTED'
  | 'UPDATED'
  | 'SPAWNED'
  | 'ESCALATED'
  | 'LEASE_EXTENDED'
  | 'FORCE_RELEASED'
  | 'RECONCILED'
  | 'FILE_LOCKED'
  | 'FILE_UNLOCKED'
  | 'HEARTBEAT'
  | 'COMPLETED';

/** Core ticket entity returned by the list and detail endpoints. */
export interface Ticket {
  id: string;
  ticket_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  type: TicketType;
  priority: TicketPriority;
  status: TicketStatus;
  stage: TicketStage;
  sdlc_flow: TicketStage[];
  claimed_by: string | null;
  claimed_by_name: string | null;
  machine_id: string | null;
  operator: string | null;
  lease_expiry: string | null;
  lease_duration_minutes: number;
  depends_on: string[];
  file_paths: string[];
  acceptance_criteria: string[];
  tags: string[];
  rework_count: number;
  max_reworks: number;
  metadata: Record<string, unknown>;
  parent_id: string | null;
  source_task_file: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Active claim on a ticket by an agent. */
export interface Claim {
  ticket_id: string;
  title: string;
  stage: TicketStage;
  claimed_by_name: string;
  machine_id: string;
  operator: string | null;
  lease_expiry: string;
  lease_duration_minutes: number;
  status: TicketStatus;
}

/** Records a single stage or status transition for a ticket. */
export interface StageTransition {
  previous_stage: TicketStage | null;
  new_stage: TicketStage | null;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  timestamp: string;
  agent_name: string | null;
  machine_id: string | null;
}

/** Audit trail entry for a single ticket lifecycle event. */
export interface EventHistory {
  id: string;
  ticket_id: string;
  event_type: EventType;
  agent_id: string | null;
  agent_name: string | null;
  machine_id: string | null;
  operator: string | null;
  previous_stage: TicketStage | null;
  new_stage: TicketStage | null;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  payload: Record<string, unknown>;
  created_at: string;
}

/** Aggregate counts for one pipeline stage. */
export interface StageSummary {
  count: number;
  claimed: number;
  ready: number;
}

/** Full pipeline snapshot with per-stage summaries. */
export interface PipelineOverview {
  stages: Record<string, StageSummary>;
  total_tickets: number;
  timestamp: string;
}

/** Pagination metadata returned alongside a list response. */
export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** Generic wrapper for paginated list responses. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

/** Resolution status of a single ticket dependency. */
export interface DependencyStatus {
  ticket_id: string;
  title: string | null;
  status: string;
  is_resolved: boolean;
}

/** Extended ticket with resolved dependency information. */
export interface TicketDetail extends Ticket {
  dependency_status: DependencyStatus[];
}

/** Query parameters accepted by the ticket list endpoint. */
export interface TicketFilters {
  stage?: TicketStage;
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  claimed_by?: string;
  limit?: number;
  offset?: number;
}

/** Configuration options for {@link ForgeApiClient}. */
export interface ApiClientConfig {
  baseUrl: string;
  timeout: number;
  headers: Record<string, string>;
}

/** Structured error thrown by the API client on non-OK responses. */
export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
}
