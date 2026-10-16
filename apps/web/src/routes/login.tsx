import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { authRedirectSchema } from "@/lib/auth-redirect";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
  validateSearch: z.object({ redirect: authRedirectSchema }),
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(false);
  const { redirect } = Route.useSearch();

  return showSignIn ? (
    <SignInForm redirectTo={redirect} onSwitchToSignUp={() => setShowSignIn(false)} />
  ) : (
    <SignUpForm redirectTo={redirect} onSwitchToSignIn={() => setShowSignIn(true)} />
  );
}
