import { SignJWT } from 'jose';

const hashValue = async (value) => {
    const msgUint8 = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

const getAccounts = (env) => {
    const accounts = [];
    if (env.CF_API_TOKEN) accounts.push({ id: 0, name: 'Default Account' });

    Object.keys(env).forEach(key => {
        const match = key.match(/^CF_API_TOKEN(\d+)$/);
        if (match) {
            accounts.push({ id: parseInt(match[1], 10), name: `Account ${match[1]}` });
        }
    });

    return accounts.sort((a, b) => a.id - b.id);
};

const findUserTokenMatch = async (env, tokenHash) => {
    const entries = Object.keys(env)
        .map(key => {
            const match = key.match(/^USER_TOKEN_(\d+)$/);
            return match ? { key, userId: match[1], token: env[key] } : null;
        })
        .filter(Boolean);

    for (const entry of entries) {
        if (!entry.token) continue;
        const hash = await hashValue(entry.token);
        if (hash === tokenHash) return entry;
    }

    return null;
};

const createSessionToken = async (env, serverPassword, payload) => {
    const jwtSecret = env.YAOHUO_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || serverPassword || env.USER_TOKEN_SECRET;
    if (!jwtSecret) throw new Error('JWT secret is not configured.');

    const secret = new TextEncoder().encode(jwtSecret);
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secret);
};

export async function onRequestPost(context) {
    const { request, env } = context;
    const { password, loginType = 'admin' } = await request.json();
    const serverPassword = env.APP_PASSWORD;

    if (loginType === 'userToken') {
        const matchedUser = await findUserTokenMatch(env, password);

        if (!matchedUser) {
            return new Response(JSON.stringify({ error: 'Invalid user token' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        try {
            const jwt = await createSessionToken(env, serverPassword, {
                admin: false,
                yaohuo_userid: matchedUser.userId,
                yaohuo_nickname: `Token User ${matchedUser.userId}`,
                login_type: 'user_token'
            });

            return new Response(JSON.stringify({ token: jwt, accounts: getAccounts(env) }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    if (!serverPassword) {
        return new Response(JSON.stringify({ error: 'Server is not configured for password login.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const serverPasswordHash = await hashValue(serverPassword);

    if (password === serverPasswordHash) {
        try {
            const jwt = await createSessionToken(env, serverPassword, { admin: true });

            return new Response(JSON.stringify({ token: jwt, accounts: getAccounts(env) }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
    });
}
