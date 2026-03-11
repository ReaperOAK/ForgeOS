import type { Metadata } from 'next';
import { ThemeProvider } from '@/lib/theme';
import { DashboardShell } from '@/components/DashboardShell';
import '@/styles/globals.css';

export const metadata: Metadata = {
    title: 'ForgeOS Dashboard',
    description: 'Multi-agent orchestration dashboard',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <script
                    dangerouslySetInnerHTML={{
                        __html: `(function(){try{var t=localStorage.getItem('forgeos-theme');if(!t)t=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t)}catch(e){}})()`,
                    }}
                />
            </head>
            <body className="bg-background text-foreground antialiased">
                <ThemeProvider>
                    <DashboardShell>{children}</DashboardShell>
                </ThemeProvider>
            </body>
        </html>
    );
}
