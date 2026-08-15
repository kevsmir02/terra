import { describe, expect, it } from "vitest";
import {
  connectionDetails,
  connectionString,
  generatePassword,
} from "@/modules/services/lib/connection";
import { statusColor } from "@/modules/services/ServiceRow";

describe("connectionString", () => {
  it("builds a pasteable DSN per engine", () => {
    expect(connectionString("mariadb", 3306, "secret")).toBe(
      "mysql://root:secret@127.0.0.1:3306/terra",
    );
    expect(connectionString("postgres", 5432, "secret")).toBe(
      "postgresql://terra:secret@127.0.0.1:5432/terra",
    );
    expect(connectionString("redis", 6379, "secret")).toBe(
      "redis://127.0.0.1:6379",
    );
  });

  it("has no DSN for the web UIs", () => {
    expect(connectionString("mailpit", 8025, "secret")).toBeNull();
    expect(connectionString("adminer", 8026, "secret")).toBeNull();
  });
});

describe("connectionDetails", () => {
  it("returns labeled credentials for database engines", () => {
    expect(connectionDetails("mariadb", 3306, "secret")).toEqual({
      host: "127.0.0.1",
      port: 3306,
      user: "root",
      password: "secret",
      database: "terra",
      dsn: "mysql://root:secret@127.0.0.1:3306/terra",
    });
    expect(connectionDetails("postgres", 5432, "secret")).toEqual({
      host: "127.0.0.1",
      port: 5432,
      user: "terra",
      password: "secret",
      database: "terra",
      dsn: "postgresql://terra:secret@127.0.0.1:5432/terra",
    });
    expect(connectionDetails("redis", 6379, "secret")).toEqual({
      host: "127.0.0.1",
      port: 6379,
      user: null,
      password: null,
      database: null,
      dsn: "redis://127.0.0.1:6379",
    });
  });

  it("has no details for web UIs", () => {
    expect(connectionDetails("mailpit", 8025, "secret")).toBeNull();
    expect(connectionDetails("adminer", 8026, "secret")).toBeNull();
    expect(connectionDetails("web", 8000, "secret")).toBeNull();
  });
});

describe("generatePassword", () => {
  it("only emits characters that never need YAML escaping", () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/^[A-Za-z0-9_-]{24}$/);
    }
  });
});

describe("statusColor", () => {
  it("maps all four row states to a dot color", () => {
    expect(statusColor("healthy")).toBe("bg-status-ok");
    expect(statusColor("starting")).toBe("bg-status-warning");
    expect(statusColor("unhealthy")).toBe("bg-destructive");
    expect(statusColor("stopped")).toBe("bg-muted");
  });
});
