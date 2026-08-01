import type { Metadata, Viewport } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { ClerkAuthBridge } from '@/components/providers/ClerkAuthBridge';
import { QueryClientProviderWrapper } from '@/components/providers/QueryClientProvider';
import '@/styles/design-system.css';
import './globals.css';

export const metadata: Metadata = {
  title:       'Kaprubot — AI Shopping for Sri Lanka',
  description: 'Shop Kapruka conversationally in English, Sinhala, or Singlish.',
  manifest:    '/manifest.json',
  icons:       { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ClerkProvider>
          <QueryClientProviderWrapper>
            <ClerkAuthBridge />
            {children}
          </QueryClientProviderWrapper>
        </ClerkProvider>
      </body>
    </html>
  );
}
