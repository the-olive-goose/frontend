// Shared configuration + credentials for the isolated e2e stack.
// Everything here is deliberately test-only; nothing points at production
// unless SEED_SOURCE_DATABASE_URL is explicitly provided (read-only content copy).

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const PG_PORT = Number(process.env.E2E_PG_PORT) || 5433;
export const PG_DATABASE = "olive_test";
export const PG_USER = "postgres";
export const PG_PASSWORD = "postgres";
export const PG_DATA_DIR = process.env.E2E_PG_DATA_DIR || path.join(REPO_ROOT, ".e2e-pgdata");
export const TEST_DATABASE_URL =
  `postgresql://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DATABASE}`;

export const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT) || 3002;
export const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT) || 8081;
export const API_URL = `http://localhost:${BACKEND_PORT}`;
export const BASE_URL = `http://localhost:${FRONTEND_PORT}`;

// Seeded fixtures. Admin password hash is bcrypt("E2eAdmin123!"), cost 10.
export const ADMIN = { email: "e2e-admin@test.local", password: "E2eAdmin123!" };
export const ADMIN_PASSWORD_HASH =
  "$2a$10$r.uiYaq6WeUsL5yheEzQ1Oup06Vq8wafTH/mlYWV88UPAEahfCpZi";
export const SHOPPER = { email: "e2e-shopper@test.local", password: "E2eShopper123" };
export const SHOPPER2 = { email: "e2e-shopper2@test.local", password: "E2eShopper123" };
// The abandoned-cart suite's own shopper. Separate from the two above because
// they are consumed one-way by the cancellation/return lifecycles, and this one
// needs a basket nobody else has ordered against — see seedAbandonedCart.
export const CART_SHOPPER = { email: "e2e-cart@test.local", password: "E2eShopper123" };

// Where to copy storefront content (site_settings, shop tables) from. Optional:
// when unset, the backend boots with only its built-in default content, which is
// enough for the API/admin suites but leaves the storefront sparse. Point this at
// a real (or staging) DATABASE_URL to mirror live content — it is opened strictly
// read-only. Falls back to the backend's own .env DATABASE_URL when present.
export const SEED_SOURCE_DATABASE_URL =
  process.env.SEED_SOURCE_DATABASE_URL || null;
