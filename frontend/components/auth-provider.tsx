"use client";

import { MsalProvider } from "@azure/msal-react";
import { PublicClientApplication, EventType, EventMessage, AuthenticationResult } from "@azure/msal-browser";
import { useEffect, useRef, useState } from "react";
import { msalConfig } from "@/lib/msal-config";

let msalInstance: PublicClientApplication | null = null;

function getMsalInstance(): PublicClientApplication {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(msalConfig);
  }
  return msalInstance;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const instanceRef = useRef<PublicClientApplication | null>(null);

  useEffect(() => {
    const instance = getMsalInstance();
    instanceRef.current = instance;

    instance.initialize().then(() => {
      // Handle redirect response if returning from auth flow
      instance.handleRedirectPromise().then((response) => {
        if (response) {
          instance.setActiveAccount(response.account);
        } else {
          const accounts = instance.getAllAccounts();
          if (accounts.length > 0) {
            instance.setActiveAccount(accounts[0]);
          }
        }
        setIsReady(true);
      });

      // Set active account on login success
      instance.addEventCallback((event: EventMessage) => {
        if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
          const result = event.payload as AuthenticationResult;
          instance.setActiveAccount(result.account);
        }
      });
    });
  }, []);

  if (!isReady || !instanceRef.current) {
    return <>{children}</>;
  }

  return <MsalProvider instance={instanceRef.current}>{children}</MsalProvider>;
}
