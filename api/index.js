const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Enable CORS so video players don't block the stream
app.use(cors());

// ---------------------------------------------------------
// 1. HOME PAGE ROUTE (https://proxy.kurdsport.online/)
// ---------------------------------------------------------
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
            <h1 style="color: #0070f3;">✅ Proxy is Live!</h1>
            <p>Your subdomain <b>proxy.kurdsport.online</b> is working correctly.</p>
            <p>To use the proxy, format your URLs like this:</p>
            <code style="background: #eee; padding: 10px; border-radius: 5px;">
                https://proxy.kurdsport.online/proxy?url=YOUR_M3U8_LINK_HERE
            </code>
        </div>
    `);
});

// ---------------------------------------------------------
// 2. PROXY ROUTE (https://proxy.kurdsport.online/proxy)
// ---------------------------------------------------------
app.get('/proxy', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Error: Missing "url" query parameter.');
    }

    try {
        const isM3u8 = targetUrl.includes('.m3u8');

        // Fetch the target URL (supports both HTTP and HTTPS)
        const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: isM3u8 ? 'text' : 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Accept': '*/*'
            }
        });

        // Forward the exact Content-Type to the video player
        const contentType = response.headers['content-type'];
        if (contentType) res.setHeader('Content-Type', contentType);

        if (isM3u8) {
            let m3u8Content = response.data;
            
            // Get your domain dynamically (proxy.kurdsport.online)
            const host = req.headers['x-forwarded-host'] || req.get('host');
            const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
            const proxyHost = `${protocol}://${host}/proxy?url=`;

            // Function to rewrite URLs to point to your proxy
            const rewriteUrl = (originalUrl) => {
                try {
                    const absoluteUrl = new URL(originalUrl, targetUrl).href;
                    return proxyHost + encodeURIComponent(absoluteUrl);
                } catch (e) {
                    return originalUrl;
                }
            };

            // Parse and rewrite standard lines (.ts chunks and .m3u8 qualities)
            m3u8Content = m3u8Content.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    return rewriteUrl(trimmed);
                }
                return line;
            }).join('\n');

            // Parse and rewrite Encryption Keys (if the stream is AES encrypted)
            m3u8Content = m3u8Content.replace(/URI="([^"]+)"/g, (match, p1) => {
                return `URI="${rewriteUrl(p1)}"`;
            });

            res.status(200).send(m3u8Content);
        } else {
            // For .ts video segments, stream the binary data directly for maximum speed
            response.data.pipe(res);
        }
    } catch (error) {
        console.error(`Error fetching: ${targetUrl}`, error.message);
        res.status(500).send('Error loading the stream. The source might be down or blocking requests.');
    }
});

// ---------------------------------------------------------
// 3. EXPORT OR START SERVER
// ---------------------------------------------------------
// If we are running this locally, start the Express server
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`💻 Local server running on http://localhost:${PORT}`);
    });
}

// Export the app so Vercel can run it serverlessly
module.exports = app;
