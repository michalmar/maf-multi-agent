"use client";

import { useCallback } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError, InteractionStatus } from "@azure/msal-browser";
import { fabricScopes } from "@/lib/msal-config";

/**
 * Hook for acquiring a Fabric API token via MSAL.
 *
 * Uses redirect flow for login (more reliable than popup in Next.js).
 * Tries silent acquisition first for token requests.
 */
export function useFabricToken() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const acquireToken = useCallback(async (): Promise<string | null> => {
    if (inProgress !== InteractionStatus.None) {
      console.warn("[useFabricToken] Interaction in progress, skipping token acquisition");
      return null;
    }

    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

    if (account) {
      try {
        const response = await instance.acquireTokenSilent({
          scopes: fabricScopes,
          account,
        });
        console.log("[useFabricToken] Token acquired silently for", account.username);
        return response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          // Silent failed — redirect to login for consent/re-auth
          console.warn("[useFabricToken] Silent failed, redirecting for consent");
          await instance.acquireTokenRedirect({ scopes: fabricScopes });
          return null; // page will redirect
        }
        console.error("[useFabricToken] Silent token acquisition failed:", error);
        return null;
      }
    }

    // Not signed in — redirect to login
    console.warn("[useFabricToken] No account found, redirecting to login");
    await instance.loginRedirect({ scopes: fabricScopes });
    return null; // page will redirect
  }, [instance, inProgress]);

  const login = useCallback(async () => {
    try {
      await instance.loginRedirect({ scopes: fabricScopes });
    } catch (error) {
      console.error("[useFabricToken] Login redirect failed:", error);
    }
  }, [instance]);

  const logout = useCallback(async () => {
    try {
      await instance.logoutRedirect();
    } catch (error) {
      console.error("[useFabricToken] Logout failed:", error);
    }
  }, [instance]);

  const account = instance.getActiveAccount();

  return {
    acquireToken,
    login,
    logout,
    isAuthenticated,
    accountName: account?.name ?? account?.username ?? null,
  };
}
