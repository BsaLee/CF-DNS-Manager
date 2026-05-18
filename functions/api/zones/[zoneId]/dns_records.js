import { assertCanEditRecord, assertCanUseName, deleteOwner, fetchRecord, getUserId, jsonResponse, setOwner } from '../../_subdomain-owners.js';

export async function onRequestGet(context) {
    const { cfToken } = context.data;
    const { zoneId } = context.params;

    let allRecords = [];
    let page = 1;
    let totalPages = 1;

    try {
        do {
            const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?per_page=100&page=${page}`, {
                headers: {
                    'Authorization': `Bearer ${cfToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            if (!data.success) {
                return new Response(JSON.stringify(data), {
                    status: response.status,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            allRecords = allRecords.concat(data.result || []);
            totalPages = data.result_info?.total_pages || 1;
            page++;
        } while (page <= totalPages);

        return new Response(JSON.stringify({
            success: true,
            result: allRecords,
            result_info: { count: allRecords.length, total_count: allRecords.length }
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

export async function onRequestPost(context) {
    const { cfToken } = context.data;
    const { zoneId } = context.params;
    const body = await context.request.json();
    const userId = getUserId(context);

    const permission = await assertCanUseName(context.env, zoneId, body.name, userId);
    if (!permission.allowed) return jsonResponse(permission.body, permission.status);

    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.success && data.result?.name && userId) {
        await setOwner(context.env, zoneId, data.result.name, userId, data.result.id);
    }

    return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export async function onRequestPatch(context) {
    const { cfToken } = context.data;
    const { zoneId } = context.params;
    const url = new URL(context.request.url);
    const recordId = url.searchParams.get('id');
    const body = await context.request.json();
    const userId = getUserId(context);

    if (!recordId) return new Response('Missing ID', { status: 400 });

    const current = await fetchRecord(cfToken, zoneId, recordId);
    if (!current.record) {
        return jsonResponse(current.data, current.response.status);
    }

    const editPermission = await assertCanEditRecord(context.env, zoneId, current.record, userId);
    if (!editPermission.allowed) return jsonResponse(editPermission.body, editPermission.status);

    if (body.name && body.name !== current.record.name) {
        const namePermission = await assertCanUseName(context.env, zoneId, body.name, userId);
        if (!namePermission.allowed) return jsonResponse(namePermission.body, namePermission.status);
    }

    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.success && userId) {
        if (data.result?.name && data.result.name !== current.record.name) {
            await deleteOwner(context.env, zoneId, current.record.name);
        }
        await setOwner(context.env, zoneId, data.result?.name || current.record.name, userId, recordId);
    }

    return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
    });
}

export async function onRequestDelete(context) {
    const { cfToken } = context.data;
    const { zoneId } = context.params;
    const url = new URL(context.request.url);
    const recordId = url.searchParams.get('id');
    const userId = getUserId(context);

    if (!recordId) return new Response('Missing ID', { status: 400 });

    const current = await fetchRecord(cfToken, zoneId, recordId);
    if (!current.record) {
        return jsonResponse(current.data, current.response.status);
    }

    const editPermission = await assertCanEditRecord(context.env, zoneId, current.record, userId);
    if (!editPermission.allowed) return jsonResponse(editPermission.body, editPermission.status);

    const response = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${cfToken}`,
            'Content-Type': 'application/json'
        }
    });

    const data = await response.json();
    if (data.success && userId) {
        await deleteOwner(context.env, zoneId, current.record.name);
    }

    return new Response(JSON.stringify(data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
    });
}
