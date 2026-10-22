import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface CallerContext {
  adminClient: any;
  user: any;
  profile: {
    id: string;
    role: string;
    is_super_admin?: boolean;
    company_id: string;
    is_approved: boolean;
  };
}

async function getAdminContext(authHeader: string): Promise<CallerContext | null> {
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return null;

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: { user }, error } = await adminClient.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await adminClient
    .from("user_profiles")
    .select("id, role, is_super_admin, company_id, is_approved")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile || !profile.is_approved) return null;
  if (profile.role !== "admin" && !profile.is_super_admin) return null;

  return { adminClient, user, profile };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const ctx = await getAdminContext(authHeader);

    if (!ctx) {
      return new Response(JSON.stringify({ error: "Forbidden: Yetkisiz erişim veya onaylanmamış hesap." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { adminClient, user, profile } = ctx;
    const url = new URL(req.url);

    // GET /admin-get-users — list profiles with strict tenant isolation
    if (req.method === "GET") {
      let query = adminClient
        .from("user_profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profile.is_super_admin) {
        // Super admin can filter by company_id query param or view all
        const filterCompanyId = url.searchParams.get("company_id");
        if (filterCompanyId) {
          query = query.eq("company_id", filterCompanyId);
        }
      } else {
        // Normal company admin is strictly confined to their own company
        if (!profile.company_id) {
          return new Response(JSON.stringify([]), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        query = query.eq("company_id", profile.company_id);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // PATCH /admin-get-users — update a profile safely (Mass Assignment & Privilege Escalation protected)
    if (req.method === "PATCH") {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        return new Response(JSON.stringify({ error: "Missing user id" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 1. Fetch the target user profile
      const { data: targetProfile, error: targetErr } = await adminClient
        .from("user_profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (targetErr || !targetProfile) {
        return new Response(JSON.stringify({ error: "Target user not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Permission checks if caller is not a super_admin
      if (!profile.is_super_admin) {
        // Must belong to the same company
        if (targetProfile.company_id !== profile.company_id) {
          return new Response(JSON.stringify({ error: "Cross-tenant access forbidden" }), {
            status: 403,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Company admin cannot modify their own role/approval via admin endpoint
        if (id === user.id) {
          return new Response(JSON.stringify({ error: "Cannot modify own admin role or approval" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Cannot assign super_admin or change company
        delete updates.is_super_admin;
        delete updates.company_id;
      }

      // 3. Whitelist allowed fields for update
      const allowedFields = ["role", "is_approved", "full_name", "phone", "is_active", "company_id", "is_super_admin"];
      const safeUpdates: Record<string, any> = {};

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          if (!profile.is_super_admin && (key === "is_super_admin" || key === "company_id")) {
            continue;
          }
          safeUpdates[key] = value;
        }
      }

      if (Object.keys(safeUpdates).length === 0) {
        return new Response(JSON.stringify({ error: "No valid fields to update" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error } = await adminClient
        .from("user_profiles")
        .update(safeUpdates)
        .eq("id", id);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
