import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OperatorActions } from '@/components/operator/OperatorActions';
import type { OperatorActionsProps } from '@/components/operator/OperatorActions';
import type { OperatorAction } from '@/lib/api/operations';

// ── Mock API operations ──────────────────────────────────────────────────────

jest.mock('@/lib/api/operations', () => ({
  claimTicket: jest.fn(),
  releaseTicket: jest.fn(),
  advanceTicket: jest.fn(),
  forceReleaseTicket: jest.fn(),
}));

jest.mock('@/lib/api/client', () => ({
  isApiError: (e: unknown) =>
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    'status' in e,
}));

import {
  claimTicket,
  releaseTicket,
  advanceTicket,
  forceReleaseTicket,
} from '@/lib/api/operations';

const mockClaim = claimTicket as jest.MockedFunction<typeof claimTicket>;
const mockRelease = releaseTicket as jest.MockedFunction<typeof releaseTicket>;
const mockAdvance = advanceTicket as jest.MockedFunction<typeof advanceTicket>;
const mockForceRelease = forceReleaseTicket as jest.MockedFunction<typeof forceReleaseTicket>;

afterEach(() => {
  jest.resetAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps: OperatorActionsProps = {
  ticketId: 'FORGEOS-TEST-1',
  ticketStage: 'BACKEND',
  isClaimHolder: false,
  isClaimed: false,
  isAuthenticated: true,
  onActionComplete: jest.fn(),
  onActionError: jest.fn(),
};

const successResponse = {
  success: true,
  message: 'Done',
  ticketId: 'FORGEOS-TEST-1',
  timestamp: '2026-03-12T10:00:00Z',
};

function renderActions(overrides: Partial<OperatorActionsProps> = {}) {
  return render(<OperatorActions {...defaultProps} {...overrides} />);
}

function getActionButtons() {
  const toolbar = screen.getByRole('toolbar');
  return within(toolbar).getAllByRole('button');
}

// ── Rendering tests ──────────────────────────────────────────────────────────

describe('OperatorActions', () => {
  describe('rendering', () => {
    it('renders all 4 action buttons', () => {
      renderActions();
      const buttons = getActionButtons();
      expect(buttons).toHaveLength(4);
    });

    it('renders section heading', () => {
      renderActions();
      expect(screen.getByText('Operator Actions')).toBeInTheDocument();
    });

    it('renders toolbar with aria-label', () => {
      renderActions();
      expect(screen.getByRole('toolbar')).toHaveAttribute('aria-label', 'Operator actions');
    });

    it('renders DANGER badge on Force Release', () => {
      renderActions();
      expect(screen.getByText('DANGER')).toBeInTheDocument();
    });

    it('renders auth status for authenticated user', () => {
      renderActions();
      expect(screen.getByText('Authenticated')).toBeInTheDocument();
      expect(screen.getByText('as operator')).toBeInTheDocument();
    });

    it('renders not-authenticated status', () => {
      renderActions({ isAuthenticated: false });
      expect(screen.getByText('Not authenticated')).toBeInTheDocument();
    });
  });

  // ── Enable/disable logic ────────────────────────────────────────────────

  describe('action enable/disable', () => {
    it('enables Claim when ticket is unclaimed', () => {
      renderActions({ isClaimed: false });
      const claimBtn = screen.getByRole('button', { name: /Claim Ticket/ });
      expect(claimBtn).not.toBeDisabled();
    });

    it('disables Claim when ticket is already claimed', () => {
      renderActions({ isClaimed: true });
      const claimBtn = screen.getByRole('button', { name: /Claim Ticket/ });
      expect(claimBtn).toBeDisabled();
    });

    it('enables Release when user is claim holder', () => {
      renderActions({ isClaimHolder: true, isClaimed: true });
      const releaseBtn = screen.getByRole('button', { name: /Release Claim/ });
      expect(releaseBtn).not.toBeDisabled();
    });

    it('disables Release when user is not claim holder', () => {
      renderActions({ isClaimHolder: false });
      const releaseBtn = screen.getByRole('button', { name: /Release Claim/ });
      expect(releaseBtn).toBeDisabled();
    });

    it('enables Advance when user is claim holder', () => {
      renderActions({ isClaimHolder: true, isClaimed: true });
      const advanceBtn = screen.getByRole('button', { name: /Advance Stage/ });
      expect(advanceBtn).not.toBeDisabled();
    });

    it('enables Force Release when ticket is claimed by someone else', () => {
      renderActions({ isClaimed: true, isClaimHolder: false });
      const forceBtn = screen.getByRole('button', { name: /Force Release/ });
      expect(forceBtn).not.toBeDisabled();
    });

    it('disables Force Release when user holds the claim', () => {
      renderActions({ isClaimed: true, isClaimHolder: true });
      const forceBtn = screen.getByRole('button', { name: /Force Release/ });
      expect(forceBtn).toBeDisabled();
    });

    it('disables all buttons when no ticket selected', () => {
      renderActions({ ticketId: null });
      const buttons = getActionButtons();
      buttons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });

    it('shows sign-in overlay when unauthenticated', () => {
      renderActions({ isAuthenticated: false });
      expect(screen.getByText('Sign in to perform actions')).toBeInTheDocument();
    });
  });

  // ── Direct actions (claim / release) ────────────────────────────────────

  describe('direct actions', () => {
    it('calls claimTicket on Claim button click', async () => {
      const user = userEvent.setup();
      mockClaim.mockResolvedValue(successResponse);

      renderActions({ isClaimed: false });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      expect(mockClaim).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'FORGEOS-TEST-1' }),
      );
    });

    it('calls onActionComplete on success', async () => {
      const user = userEvent.setup();
      const onComplete = jest.fn();
      mockClaim.mockResolvedValue(successResponse);

      renderActions({ isClaimed: false, onActionComplete: onComplete });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      expect(onComplete).toHaveBeenCalledWith(
        'claim',
        expect.objectContaining({ ticketId: 'FORGEOS-TEST-1', action: 'claim' }),
      );
    });

    it('calls onActionError on failure', async () => {
      const user = userEvent.setup();
      const onError = jest.fn();
      mockClaim.mockRejectedValue({ message: 'Server error', status: 500 });

      renderActions({ isClaimed: false, onActionError: onError });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      expect(onError).toHaveBeenCalledWith('claim', expect.any(Error));
    });

    it('calls releaseTicket on Release button click', async () => {
      const user = userEvent.setup();
      mockRelease.mockResolvedValue(successResponse);

      renderActions({ isClaimHolder: true, isClaimed: true });
      await user.click(screen.getByRole('button', { name: /Release Claim/ }));

      expect(mockRelease).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'FORGEOS-TEST-1' }),
      );
    });
  });

  // ── Modal actions (advance / force-release) ─────────────────────────────

  describe('modal actions', () => {
    it('opens modal on Advance click', async () => {
      const user = userEvent.setup();
      renderActions({ isClaimHolder: true, isClaimed: true });

      await user.click(screen.getByRole('button', { name: /Advance Stage/ }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // The modal title is inside an h2 element
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('heading', { name: /Advance Stage/ })).toBeInTheDocument();
    });

    it('opens danger modal on Force Release click', async () => {
      const user = userEvent.setup();
      renderActions({ isClaimed: true, isClaimHolder: false });

      await user.click(screen.getByRole('button', { name: /Force Release/ }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Force Release Ticket')).toBeInTheDocument();
    });

    it('calls advanceTicket after modal confirmation', async () => {
      const user = userEvent.setup();
      mockAdvance.mockResolvedValue(successResponse);
      renderActions({ isClaimHolder: true, isClaimed: true });

      await user.click(screen.getByRole('button', { name: /Advance Stage/ }));

      const input = screen.getByRole('textbox');
      await user.type(input, 'All tests pass');

      const confirmBtn = screen.getByRole('button', { name: 'Advance' });
      await user.click(confirmBtn);

      expect(mockAdvance).toHaveBeenCalledWith(
        expect.objectContaining({ ticketId: 'FORGEOS-TEST-1', evidence: 'All tests pass' }),
      );
    });

    it('calls forceReleaseTicket after modal confirmation with reason', async () => {
      const user = userEvent.setup();
      mockForceRelease.mockResolvedValue(successResponse);
      renderActions({ isClaimed: true, isClaimHolder: false });

      await user.click(screen.getByRole('button', { name: /Force Release/ }));

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'Operator is unresponsive for hours');

      const confirmBtn = screen.getByRole('button', { name: 'Force Release' });
      await user.click(confirmBtn);

      expect(mockForceRelease).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'FORGEOS-TEST-1',
          reason: 'Operator is unresponsive for hours',
        }),
      );
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has a live region for announcements', () => {
      renderActions();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('announces success via live region', async () => {
      const user = userEvent.setup();
      mockClaim.mockResolvedValue(successResponse);

      renderActions({ isClaimed: false });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent(/claim succeeded/i);
    });

    it('announces failure via live region', async () => {
      const user = userEvent.setup();
      mockClaim.mockRejectedValue(new Error('Network error'));

      renderActions({ isClaimed: false });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveTextContent(/claim failed/i);
    });

    it('sets aria-busy on loading button', async () => {
      const user = userEvent.setup();
      let resolve: (val: typeof successResponse) => void;
      mockClaim.mockReturnValue(
        new Promise((r) => { resolve = r; }),
      );

      renderActions({ isClaimed: false });
      await user.click(screen.getByRole('button', { name: /Claim Ticket/ }));

      const claimBtn = screen.getByRole('button', { name: /Processing/ });
      expect(claimBtn).toHaveAttribute('aria-busy', 'true');

      // resolve to clean up
      resolve!(successResponse);
    });
  });
});
