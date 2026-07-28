import { currentUser } from "@/lib/auth";

/**
 * Placeholder home page. The market list replaces this — it exists now only so
 * the auth flow has somewhere to land after a successful sign-in.
 */
export default async function HomePage() {
  const user = await currentUser();

  return (
    <div className="home">
      <h1>Prediction Market</h1>
      {user ? (
        <p>
          Signed in as <strong>{user.handle ?? user.email}</strong> with{" "}
          <strong>{user.balance.toLocaleString()} points</strong>.
        </p>
      ) : (
        <p>
          <a href="/signin">Sign in</a> to start trading.
        </p>
      )}
      <p className="muted">Markets are coming next.</p>
    </div>
  );
}
