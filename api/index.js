export const config = {
  runtime: 'edge', // Uses Edge Runtime for fast, limitless video streaming
};

export default async function handler(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  // 1. CORS Headers to allow playback on your website
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle Preflight OPTIONS request
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate URL
  if (!targetUrl) {
    return new Response("Error: Provide a valid URL via ?url=", { status: 400, headers: corsHeaders });
  }

  try {
    // Fetch the target stream (HTTP or HTTPS)
    const targetResponse = await fetch(targetUrl, {
      headers: {
        "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });

    const contentType = targetResponse.headers.get("content-type") || "";
    const isM3U8 = targetUrl.includes(".m3u8") || contentType.includes("mpegurl");

    if (isM3U8) {
      // --------------------------------------------------------
      // HANDLING .M3U8 PLAYLISTS
      // --------------------------------------------------------
      const text = await targetResponse.text();
      let newM3u8 = "";
      const lines = text.split('\n');
      
      // Build the base proxy URL to use your custom domain correctly
      const proxyBase = `${url.origin}/?url=`;

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.startsWith('#')) {
          // Rewrite Encryption Keys
          if (line.includes('URI=')) {
            line = line.replace(/URI="([^"]+)"/, (match, uri) => {
              const absoluteUri = new URL(uri, targetResponse.url).href;
              return `URI="${proxyBase}${encodeURIComponent(absoluteUri)}"`;
            });
          }
          newM3u8 += line + '\n';
        } else {
          // Rewrite standard .ts segments
          const absoluteUri = new URL(line, targetResponse.url).href;
          newM3u8 += proxyBase + encodeURIComponent(absoluteUri) + '\n';
        }
      }

      return new Response(newM3u8, {
        status: targetResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/vnd.apple.mpegurl"
        }
      });

    } else {
      // --------------------------------------------------------
      // HANDLING .TS VIDEO SEGMENTS
      // --------------------------------------------------------
      // Streams the chunks directly to the user (saves RAM)
      return new Response(targetResponse.body, {
        status: targetResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": contentType || "video/mp2t"
        }
      });
    }
  } catch (e) {
    return new Response(`Proxy Error: ${e.message}`, { status: 500, headers: corsHeaders });
  }
}
