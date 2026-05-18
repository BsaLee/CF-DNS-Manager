import { SignJWT } from 'jose';

const getRedirectUri = (request) => {
    const url = new URL(request.url);
    return `${url.origin}/yh.php?action=callback`;
};

const parseCookies = (cookieHeader) => Object.fromEntries(
    cookieHeader.split(';').map(c => {
        const trimmed = c.trim();
        const idx = trimmed.indexOf('=');
        return idx === -1 ? [trimmed, ''] : [trimmed.slice(0, idx), trimmed.slice(idx + 1)];
    })
);

const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
            return new Response(errorDescription || error, { status: 400 });
        }

        const cookies = parseCookies(request.headers.get('Cookie') || '');
        const storedState = cookies['yaohuo_oauth_state'];

        if (!code || !state || state !== storedState) {
            return new Response('Invalid state or missing code', { status: 400 });
        }

        const clientId = env.YAOHUO_CLIENT_ID;
        const clientSecret = env.YAOHUO_CLIENT_SECRET;
        const serverSecret = clientSecret || env.APP_PASSWORD;

        if (!clientId || !clientSecret || !serverSecret) {
            return new Response('Yaohuo OAuth or Server Secret not configured', { status: 500 });
        }

        const redirectUri = getRedirectUri(request);
        const tokenResponse = await fetch('https://yaohuo.me/OAuth/Token.aspx', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri
            })
        });

        const tokenData = await tokenResponse.json();
        if (tokenData.error) {
            return jsonResponse(tokenData, 400);
        }

        const profileResponse = await fetch('https://yaohuo.me/OAuth/Profile.aspx', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`,
                'Accept': 'application/json'
            }
        });

        const profile = await profileResponse.json();
        if (profile.error) {
            return jsonResponse(profile, 400);
        }

        const allowedUsers = Object.keys(env)
            .filter(k => k.startsWith('ALLOWED_YAOHUO_USER'))
            .map(k => String(env[k]).trim())
            .filter(Boolean);

        if (allowedUsers.length > 0 && !allowedUsers.includes(String(profile.userid))) {
            return new Response('Unauthorized user', { status: 403 });
        }

        const secret = new TextEncoder().encode(serverSecret);
        const jwt = await new SignJWT({
            admin: true,
            yaohuo_userid: profile.userid,
            yaohuo_nickname: profile.nickname,
            yaohuo_level: profile.level
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('24h')
            .sign(secret);

        return new Response(null, {
            status: 302,
            headers: {
                'Location': `/#auth_token=${jwt}&mode=server`,
                'Set-Cookie': 'yaohuo_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
            }
        });
    }

    const clientId = env.YAOHUO_CLIENT_ID;
    if (!clientId) {
        return jsonResponse({ error: 'Yaohuo OAuth is not configured.' }, 400);
    }

    const redirectUri = getRedirectUri(request);
    const state = crypto.randomUUID();
    const authorizeUrl = 'https://yaohuo.me/OAuth/Authorize.aspx?' + new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'profile',
        state
    }).toString();

    return new Response(null, {
        status: 302,
        headers: {
            'Location': authorizeUrl,
            'Set-Cookie': `yaohuo_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
        }
    });
}
