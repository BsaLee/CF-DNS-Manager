const getAccounts = (env) => {
    const accounts = [];
    if (env.CF_API_TOKEN) accounts.push({ id: 0, token: env.CF_API_TOKEN });

    Object.keys(env).forEach(key => {
        const match = key.match(/^CF_API_TOKEN(\d+)$/);
        if (match && env[key]) {
            accounts.push({ id: parseInt(match[1], 10), token: env[key] });
        }
    });

    return accounts.sort((a, b) => a.id - b.id);
};

const fetchAccountZones = async (account) => {
    let allZones = [];
    let page = 1;
    let totalPages = 1;

    do {
        const response = await fetch(`https://api.cloudflare.com/client/v4/zones?per_page=50&page=${page}`, {
            headers: {
                'Authorization': `Bearer ${account.token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        if (!data.success) {
            return { success: false, status: response.status, data };
        }

        allZones = allZones.concat((data.result || []).map(zone => ({
            ...zone,
            accountIndex: account.id
        })));
        totalPages = data.result_info?.total_pages || 1;
        page++;
    } while (page <= totalPages);

    return { success: true, zones: allZones };
};

export async function onRequestGet(context) {
    const { env } = context;
    const accounts = getAccounts(env);

    if (accounts.length === 0) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: 'No Cloudflare API Token configured.' }] }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const results = await Promise.all(accounts.map(fetchAccountZones));
        const failed = results.find(result => !result.success);

        if (failed) {
            return new Response(JSON.stringify(failed.data), {
                status: failed.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const zoneMap = new Map();
        results.flatMap(result => result.zones).forEach(zone => {
            const key = `${zone.accountIndex}:${zone.id}`;
            zoneMap.set(key, zone);
        });

        const allZones = Array.from(zoneMap.values());

        return new Response(JSON.stringify({
            success: true,
            result: allZones,
            result_info: { count: allZones.length, total_count: allZones.length }
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, errors: [{ message: e.message }] }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
