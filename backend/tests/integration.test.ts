import { describe, test, expect } from "bun:test";
import { api, authenticatedApi, signUpTestUser, expectStatus, connectWebSocket, connectAuthenticatedWebSocket, waitForMessage } from "./helpers";

describe("API Integration Tests", () => {
  // Shared state for chaining tests (e.g., created resource IDs, auth tokens)
  // let authToken: string;
  // let resourceId: string;

  // TODO: Add integration tests here.
  // Tests run sequentially within describe, so you can chain state between them.
  //
  // Example without auth:
  //
  // test("Create resource", async () => {
  //   const res = await api("/api/resources", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ name: "Test" }),
  //   });
  //   await expectStatus(res, 201);
  //   const data = await res.json();
  //   resourceId = data.id;
  // });
  //
  // Example with auth (cleanup is automatic):
  //
  // test("Sign up test user", async () => {
  //   const { token, user } = await signUpTestUser();
  //   authToken = token;
  //   expect(authToken).toBeDefined();
  // });
  //
  // test("Create authenticated resource", async () => {
  //   const res = await authenticatedApi("/api/resources", authToken, {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ name: "Test" }),
  //   });
  //   await expectStatus(res, 201);
  // });
});
