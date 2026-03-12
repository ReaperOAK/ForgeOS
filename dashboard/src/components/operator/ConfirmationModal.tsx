'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

/** Visual style variant for the confirmation modal. */
export type ModalVariant = 'danger' | 'warning';

/**
 * Props for the {@link ConfirmationModal} component.
 *
 * @remarks
 * The modal requires the user to provide text input (e.g., a reason or
 * evidence) before confirming. Use `minInputLength` to enforce a minimum.
 * Keyboard shortcuts: Escape to close, Ctrl/Cmd+Enter to confirm.
 */
export interface ConfirmationModalProps {
    /** Whether the modal is visible. */
    isOpen: boolean;
    /** Called when the user dismisses the modal (Escape, backdrop click, or Cancel button). */
    onClose: () => void;
    /** Called with the user-entered text when the confirm button is clicked. */
    onConfirm: (inputText: string) => void;
    /** Visual style — `'danger'` for destructive actions, `'warning'` for cautionary ones. */
    variant: ModalVariant;
    /** Modal heading text. */
    title: string;
    /** Body description explaining the action. */
    description: string;
    /** Warning banner text shown in an alert box. */
    warningText: string;
    /** Label for the text input field. */
    inputLabel: string;
    /** Placeholder text for the input field. */
    inputPlaceholder: string;
    /** Text shown on the confirm button. */
    confirmLabel: string;
    /** Minimum character count required before the confirm button is enabled. Defaults to `0`. */
    minInputLength?: number;
    /** When `true`, disables all interactive elements and shows a loading state. */
    isLoading?: boolean;
    /** When `true`, renders a multi-line `<textarea>` instead of a single-line `<input>`. */
    multiline?: boolean;
}

// ── Variant styling ──────────────────────────────────────────────────────────

const VARIANT_STYLES = {
    danger: {
        iconColor: 'text-error',
        bannerBg: 'bg-error-muted',
        bannerBorder: 'border-l-error',
        confirmBg: 'bg-error hover:bg-red-600',
    },
    warning: {
        iconColor: 'text-warning',
        bannerBg: 'bg-warning-muted',
        bannerBorder: 'border-l-warning',
        confirmBg: 'bg-info hover:bg-blue-600',
    },
} as const;

// ── Component ────────────────────────────────────────────────────────────────

/**
 * Accessible confirmation dialog for destructive or important operator actions.
 *
 * Renders a modal overlay with a warning banner, a text input field, and
 * confirm / cancel buttons. Includes a focus trap, Escape-to-close, and
 * Ctrl/Cmd+Enter to confirm.
 *
 * @remarks
 * - The modal restores focus to the previously focused element on close.
 * - Input auto-focuses when the modal opens.
 * - Uses `role="dialog"`, `aria-modal`, and `aria-labelledby`/`aria-describedby`
 *   for screen reader support.
 * - On mobile, the modal slides up from the bottom (`items-end`);
 *   on desktop it centers vertically.
 *
 * @example
 * ```tsx
 * <ConfirmationModal
 *   isOpen={showModal}
 *   onClose={() => setShowModal(false)}
 *   onConfirm={(reason) => handleForceRelease(reason)}
 *   variant="danger"
 *   title="Force Release Ticket"
 *   description="This will remove another operator's claim."
 *   warningText="The current claim holder will be notified."
 *   inputLabel="Reason"
 *   inputPlaceholder="Explain why this is necessary..."
 *   confirmLabel="Force Release"
 *   minInputLength={10}
 * />
 * ```
 */
export function ConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    variant,
    title,
    description,
    warningText,
    inputLabel,
    inputPlaceholder,
    confirmLabel,
    minInputLength = 0,
    isLoading = false,
    multiline = false,
}: ConfirmationModalProps) {
    const [inputValue, setInputValue] = useState('');
    const [showError, setShowError] = useState(false);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    const isInputValid = inputValue.length >= minInputLength;
    const styles = VARIANT_STYLES[variant];

    // Reset state when modal opens; save and restore focus
    useEffect(() => {
        if (isOpen) {
            previousFocusRef.current = document.activeElement as HTMLElement;
            setInputValue('');
            setShowError(false);
            // Defer focus to allow render
            const timer = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        } else if (previousFocusRef.current) {
            previousFocusRef.current.focus();
            previousFocusRef.current = null;
        }
    }, [isOpen]);

    // Focus trap
    useEffect(() => {
        if (!isOpen) return;

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape' && !isLoading) {
                e.preventDefault();
                onClose();
                return;
            }

            // Ctrl+Enter to confirm
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && isInputValid && !isLoading) {
                e.preventDefault();
                onConfirm(inputValue);
                return;
            }

            // Focus trap on Tab
            if (e.key === 'Tab' && modalRef.current) {
                const focusable = modalRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
                );
                if (focusable.length === 0) return;

                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, isLoading, isInputValid, inputValue, onClose, onConfirm]);

    const handleConfirmClick = useCallback(() => {
        if (!isInputValid) {
            setShowError(true);
            inputRef.current?.focus();
            return;
        }
        onConfirm(inputValue);
    }, [isInputValid, inputValue, onConfirm]);

    const handleInputBlur = useCallback(() => {
        if (!isInputValid && inputValue.length > 0) {
            setShowError(true);
        }
    }, [isInputValid, inputValue.length]);

    const handleInputChange = useCallback((value: string) => {
        setInputValue(value);
        setShowError(false);
    }, []);

    if (!isOpen) return null;

    const inputId = 'confirmation-input';
    const errorId = 'confirmation-error';
    const titleId = 'modal-title';
    const descId = 'modal-description';

    return (
        <>
            {/* Scrim / backdrop */}
            <div
                className="fixed inset-0 z-50 bg-scrim"
                onClick={isLoading ? undefined : onClose}
                aria-hidden="true"
                data-testid="modal-scrim"
            />

            {/* Modal dialog */}
            <div
                className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descId}
            >
                <div
                    ref={modalRef}
                    className={`
            bg-surface border border-border shadow-lg w-full
            rounded-t-xl md:rounded-xl md:max-w-md md:mx-4
          `}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border">
                        <div className="flex items-center gap-2">
                            <span className={styles.iconColor} aria-hidden="true">
                                {variant === 'danger' ? '⚠' : '⚡'}
                            </span>
                            <h2 id={titleId} className="text-lg font-bold text-foreground">
                                {title}
                            </h2>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isLoading}
                            aria-label="Close dialog"
                            className="p-1 rounded text-muted hover:text-foreground transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                            ✕
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-4 space-y-4">
                        <p id={descId} className="text-sm text-muted">
                            {description}
                        </p>

                        {/* Warning banner */}
                        <div
                            className={`${styles.bannerBg} ${styles.bannerBorder} border-l-4 rounded p-3`}
                            role="alert"
                        >
                            <p className="text-sm font-medium text-foreground">
                                <span aria-hidden="true">⚠ </span>
                                {warningText}
                            </p>
                        </div>

                        {/* Input field */}
                        <div>
                            <label htmlFor={inputId} className="block text-sm font-medium text-foreground mb-1">
                                {inputLabel}
                                {minInputLength > 0 && (
                                    <span className="text-muted font-normal"> (min {minInputLength} characters)</span>
                                )}
                            </label>
                            {multiline ? (
                                <textarea
                                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                                    id={inputId}
                                    value={inputValue}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onBlur={handleInputBlur}
                                    placeholder={inputPlaceholder}
                                    disabled={isLoading}
                                    aria-required={minInputLength > 0}
                                    aria-invalid={showError}
                                    aria-describedby={showError ? errorId : undefined}
                                    className={`
                    w-full bg-background border rounded-md px-3 py-2 text-sm text-foreground
                    placeholder:text-muted min-h-[80px] resize-y
                    focus:outline-none focus:ring-2 focus:ring-focus focus:border-focus
                    disabled:opacity-50
                    ${showError ? 'border-error focus:ring-error' : 'border-border'}
                  `}
                                />
                            ) : (
                                <input
                                    ref={inputRef as React.RefObject<HTMLInputElement>}
                                    id={inputId}
                                    type="text"
                                    value={inputValue}
                                    onChange={(e) => handleInputChange(e.target.value)}
                                    onBlur={handleInputBlur}
                                    placeholder={inputPlaceholder}
                                    disabled={isLoading}
                                    aria-required={minInputLength > 0}
                                    aria-invalid={showError}
                                    aria-describedby={showError ? errorId : undefined}
                                    className={`
                    w-full bg-background border rounded-md px-3 py-2 text-sm text-foreground
                    placeholder:text-muted
                    focus:outline-none focus:ring-2 focus:ring-focus focus:border-focus
                    disabled:opacity-50
                    ${showError ? 'border-error focus:ring-error' : 'border-border'}
                  `}
                                />
                            )}
                            {showError && (
                                <p
                                    id={errorId}
                                    className="text-xs text-error mt-1 font-medium"
                                    aria-live="assertive"
                                >
                                    {inputLabel} must be at least {minInputLength} characters
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="flex flex-col-reverse md:flex-row justify-end gap-3 p-4 border-t border-border">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isLoading}
                            className="px-4 py-2 rounded-md text-sm font-medium border border-border text-muted
                hover:text-foreground hover:bg-surface-alt transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
                disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmClick}
                            disabled={!isInputValid || isLoading}
                            aria-busy={isLoading}
                            className={`
                px-4 py-2 rounded-md text-sm font-semibold text-white transition-colors
                ${styles.confirmBg}
                disabled:opacity-50 disabled:cursor-not-allowed
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
                focus-visible:ring-offset-2 focus-visible:ring-offset-surface
              `}
                        >
                            {isLoading ? 'Processing...' : confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
