import { beforeEach, describe, test } from "@e2e-dev/web";
import { expect } from "e2e";

describe("auth forms", { tags: ["frontend", "smoke"] }, () => {
  beforeEach(async ({ app, browser }) => {
    // Keep these frontend tests independent of the local auth server and database.
    await browser.route("**/api/auth/get-session", async (route) => {
      await route.fulfill({ json: null });
    });
    await app.open("/login");
  });

  test("switches between signup and sign-in", async ({ screen }) => {
    await expect(screen.getByRole("heading", "Create Account")).toBeVisible();
    await expect(screen.getByLabel("Name")).toBeVisible();

    await screen.getByRole("button", "Already have an account? Sign In").click();
    await expect(screen.getByRole("heading", "Welcome Back")).toBeVisible();
    await expect(screen.getByLabel("Email")).toBeVisible();
    await expect(screen.getByLabel("Password")).toBeVisible();
    await expect(screen.getByLabel("Name")).toHaveCount(0);

    await screen.getByRole("button", "Need an account? Sign Up").click();
    await expect(screen.getByRole("heading", "Create Account")).toBeVisible();
    await expect(screen.getByLabel("Name")).toBeVisible();
  });

  test("shows validation errors for a short name and password", async ({ screen }) => {
    await screen.getByLabel("Name").fill("A");
    await screen.getByLabel("Email").fill("new@example.test");
    await screen.getByLabel("Password").fill("short");
    await screen.getByRole("button", "Sign Up").click();

    await expect(screen.getByText("Name must be at least 2 characters")).toBeVisible();
    await expect(screen.getByText("Password must be at least 8 characters")).toBeVisible();
    await expect(screen.getByRole("heading", "Create Account")).toBeVisible();
  });
});
