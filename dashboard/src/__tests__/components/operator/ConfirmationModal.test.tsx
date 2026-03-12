import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmationModal } from '@/components/operator/ConfirmationModal';
import type { ConfirmationModalProps } from '@/components/operator/ConfirmationModal';

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultProps: ConfirmationModalProps = {
  isOpen: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  variant: 'warning',
  title: 'Test Modal',
  description: 'Are you sure?',
  warningText: 'This cannot be undone.',
  inputLabel: 'Reason',
  inputPlaceholder: 'Enter reason',
  confirmLabel: 'Confirm',
};

afterEach(() => {
  jest.resetAllMocks();
});

function renderModal(overrides: Partial<ConfirmationModalProps> = {}) {
  return render(<ConfirmationModal {...defaultProps} {...overrides} />);
}

// ── Render / visibility ──────────────────────────────────────────────────────

describe('ConfirmationModal', () => {
  describe('rendering', () => {
    it('renders dialog when open', () => {
      renderModal();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('does not render when closed', () => {
      renderModal({ isOpen: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders title and description', () => {
      renderModal();
      expect(screen.getByText('Test Modal')).toBeInTheDocument();
      expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('renders warning text', () => {
      renderModal();
      expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('renders input with correct label', () => {
      renderModal();
      expect(screen.getByLabelText('Reason')).toBeInTheDocument();
    });

    it('renders confirm button with custom label', () => {
      renderModal({ confirmLabel: 'Do it' });
      expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      renderModal();
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeInTheDocument();
    });

    it('renders textarea when multiline is true', () => {
      renderModal({ multiline: true });
      const textarea = screen.getByLabelText('Reason');
      expect(textarea.tagName).toBe('TEXTAREA');
    });
  });

  // ── Variant styling ────────────────────────────────────────────────────

  describe('variants', () => {
    it('applies danger icon and styling', () => {
      renderModal({ variant: 'danger' });
      const dialog = screen.getByRole('dialog');
      expect(dialog).toBeInTheDocument();
      // Danger variant has its confirm button with danger color
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmBtn.className).toContain('bg-error');
    });

    it('applies warning icon and styling', () => {
      renderModal({ variant: 'warning' });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
      expect(confirmBtn.className).toContain('bg-info');
    });
  });

  // ── Input validation ───────────────────────────────────────────────────

  describe('validation', () => {
    it('disables confirm button when input is empty', () => {
      renderModal({ minInputLength: 5 });
      expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    });

    it('enables confirm button when input meets minimum length', async () => {
      const user = userEvent.setup();
      renderModal({ minInputLength: 3 });

      await user.type(screen.getByLabelText(/Reason/), 'abc');
      expect(screen.getByRole('button', { name: 'Confirm' })).not.toBeDisabled();
    });

    it('shows error on blur when input is too short', async () => {
      const user = userEvent.setup();
      renderModal({ minInputLength: 5 });

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'ab');
      await user.tab(); // blur

      expect(screen.getByText(/at least 5 characters/)).toBeInTheDocument();
    });

    it('clears error when input reaches required length', async () => {
      const user = userEvent.setup();
      renderModal({ minInputLength: 3 });

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'ab');
      await user.tab(); // blur → shows error
      expect(screen.getByText(/at least 3 characters/)).toBeInTheDocument();

      await user.click(input);
      await user.type(input, 'c'); // now 'abc' = 3 chars
      expect(screen.queryByText(/at least 3 characters/)).not.toBeInTheDocument();
    });

    it('marks input as aria-invalid when error is shown', async () => {
      const user = userEvent.setup();
      renderModal({ minInputLength: 5 });

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'x');
      await user.tab();

      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
  });

  // ── User interactions ──────────────────────────────────────────────────

  describe('interactions', () => {
    it('calls onConfirm with input value', async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      renderModal({ onConfirm, minInputLength: 1 });

      await user.type(screen.getByLabelText(/Reason/), 'my reason');
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      expect(onConfirm).toHaveBeenCalledWith('my reason');
    });

    it('calls onClose on Cancel click', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      renderModal({ onClose });

      await user.click(screen.getByRole('button', { name: /Cancel/ }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      renderModal({ onClose });

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on scrim click', async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      renderModal({ onClose });

      // The scrim has a data-testid for reliable targeting
      const scrim = screen.getByTestId('modal-scrim');
      await user.click(scrim);
      expect(onClose).toHaveBeenCalled();
    });

    it('submits on Ctrl+Enter', async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      renderModal({ onConfirm, minInputLength: 1 });

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'Done');
      await user.keyboard('{Control>}{Enter}{/Control}');

      expect(onConfirm).toHaveBeenCalledWith('Done');
    });

    it('does not submit on Ctrl+Enter when input is invalid', async () => {
      const user = userEvent.setup();
      const onConfirm = jest.fn();
      renderModal({ onConfirm, minInputLength: 10 });

      const input = screen.getByLabelText(/Reason/);
      await user.type(input, 'hi');
      await user.keyboard('{Control>}{Enter}{/Control}');

      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────

  describe('loading state', () => {
    it('disables confirm button when loading', () => {
      renderModal({ isLoading: true });
      // When loading, button text becomes 'Processing...'
      expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled();
    });

    it('disables cancel button when loading', () => {
      renderModal({ isLoading: true });
      expect(screen.getByRole('button', { name: /Cancel/ })).toBeDisabled();
    });

    it('shows processing text on confirm button when loading', () => {
      renderModal({ isLoading: true, confirmLabel: 'Submit' });
      // Button text changes to 'Processing...' when loading
      const confirmBtn = screen.getByRole('button', { name: 'Processing...' });
      expect(confirmBtn).toBeInTheDocument();
      expect(confirmBtn).toHaveAttribute('aria-busy', 'true');
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has aria-modal attribute', () => {
      renderModal();
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('has aria-labelledby pointing to title', () => {
      renderModal();
      const dialog = screen.getByRole('dialog');
      const labelId = dialog.getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      expect(document.getElementById(labelId!)).toHaveTextContent('Test Modal');
    });

    it('has aria-describedby pointing to description', () => {
      renderModal();
      const dialog = screen.getByRole('dialog');
      const descId = dialog.getAttribute('aria-describedby');
      expect(descId).toBeTruthy();
      expect(document.getElementById(descId!)).toHaveTextContent('Are you sure?');
    });

    it('traps focus within the modal', async () => {
      const user = userEvent.setup();
      renderModal();

      // Tab through all elements and verify focus stays within
      const input = screen.getByLabelText('Reason');
      const cancelBtn = screen.getByRole('button', { name: /Cancel/ });
      const confirmBtn = screen.getByRole('button', { name: 'Confirm' });

      // Focus should cycle through modal focusable elements
      input.focus();
      expect(document.activeElement).toBe(input);

      await user.tab();
      await user.tab();
      // After tabbing past last element, focus should wrap to first
      await user.tab();
      // Focus trap should keep focus inside the modal
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    });

    it('clears input when modal re-opens', () => {
      const { rerender } = render(
        <ConfirmationModal {...defaultProps} isOpen={false} />,
      );
      rerender(<ConfirmationModal {...defaultProps} isOpen={true} />);

      expect(screen.getByLabelText('Reason')).toHaveValue('');
    });
  });
});
