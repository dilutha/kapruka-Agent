'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useKaprukStore, useCartTotal } from '@/stores/kapruk.store';
import { apiClient } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

const addressSchema = z.object({
  recipientName: z.string().min(2),
  phone:         z.string().regex(/^(\+94|0)?[1-9]\d{8}$/, 'Invalid Sri Lankan phone number'),
  addressLine1:  z.string().min(5),
  city:          z.string().min(2),
  district:      z.string().min(2),
});
type AddressForm = z.infer<typeof addressSchema>;

interface OrderResponse {
  id: string;
  kaprukOrderId?: string;
}

const DISTRICTS = ['Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya',
  'Galle','Matara','Hambantota','Jaffna','Batticaloa','Trincomalee','Kurunegala',
  'Anuradhapura','Polonnaruwa','Badulla','Ratnapura','Kegalle'];

export default function CheckoutPage() {
  const { items, clearCart } = useKaprukStore();
  const total = useCartTotal();
  const router = useRouter();
  const [step, setStep] = useState<'address' | 'review' | 'done'>('address');
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderId, setOrderId] = useState('');

  const { register, handleSubmit, formState: { errors }, getValues } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
  });

  const onAddressSubmit = () => setStep('review');

  const placeOrder = async () => {
    setPlacingOrder(true);
    try {
      const addr = getValues();
      const result = await apiClient.post<OrderResponse>('/orders', {
        items,
        shippingAddress: addr,
        paymentMethod: 'cod',
      });
      setOrderId(result.kaprukOrderId ?? result.id);
      clearCart();
      setStep('done');
    } catch {
      alert('Order failed. Please try again.');
    } finally {
      setPlacingOrder(false);
    }
  };

  if (step === 'done') return (
    <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: 24, fontFamily: 'var(--k-font-sans)' }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
      <h1 style={{ fontFamily: 'var(--k-font-serif)', fontSize: 26, marginBottom: 8 }}>Order placed!</h1>
      <p style={{ color: 'var(--k-color-text-2)', marginBottom: 24 }}>Your order <strong>{orderId}</strong> has been confirmed.</p>
      <button className="k-btn k-btn-primary" onClick={() => router.push('/chat')}>Continue shopping</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 24, fontFamily: 'var(--k-font-sans)', color: 'var(--k-color-text)' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 24 }}>
        {step === 'address' ? 'Delivery details' : 'Review order'}
      </h1>

      {step === 'address' && (
        <form onSubmit={handleSubmit(onAddressSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {([
            { name: 'recipientName', label: 'Recipient name', placeholder: 'Full name' },
            { name: 'phone',         label: 'Phone number',    placeholder: '077 123 4567' },
            { name: 'addressLine1',  label: 'Address',         placeholder: '123 Main Street' },
            { name: 'city',          label: 'City',            placeholder: 'Colombo' },
          ] satisfies Array<{
            name: keyof Pick<AddressForm, 'recipientName' | 'phone' | 'addressLine1' | 'city'>;
            label: string;
            placeholder: string;
          }>).map(f => (
            <div key={f.name}>
              <label style={{ fontSize: 12, color: 'var(--k-color-text-2)', marginBottom: 4, display: 'block' }}>{f.label}</label>
              <input {...register(f.name)} placeholder={f.placeholder} className="k-input" />
              {errors[f.name as keyof typeof errors] && (
                <span style={{ fontSize: 11, color: 'var(--k-color-danger)' }}>
                  {errors[f.name as keyof typeof errors]?.message as string}
                </span>
              )}
            </div>
          ))}
          <div>
            <label style={{ fontSize: 12, color: 'var(--k-color-text-2)', marginBottom: 4, display: 'block' }}>District</label>
            <select {...register('district')} className="k-input">
              <option value="">Select district</option>
              {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <button type="submit" className="k-btn k-btn-primary" style={{ marginTop: 8, padding: '12px 0' }}>Continue to review</button>
        </form>
      )}

      {step === 'review' && (
        <div>
          <div className="k-card" style={{ padding: 16, marginBottom: 20 }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>Order items ({items.length})</h3>
            {items.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                <span>{i.name} × {i.quantity}</span>
                <span>LKR {(i.unitPrice * i.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--k-color-border)', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
              <span>Total</span>
              <span style={{ color: 'var(--k-color-accent)' }}>LKR {total.toLocaleString()}</span>
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--k-color-text-3)', marginBottom: 16 }}>
            🔒 Payment: Cash on delivery. Your card details are never stored.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="k-btn k-btn-secondary" onClick={() => setStep('address')} style={{ flex: 1 }}>Back</button>
            <button className="k-btn k-btn-primary" onClick={placeOrder} disabled={placingOrder} style={{ flex: 2 }}>
              {placingOrder ? 'Placing order…' : 'Place order'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
