export async function onRequestGet(context) {
    const { env } = context;

    const hasPassword = !!env.APP_PASSWORD && env.APP_PASSWORD.length > 0;
    const hasYaohuoID = !!env.YAOHUO_CLIENT_ID && env.YAOHUO_CLIENT_ID.length > 0;
    const hasYaohuoSecret = !!env.YAOHUO_CLIENT_SECRET && env.YAOHUO_CLIENT_SECRET.length > 0;
    const yaohuoMode = hasYaohuoID && hasYaohuoSecret;

    const hasUserToken = Object.keys(env).some(key => /^USER_TOKEN_\d+$/.test(key) && env[key]);

    return new Response(JSON.stringify({
        passwordMode: hasPassword,
        userTokenMode: hasUserToken,
        githubMode: yaohuoMode,
        yaohuoMode
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}
