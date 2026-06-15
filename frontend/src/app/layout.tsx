import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { QueryClientProviderWrapper } from '@/components/providers/QueryClientProvider';
import '@/styles/design-system.css';
import './globals.css';

export const metadata: Metadata = {
  title:       'Kaprubot — AI Shopping for Sri Lanka',
  description: 'Shop Kapruka conversationally in English, Sinhala, or Singlish.',
  manifest:    '/manifest.json',
  themeColor:  '#0e0e10',
  icons:       { icon: '/favicon.ico', apple: '/apple-touch-icon.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ClerkProvider>
          <QueryClientProviderWrapper>
            {children}
          </QueryClientProviderWrapper>
        </ClerkProvider>
      </body>
    </html>
  );
}