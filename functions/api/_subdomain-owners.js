const getStore = (env) => env.SUBDOMAIN_OWNERS || env.CF_DNS_SUBDOMAIN_OWNERS;

const normalizeName = (name) => String(name || '').trim().toLowerCase().replace(/\.$/, '');

export const getUserId = (context) => {
    const payload = context.data?.authPayload;
    return payload?.yaohuo_userid ? String(payload.yaohuo_userid) : null;
};

export const getOwnerKey = (zoneId, name) => `zone:${zoneId}:name:${normalizeName(name)}`;

export const getOwner = async (env, zoneId, name) => {
    const store = getStore(env);
    if (!store) return null;

    const saved = await store.get(getOwnerKey(zoneId, name), 'json');
    return saved || null;
};

export const setOwner = async (env, zoneId, name, userId, recordId) => {
    const store = getStore(env);
    if (!store || !userId) return;

    await store.put(getOwnerKey(zoneId, name), JSON.stringify({
        userId: String(userId),
        recordId: recordId || null,
        name: normalizeName(name),
        updatedAt: new Date().toISOString()
    }));
};

export const deleteOwner = async (env, zoneId, name) => {
    const store = getStore(env);
    if (!store) return;
    await store.delete(getOwnerKey(zoneId, name));
};

export const assertCanUseName = async (env, zoneId, name, userId) => {
    if (!userId) return { allowed: true };

    const owner = await getOwner(env, zoneId, name);
    if (!owner || String(owner.userId) === String(userId)) return { allowed: true, owner };

    return {
        allowed: false,
        status: 403,
        body: {
            success: false,
            errors: [{ message: 'This subdomain is already owned by another user.' }],
            code: 'SUBDOMAIN_OWNED_BY_OTHER_USER'
        }
    };
};

export const assertCanEditRecord = async (env, zoneId, record, userId) => {
    if (!userId || !record?.name) return { allowed: true };

    const owner = await getOwner(env, zoneId, record.name);
    if (owner && String(owner.userId) === String(userId)) return { allowed: true, owner };

    return {
        allowed: false,
        status: 403,
        body: {
            success: false,
            errors: [{ message: 'You can only edit DNS records created or claimed by your account.' }],
            code: 'DNS_RECORD_NOT_OWNED'
        }
    };
};

export const filterRecordsByOwner = async (env, zoneId, records, userId) => {
    if (!userId) return records;

    const pairs = await Promise.all((records || []).map(async record => ({
        record,
        owner: await getOwner(env, zoneId, record.name)
    })));

    return pairs
        .filter(({ owner }) => owner && String(owner.userId) === String(userId))
        .map(({ record }) => record);
};

export const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
});

export const fetchRecord = async (cfToken, zoneId, recordId) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
        headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    if (!data.success) return { response, data, record: null };
    return { response, data, record: data.result };
};
