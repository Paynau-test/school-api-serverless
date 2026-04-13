import { callProcedure } from "../lib/db.js";
import { withAuth } from "../lib/auth.js";
import { success, notFound, serverError } from "../lib/response.js";

async function meHandler(event) {
  try {
    const { user_id } = event.auth;
    const rows = await callProcedure("sp_get_user_by_id", [user_id]);

    if (!rows.length) {
      return notFound("User not found");
    }

    return success(rows[0]);
  } catch (err) {
    console.error("me error:", err);
    return serverError();
  }
}

// Any authenticated user can access their own profile
export const handler = withAuth(meHandler);
