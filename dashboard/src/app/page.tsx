import { Clock, Users, HeartPulse, AlertTriangle } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';

export default function DashboardPage() {
    return (
        <div>
            <h1 className="text-2xl font-bold mb-6">Dashboard Overview</h1>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                <MetricCard
                    label="Active Tickets"
                    value={12}
                    icon={<Clock size={16} />}
                    trend={{ direction: 'up', value: '+3' }}
                />
                <MetricCard
                    label="Active Agents"
                    value={6}
                    icon={<Users size={16} />}
                />
                <MetricCard
                    label="Services Healthy"
                    value="5/5"
                    icon={<HeartPulse size={16} />}
                />
                <MetricCard
                    label="Blocked Tickets"
                    value={2}
                    icon={<AlertTriangle size={16} />}
                    trend={{ direction: 'down', value: '-1' }}
                />
            </div>

            <section className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
                <div className="bg-surface border border-border rounded-lg p-4">
                    <p className="text-muted text-sm">
                        Activity feed will be populated when connected to the ForgeOS API.
                    </p>
                </div>
            </section>
        </div>
    );
}
