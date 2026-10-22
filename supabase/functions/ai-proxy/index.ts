import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Gemini-Key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Oturum açılması zorunludur." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    // Verify user authentication
    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser(token);
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Geçersiz veya süresi dolmuş oturum." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    // 1. GEMINI PROXY ACTION
    if (action === "gemini_generate") {
      const serverGeminiKey = Deno.env.get("GEMINI_API_KEY") || "";
      const clientGeminiKey = req.headers.get("X-Gemini-Key") || body.apiKey || "";
      const activeKey = (serverGeminiKey || clientGeminiKey).trim();

      if (!activeKey) {
        return new Response(
          JSON.stringify({ error: "Gemini API anahtarı yapılandırılmamış." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const model = body.model || "gemini-2.0-flash";
      const apiVersion = body.apiVersion || "v1beta";
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${activeKey}`;

      const geminiRes = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: body.contents,
          systemInstruction: body.systemInstruction,
          generationConfig: body.generationConfig,
        }),
      });

      const geminiData = await geminiRes.json();
      return new Response(JSON.stringify(geminiData), {
        status: geminiRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. TELEGRAM PROXY ACTION
    if (action === "telegram_send") {
      const serverBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
      const botToken = (serverBotToken || body.botToken || "").trim();
      const chatId = (body.chatId || "").trim();
      const text = body.text || "";

      if (!botToken || !chatId) {
        return new Response(
          JSON.stringify({ error: "Telegram bot token veya chat ID eksik." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: body.parseMode || "Markdown",
        }),
      });

      const tgData = await tgRes.json();
      return new Response(JSON.stringify(tgData), {
        status: tgRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Bilinmeyen istek türü (action)." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Sunucu içi hata." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
