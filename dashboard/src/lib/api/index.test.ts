import {
  fetchTickets,
  fetchTicket,
  fetchPipelineOverview,
  fetchTicketHistory,
  apiClient,
  isApiError,
  buildQueryString,
} from './index';

describe('barrel exports', () => {
  it('exports all API functions', () => {
    expect(typeof fetchTickets).toBe('function');
    expect(typeof fetchTicket).toBe('function');
    expect(typeof fetchPipelineOverview).toBe('function');
    expect(typeof fetchTicketHistory).toBe('function');
  });

  it('exports client utilities', () => {
    expect(typeof isApiError).toBe('function');
    expect(typeof buildQueryString).toBe('function');
    expect(apiClient).toBeDefined();
  });
});
