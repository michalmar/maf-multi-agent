"use client";

import { useCallback } from "react";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError, InteractionStatus } from "@azure/msal-browser";
import { fabricScopes } from "@/lib/msal-config";

/**
 * Hook for acquiring a Fabric API token via MSAL.
 *
 * Tries silent acquisition first (cached token). Falls back to
 * a popup login if the user hasn't signed in yet.
 */
export function useFabricToken() {
  const { instance, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  const acquireToken = useCallback(async (): Promise<string | null> => {
    if (inProgress !== InteractionStatus.None) return null;

    const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];

    if (account) {
      try {
        const response = await instance.acquireTokenSilent({
          scopes: fabricScopes,
          account,
        });
        return response.accessToken;
      } catch (error) {
        if (error instanceof InteractionRequiredAuthError) {
          const response = await instance.acquireTokenPopup({ scopes: fabricScopes });
          return response.accessToken;
        }
        console.error("[useFabricToken] Silent token acquisition failed:", error);
        return null;
      }
    }

    // Not signed in — trigger popup login
    try {
      const response = await instance.loginPopup({ scopes: fabricScopes });
      instance.setActiveAccount(response.account);
      return response.accessToken;
    } catch (error) {
      console.error("[useFabricToken] Login failed:", error);
      return null;
    }
  }, [instance, inProgress]);

  const login = useCallback(async () => {
    try {
      const response = await instance.loginPopup({ scopes: fabricScopes });
      instance.setActiveAccount(response.account);
    } catch (error) {
      console.error("[useFabricToken] Login failed:", error);
    }
  }, [instance]);

  const logout = useCallback(async () => {
    try {
      await instance.logoutPopup();
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
