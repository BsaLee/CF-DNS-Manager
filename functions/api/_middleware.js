export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // Skip auth for login, oauth and config API
    if (url.pathname === '/api/login' || url.pathname === '/yh.php' || url.pathname.startsWith('/api/auth/github') || url.pathname === '/api/auth/config') {
        return next();
    }

    // Get tokens from headers
    const clientToken = request.headers.get('X-Cloudflare-Token');
    const authHeader = request.headers.get('Authorization');

    // Priority 1: Client Mode (Token provided directly by user)
    if (clientToken) {
        context.data.cfToken = clientToken;
        return next();
    }

    // Priority 2: Server Mode (JWT provided, using server's CF_API_TOKEN)
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7);
        // JWT secret: prefer GITHUB_CLIENT_SECRET, fallback to APP_PASSWORD when GitHub OAuth is not configured
        const serverSecret = env.YAOHUO_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || env.APP_PASSWORD;

        if (!serverSecret) {
            return new Response(JSON.stringify({ error: 'Server is not configured. Set APP_PASSWORD or GITHUB_CLIENT_SECRET.' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const { jwtVerify } = await import('jose');
            const secret = new TextEncoder().encode(serverSecret);
            await jwtVerify(token, secret);

            // JWT is valid
            const accountIndex = parseInt(request.headers.get('X-Managed-Account-Index') || '0');
            let serverToken = env.CF_API_TOKEN;
            if (accountIndex > 0) {
                serverToken = env[`CF_API_TOKEN${accountIndex}`];
            }

            if (!serverToken) {
                return new Response(JSON.stringify({ error: 'Selected managed account is not configured.' }), {
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            context.data.cfToken = serverToken.trim().replace(/^["']|["']$/g, '');
            return next();
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid or expired session.', message: e.message }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // No valid auth method found
    return new Response(JSON.stringify({
        error: 'Authentication Required',
        message: 'Please provide either X-Cloudflare-Token or a valid Authorization header.'
    }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
    });
}
