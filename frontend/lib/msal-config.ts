/**
 * MSAL configuration for Fabric Data Agent authentication.
 *
 * The SPA app registration (maf-multi-agent-spa) has delegated permission
 * for Fabric DataAgent.Execute.All. Users sign in once and the token is
 * silently refreshed for subsequent requests.
 */

import { Configuration, LogLevel } from "@azure/msal-browser";

const MSAL_CLIENT_ID = process.env.NEXT_PUBLIC_MSAL_CLIENT_ID ?? "ee6eb930-e782-4588-9b6b-73569e0ad67e";
const MSAL_TENANT_ID = process.env.NEXT_PUBLIC_MSAL_TENANT_ID ?? "a7b1484c-f66a-496a-b1cf-35631a50396c";
const MSAL_AUTHORITY = `https://login.microsoftonline.com/${MSAL_TENANT_ID}`;

export const msalConfig: Configuration = {
  auth: {
    clientId: MSAL_CLIENT_ID,
    authority: MSAL_AUTHORITY,
    redirectUri: typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
  },
  cache: {
    cacheLocation: "localStorage",
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (_level, message) => {
        console.debug("[MSAL]", message);
      },
    },
  },
};

/** Scopes requested when acquiring a Fabric token. */
export const fabricScopes = ["https://api.fabric.microsoft.com/DataAgent.Execute.All"];
