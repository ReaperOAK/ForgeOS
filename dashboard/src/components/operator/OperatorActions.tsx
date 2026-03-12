'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ConfirmationModal } from './ConfirmationModal';
import {
    claimTicket,
    releaseTicket,
    advanceTicket,
    forceReleaseTicket,
} from '@/lib/api/operations';
import type { OperationResponse, OperatorAction } from '@/lib/api/operations';
import { isApiError } from '@/lib/api/client';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Result returned after a successful operator action.
 *
 * @remarks Passed to the {@link OperatorActionsProps.onActionComplete} callback.
 */
export interface ActionResult {
    /** ID of the ticket the action was performed on. */
    ticketId: string;
    /** The action that was executed. */
    action: OperatorAction;
    /** ISO-8601 timestamp from the server response. */
    timestamp: string;
    /** Human-readable success message from the server. */
    message: string;
}

/**
 * Props for the {@link OperatorActions} component.
 *
 * @remarks
 * Pass ticket state from the parent page and optional callbacks to
 * handle success / error outcomes. When `isAuthenticated` is `false`,
 * all action buttons are disabled and a sign-in overlay is shown.
 */
export interface OperatorActionsProps {
    /** Currently selected ticket ID, or `null` when no ticket is selected. */
    ticketId: string | null;
    /** Current SDLC stage of the selected ticket (used in the advance modal description). */
    ticketStage: string | null;
    /** Whether the current user holds the active claim on this ticket. */
    isClaimHolder: boolean;
    /** Whether any operator currently holds a claim on this ticket. */
    isClaimed: boolean;
    /** Whether the current user is authenticated. */
    isAuthenticated: boolean;
    /** Fires after a successful action with the action type and server result. */
    onActionComplete?: (action: OperatorAction, result: ActionResult) => void;
    /** Fires when an action fails with the action type and error details. */
    onActionError?: (action: OperatorAction, error: Error) => void;
}

// ── Action config ────────────────────────────────────────────────────────────

interface ActionConfig {
    action: OperatorAction;
    label: string;
    description: string;
    icon: ReactNode;
    colorClass: string;
    badge?: string;
}

const ACTIONS: ActionConfig[] = [
    {
        action: 'claim',
        label: 'Claim Ticket',
        description: 'Acquire lease on an unclaimed ticket',
        icon: <span aria-hidden="true">✋</span>,
        colorClass: 'border-l-success',
    },
    {
        action: 'release',
        label: 'Release Claim',
        description: 'Release your active claim on a ticket',
        icon: <span aria-hidden="true">🔓</span>,
        colorClass: 'border-l-[var(--color-priority-high,#F97316)]',
    },
    {
        action: 'advance',
        label: 'Advance Stage',
        description: 'Move ticket to next SDLC stage',
        icon: <span aria-hidden="true">→</span>,
        colorClass: 'border-l-info',
    },
    {
        action: 'force-release',
        label: 'Force Release',
        description: "Force-release another operator's claim",
        icon: <span aria-hidden="true">⚠</span>,
        colorClass: 'border-l-error',
        badge: 'DANGER',
    },
];

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Operator action toolbar for managing ticket lifecycle.
 *
 * Renders four action buttons — Claim, Release, Advance, and Force Release —
 * in a responsive 2-column grid. Button availability depends on ticket state
 * and authentication status. Destructive actions (advance, force-release)
 * open a {@link ConfirmationModal} requiring user input before execution.
 *
 * @remarks
 * - Uses an ARIA `role="toolbar"` with a live region for screen reader
 *   announcements of action outcomes.
 * - When `isAuthenticated` is `false`, a translucent overlay with a lock
 *   icon covers the toolbar.
 * - Loading state is per-action: only the triggered button shows a spinner.
 *
 * @example
 * ```tsx
 * <OperatorActions
 *   ticketId="FORGEOS-FE009"
 *   ticketStage="QA"
 *   isClaimHolder={true}
 *   isClaimed={true}
 *   isAuthenticated={true}
 *   onActionComplete={(action, result) => toast.success(result.message)}
 *   onActionError={(action, error) => toast.error(error.message)}
 * />
 * ```
 */
export function OperatorActions({
    ticketId,
    ticketStage,
    isClaimHolder,
    isClaimed,
    isAuthenticated,
    onActionComplete,
    onActionError,
}: OperatorActionsProps) {
    const [loadingAction, setLoadingAction] = useState<OperatorAction | null>(null);
    const [modalAction, setModalAction] = useState<OperatorAction | null>(null);
    const liveRegionRef = useRef<HTMLDivElement>(null);

    const isActionEnabled = useCallback(
        (action: OperatorAction): boolean => {
            if (!isAuthenticated || !ticketId) return false;
            switch (action) {
                case 'claim':
                    return !isClaimed;
                case 'release':
                    return isClaimHolder;
                case 'advance':
                    return isClaimHolder;
                case 'force-release':
                    return isClaimed && !isClaimHolder;
                default:
                    return false;
            }
        },
        [isAuthenticated, ticketId, isClaimed, isClaimHolder],
    );

    const getDisabledReason = useCallback(
        (action: OperatorAction): string | null => {
            if (!isAuthenticated) return 'Sign in to perform actions';
            if (!ticketId) return 'Select a ticket first';
            switch (action) {
                case 'claim':
                    return isClaimed ? 'Ticket is already claimed' : null;
                case 'release':
                    return !isClaimHolder ? 'You do not hold the claim on this ticket' : null;
                case 'advance':
                    return !isClaimHolder ? 'You must hold the claim to advance' : null;
                case 'force-release':
                    if (!isClaimed) return 'No active claim to force-release';
                    if (isClaimHolder) return 'You already hold this claim';
                    return null;
                default:
                    return null;
            }
        },
        [isAuthenticated, ticketId, isClaimed, isClaimHolder],
    );

    const announce = useCallback((message: string) => {
        if (liveRegionRef.current) {
            liveRegionRef.current.textContent = message;
        }
    }, []);

    const executeAction = useCallback(
        async (action: OperatorAction, inputText?: string) => {
            if (!ticketId) return;
            setLoadingAction(action);

            try {
                let response: OperationResponse;
                switch (action) {
                    case 'claim':
                        response = await claimTicket({
                            ticketId,
                            agent: 'operator',
                            machine: 'dashboard',
                            operator: 'current-user',
                        });
                        break;
                    case 'release':
                        response = await releaseTicket({ ticketId });
                        break;
                    case 'advance':
                        response = await advanceTicket({ ticketId, evidence: inputText || '' });
                        break;
                    case 'force-release':
                        response = await forceReleaseTicket({ ticketId, reason: inputText || '' });
                        break;
                }

                const result: ActionResult = {
                    ticketId,
                    action,
                    timestamp: response.timestamp,
                    message: response.message,
                };
                announce(`${action} succeeded: ${response.message}`);
                onActionComplete?.(action, result);
            } catch (err: unknown) {
                const error = isApiError(err)
                    ? new Error(err.message)
                    : err instanceof Error
                        ? err
                        : new Error('Unknown error');
                announce(`${action} failed: ${error.message}`);
                onActionError?.(action, error);
            } finally {
                setLoadingAction(null);
                setModalAction(null);
            }
        },
        [ticketId, onActionComplete, onActionError, announce],
    );

    const handleActionClick = useCallback(
        (action: OperatorAction) => {
            if (action === 'advance' || action === 'force-release') {
                setModalAction(action);
            } else {
                executeAction(action);
            }
        },
        [executeAction],
    );

    const handleModalConfirm = useCallback(
        (inputText: string) => {
            if (modalAction) {
                executeAction(modalAction, inputText);
            }
        },
        [modalAction, executeAction],
    );

    // Confirmation modal config
    const modalConfig = modalAction === 'force-release'
        ? {
            variant: 'danger' as const,
            title: 'Force Release Ticket',
            description: "This will forcefully release another operator's active claim. The operator will lose their work lease.",
            warningText: 'This is a destructive action. The current claim holder will be notified.',
            inputLabel: 'Reason',
            inputPlaceholder: 'Explain why this force release is necessary...',
            confirmLabel: 'Force Release',
            minInputLength: 10,
            multiline: false,
        }
        : {
            variant: 'warning' as const,
            title: 'Advance Stage',
            description: `Move ticket ${ticketId || ''} from ${ticketStage || 'current stage'} to the next SDLC stage.`,
            warningText: 'Verify all acceptance criteria are met before advancing.',
            inputLabel: 'Evidence',
            inputPlaceholder: 'Describe the evidence or rationale for advancing...',
            confirmLabel: 'Advance',
            minInputLength: 0,
            multiline: true,
        };

    return (
        <section aria-label="Operator actions">
            <h2 className="text-lg font-semibold text-foreground mb-3">Operator Actions</h2>

            <div
                role="toolbar"
                aria-label="Operator actions"
                className="relative"
            >
                {!isAuthenticated && (
                    <div
                        className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-scrim"
                        aria-hidden="true"
                    >
                        <div className="flex items-center gap-2 text-foreground font-medium">
                            <span aria-hidden="true">🔒</span>
                            <span>Sign in to perform actions</span>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ACTIONS.map(({ action, label, description, icon, colorClass, badge }) => {
                        const enabled = isActionEnabled(action);
                        const loading = loadingAction === action;
                        const disabledReason = getDisabledReason(action);

                        return (
                            <button
                                key={action}
                                type="button"
                                onClick={() => handleActionClick(action)}
                                disabled={!enabled || loading}
                                aria-disabled={!enabled || loading}
                                aria-busy={loading}
                                aria-label={
                                    loading
                                        ? `Processing ${label}...`
                                        : `${label}: ${description}`
                                }
                                title={disabledReason || undefined}
                                className={`
                  flex items-start gap-3 p-4 rounded-lg border border-border border-l-4
                  ${colorClass}
                  bg-surface text-left transition-colors duration-150
                  ${enabled && !loading ? 'hover:bg-surface-alt cursor-pointer' : ''}
                  ${!enabled || loading ? 'opacity-50 cursor-not-allowed' : ''}
                  ${loading ? 'animate-pulse' : ''}
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
                  focus-visible:ring-offset-2 focus-visible:ring-offset-background
                `}
                            >
                                <span className="text-xl mt-0.5 flex-shrink-0">
                                    {loading ? (
                                        <LoadingSpinner />
                                    ) : (
                                        icon
                                    )}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-foreground">
                                            {loading ? 'Processing...' : label}
                                        </span>
                                        {badge && !loading && (
                                            <span className="px-1.5 py-0.5 text-xs font-semibold rounded bg-error text-white">
                                                {badge}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted mt-0.5">{description}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Auth status bar */}
            <div className="flex items-center gap-2 mt-3 text-sm" aria-live="polite">
                <span
                    className={`w-2 h-2 rounded-full ${isAuthenticated ? 'bg-success' : 'bg-error'}`}
                    aria-hidden="true"
                />
                <span className="font-medium text-foreground">
                    {isAuthenticated ? 'Authenticated' : 'Not authenticated'}
                </span>
                {isAuthenticated && (
                    <span className="text-muted">as operator</span>
                )}
            </div>

            {/* Live region for screen readers */}
            <div
                ref={liveRegionRef}
                role="status"
                aria-live="polite"
                className="sr-only"
            />

            {/* Confirmation Modal */}
            <ConfirmationModal
                isOpen={modalAction !== null}
                onClose={() => setModalAction(null)}
                onConfirm={handleModalConfirm}
                isLoading={loadingAction !== null}
                {...modalConfig}
            />
        </section>
    );
}

// ── Loading spinner ──────────────────────────────────────────────────────────

function LoadingSpinner() {
    return (
        <svg
            className="w-5 h-5 animate-spin text-muted"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
        >
            <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
            />
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
        </svg>
    );
}
