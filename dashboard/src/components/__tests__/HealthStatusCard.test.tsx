import { render, screen, fireEvent } from '@testing-library/react';
import { HealthStatusCard } from '@/components/HealthStatusCard';

describe('HealthStatusCard', () => {
    it('renders service name and connected status', () => {
        render(
            <HealthStatusCard
                serviceName="ForgeOS API"
                status="connected"
            />,
        );
        expect(screen.getByRole('status')).toHaveAttribute(
            'aria-label',
            'ForgeOS API: Connected',
        );
        expect(screen.getByText('ForgeOS API')).toBeInTheDocument();
        expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('renders error status', () => {
        render(
            <HealthStatusCard serviceName="DB" status="error" />,
        );
        expect(screen.getByRole('status')).toHaveAttribute(
            'aria-label',
            'DB: Error',
        );
        expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('renders warning status', () => {
        render(
            <HealthStatusCard serviceName="MCP" status="warning" />,
        );
        expect(screen.getByText('Warning')).toBeInTheDocument();
    });

    it('renders checking status', () => {
        render(
            <HealthStatusCard serviceName="SSE" status="checking" />,
        );
        expect(screen.getByText('Checking...')).toBeInTheDocument();
    });

    it('displays endpoint when provided', () => {
        render(
            <HealthStatusCard
                serviceName="API"
                status="connected"
                endpoint="/api/health"
            />,
        );
        expect(screen.getByText('/api/health')).toBeInTheDocument();
    });

    it('displays response time when provided', () => {
        render(
            <HealthStatusCard
                serviceName="API"
                status="connected"
                responseTime="42ms"
            />,
        );
        expect(screen.getByText('42ms')).toBeInTheDocument();
    });

    it('displays message when provided', () => {
        render(
            <HealthStatusCard
                serviceName="API"
                status="error"
                message="Connection refused"
            />,
        );
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });

    it('calls onCheck when check button is clicked', () => {
        const handleCheck = jest.fn();
        render(
            <HealthStatusCard
                serviceName="API"
                status="connected"
                onCheck={handleCheck}
            />,
        );
        const checkButton = screen.getByRole('button');
        fireEvent.click(checkButton);
        expect(handleCheck).toHaveBeenCalledTimes(1);
    });
});
