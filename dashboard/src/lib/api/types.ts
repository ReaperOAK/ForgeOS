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

export interface StageTransition {
  previous_stage: TicketStage | null;
  new_stage: TicketStage | null;
  previous_status: TicketStatus | null;
  new_status: TicketStatus | null;
  timestamp: string;
  agent_name: string | null;
  machine_id: string | null;
}

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

export interface StageSummary {
  count: number;
  claimed: number;
  ready: number;
}

export interface PipelineOverview {
  stages: Record<string, StageSummary>;
  total_tickets: number;
  timestamp: string;
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationInfo;
}

export interface DependencyStatus {
  ticket_id: string;
  title: string | null;
  status: string;
  is_resolved: boolean;
}

export interface TicketDetail extends Ticket {
  dependency_status: DependencyStatus[];
}

export interface TicketFilters {
  stage?: TicketStage;
  type?: TicketType;
  status?: TicketStatus;
  priority?: TicketPriority;
  claimed_by?: string;
  limit?: number;
  offset?: number;
}

export interface ApiClientConfig {
  baseUrl: string;
  timeout: number;
  headers: Record<string, string>;
}

export interface ApiError {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
}
