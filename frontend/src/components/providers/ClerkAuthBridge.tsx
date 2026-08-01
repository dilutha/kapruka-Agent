'use client';

import { useAuth } from '@clerk/nextjs';
import { useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

export function ClerkAuthBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    // Registering a no-op provider even while signed out would make
    // apiClient.hasIdentity() (used to coordinate the very first guest-token
    // request — see api-client.ts) think Clerk auth is available when it
    // isn't. Only register a provider once there's an actual session.
    apiClient.setAuthTokenProvider(isSignedIn ? () => getToken() : null);

    return () => {
      apiClient.setAuthTokenProvider(null);
    };
  }, [getToken, isSignedIn]);

  return null;
}
