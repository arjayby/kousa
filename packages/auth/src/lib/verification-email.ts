export async function sendLocalVerificationEmail({ email, url }: { email: string; url: string }) {
  const response = await fetch("http://127.0.0.1:8025/api/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: "no-reply@kousa.test", Name: "Kousa" },
      To: [{ Email: email }],
      Subject: "Verify your Kousa email",
      Text: `Verify your email by opening this link:\n${url}`,
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("The local verification inbox is unavailable");
}
