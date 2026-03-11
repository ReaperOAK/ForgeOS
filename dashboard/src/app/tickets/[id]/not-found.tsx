import Link from 'next/link';

/**
 * Custom 404 page shown when a ticket ID does not exist.
 *
 * Provides a link back to the pipeline view.
 *
 * @returns The ticket-not-found error page
 */
export default function TicketNotFound() {
    return (
        <div className="max-w-md mx-auto text-center py-20">
            <h1 className="text-6xl font-bold text-muted mb-4">404</h1>
            <p className="text-lg text-foreground mb-2">Ticket Not Found</p>
            <p className="text-sm text-muted mb-6">
                The ticket you&apos;re looking for doesn&apos;t exist or has been removed.
            </p>
            <Link
                href="/pipeline"
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-inverse rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors"
            >
                Back to Pipeline
            </Link>
        </div>
    );
}
