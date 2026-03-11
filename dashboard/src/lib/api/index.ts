export type {
  Ticket,
  TicketDetail,
  Claim,
  StageTransition,
  EventHistory,
  PipelineOverview,
  StageSummary,
  PaginatedResponse,
  PaginationInfo,
  DependencyStatus,
  TicketFilters,
  ApiClientConfig,
  ApiError,
  TicketStage,
  TicketStatus,
  TicketType,
  TicketPriority,
  EventType,
} from './types';

export {
  fetchTickets,
  fetchTicket,
  fetchPipelineOverview,
  fetchTicketHistory,
} from './tickets';

export { apiClient, isApiError, buildQueryString } from './client';

export { TicketWebSocketClient } from './websocket';
export type {
  WebSocketEvent,
  TicketStateChangeEvent,
  TicketCreatedEvent,
  TicketUpdatedEvent,
  ConnectionStatus as WsConnectionStatus,
  WebSocketClientOptions,
} from './websocket';
