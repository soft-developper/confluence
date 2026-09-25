"use client";

import { useCallback, useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useConnection, useSignMessage } from "wagmi";
import { ApiError, fetchNonce, verifySignIn } from "@/lib/api";
import { saveSession } from "@/lib/session";

/**
 * Sign-In with Ethereum (EIP-4361): a free signature, no transaction. The message is
 * bound to this site (domain and URI) and to a one-time nonce from the API.
 */
export function useSignIn() {
  const { address, chainId } = useConnection();
  const { mutateAsync: signMessage } = useSignMessage();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const signIn = useCallback(async () => {
    if (!address || !chainId) return false;
    setState({ busy: true });
    try {
      const nonce = await fetchNonce();
      const message = createSiweMessage({
        address,
        chainId,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        issuedAt: new Date(),
        statement: "Sign in to Confluence. This is a free signature, not a transaction.",
      });
      const signature = await signMessage({ message });
      const s = await verifySignIn(message, signature);
      saveSession({ address: s.address, token: s.token, expiresAt: s.expiresAt });
      setState({ busy: false });
      return true;
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.code === "unsupported_chain"
            ? "Switch your wallet to a supported network, then sign in."
            : e.message
          : /reject|denied|cancel/i.test(String((e as Error)?.message))
            ? "You declined the signature. Nothing was changed."
            : "Sign-in failed. Try again.";
      setState({ busy: false, error: msg });
      return false;
    }
  }, [address, chainId, signMessage]);

  return { signIn, ...state };
}
