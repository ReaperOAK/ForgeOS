import Link from 'next/link';
import type { BreadcrumbItem } from '@/lib/types';

interface BreadcrumbProps {
    items: BreadcrumbItem[];
}

export function Breadcrumb({ items }: BreadcrumbProps) {
    return (
        <nav aria-label="Breadcrumbs">
            <ol className="flex items-center gap-1 text-sm">
                {items.map((item, index) => {
                    const isLast = index === items.length - 1;
                    return (
                        <li key={item.label} className="flex items-center gap-1">
                            {index > 0 && (
                                <span aria-hidden="true" className="text-muted">
                                    &gt;
                                </span>
                            )}
                            {isLast || !item.href ? (
                                <span
                                    className={
                                        isLast ? 'text-foreground font-medium' : 'text-muted'
                                    }
                                    aria-current={isLast ? 'page' : undefined}
                                >
                                    {item.label}
                                </span>
                            ) : (
                                <Link
                                    href={item.href}
                                    className="text-muted hover:text-foreground rounded focus-ring"
                                >
                                    {item.label}
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ol>
        </nav>
    );
}
