import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, setToken } from "../api.js";

export default function AdminLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Set by api.js when the server turned down a saved session.
  const expired = params.has("expired");

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await api.login(password);
      setToken(token);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="login-card" onSubmit={submit}>
        <Link to="/" className="login-brand">
          <span className="brand-mark">Pankaj Enterprises</span>
          <span className="brand-sub">SAREES</span>
        </Link>
        <h1>Admin Login</h1>
        <p className="muted">Sign in to manage your collection.</p>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
          />
        </label>

        {error ? (
          <div className="alert">{error}</div>
        ) : expired ? (
          <div className="alert">Your session expired. Please sign in again.</div>
        ) : null}

        <button className="btn btn-primary full" disabled={loading}>
          {loading ? "Signing in…" : "Sign In"}
        </button>
        <Link to="/" className="link-arrow center">← Back to store</Link>
      </form>
    </div>
  );
}
