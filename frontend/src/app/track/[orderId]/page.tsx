'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

interface TrackingData {
  orderId:           string;
  status:            string;
  statusLabel:       string;
  estimatedDelivery?: string;
  isDelivered:       boolean;
  events: Array<{ eventType: string; description: string; location?: string; timestamp: string }>;
}

export default function TrackingPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [data, setData] = useState<TrackingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId) return;
    apiClient.get<TrackingData>(`/orders/${orderId}/track`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading tracking info…</div>;
  if (!data)   return <div style={{ padding: 40, textAlign: 'center' }}>Order not found.</div>;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 24, fontFamily: 'var(--k-font-sans)', color: 'var(--k-color-text)' }}>
      <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 4 }}>Order #{orderId}</h1>
      <div style={{ fontSize: 18, color: 'var(--k-color-accent)', fontWeight: 500, marginBottom: 8 }}>{data.statusLabel}</div>
      {data.estimatedDelivery && (
        <p style={{ fontSize: 13, color: 'var(--k-color-text-2)', marginBottom: 24 }}>
          Estimated delivery: {data.estimatedDelivery}
        </p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {data.events.map((evt, i) => (
          <div key={i} style={{ display: 'flex', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: i === 0 ? 'var(--k-color-accent)' : 'var(--k-color-border-2)', flexShrink: 0, marginTop: 4 }} />
              {i < data.events.length - 1 && <div style={{ width: 1, flex: 1, background: 'var(--k-color-border)', minHeight: 24 }} />}
            </div>
            <div style={{ paddingBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{evt.description}</div>
              {evt.location && <div style={{ fontSize: 12, color: 'var(--k-color-text-3)' }}>{evt.location}</div>}
              <div style={{ fontSize: 11, color: 'var(--k-color-text-3)', marginTop: 2 }}>
                {new Date(evt.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}