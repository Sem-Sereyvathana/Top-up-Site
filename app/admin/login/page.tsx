"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Set once the password step succeeds for an account with app
  // authentication enabled — switches the form to the code-entry step.
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");

      if (data.requiresTotp) {
        setPendingToken(data.pendingToken);
        setLoading(false);
        return;
      }

      router.push("/admin");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pendingToken, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      router.push("/admin");
      router.refresh();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="flex items-center gap-2 justify-center mb-8">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-fox-primary to-fox-accent flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6 text-black">
              <path d="M12 2L3 7v6c0 5 3.5 9 9 10 5.5-1 9-5 9-10V7l-9-5z" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <span className="font-display text-2xl font-bold">
            TopUp<span className="text-fox-primary">Fox</span>
          </span>
        </Link>

        <div className="card p-8">
          {!pendingToken ? (
            <>
              <h1 className="font-display text-2xl font-bold mb-2">Admin Login</h1>
              <p className="text-sm text-fox-muted mb-6">Sign in to manage orders and products.</p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    type="password"
                    className="input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? "Signing in..." : "Sign In"}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="font-display text-2xl font-bold mb-2">Enter your code</h1>
              <p className="text-sm text-fox-muted mb-6">
                Open your authenticator app and enter the 6-digit code. Lost your device? Enter a backup code instead.
              </p>

              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div>
                  <label className="label">Code</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    className="input tracking-[0.3em] text-center text-lg font-mono"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    autoFocus
                    required
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
                    {error}
                  </div>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? "Verifying..." : "Verify"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingToken(null);
                    setCode("");
                    setError(null);
                  }}
                  className="w-full text-center text-xs text-fox-muted hover:text-fox-text"
                >
                  ← Back to sign in
                </button>
              </form>
            </>
          )}

          <p className="text-xs text-fox-muted text-center mt-6">
            Authorized personnel only.
          </p>
        </div>
      </div>
    </div>
  );
}
