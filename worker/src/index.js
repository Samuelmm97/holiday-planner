// holiday-planner-api — tiny shared store for the holiday availability planner.
// Storage: one KV key per person, so concurrent submissions never clobber each other.
//   event:<eventId>:p:<normalized-name> -> { id, name, attending, slots:[], updatedAt }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

function nameKey(n) {
  return String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const EVENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (parts[0] === '' || parts[0] === undefined) {
      return json({ ok: true, service: 'holiday-planner-api', hint: 'GET /api/events/<eventId>' });
    }
    if (parts[0] !== 'api' || parts[1] !== 'events' || !parts[2]) return json({ error: 'not found' }, 404);

    const eventId = parts[2].toLowerCase();
    if (!EVENT_RE.test(eventId)) return json({ error: 'bad event id' }, 400);
    const prefix = `event:${eventId}:p:`;
    const store = env.HOLIDAY_KV;
    if (!store) return json({ error: 'kv binding missing' }, 500);

    // GET /api/events/<eventId>  -> everyone's responses
    if (req.method === 'GET' && parts.length === 3) {
      const people = [];
      let cursor;
      do {
        const page = await store.list({ prefix, cursor, limit: 200 });
        const recs = await Promise.all(page.keys.map((k) => store.get(k.name, 'json')));
        for (const r of recs) if (r && r.id) people.push(r);
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      people.sort((a, b) => a.name.localeCompare(b.name));
      return json({ ok: true, eventId, people, serverTime: new Date().toISOString() });
    }

    // POST /api/events/<eventId>/responses  {name, slots:[], attending}  (upsert by name)
    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'responses') {
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 48);
      if (!name) return json({ error: 'name required' }, 400);
      const attending = body.attending !== false;
      const raw = Array.isArray(body.slots) ? body.slots : [];
      const slots = attending
        ? [...new Set(raw.filter((s) => typeof s === 'string').map((s) => s.slice(0, 20)))].sort()
        : [];
      if (attending && slots.length === 0) return json({ error: 'pick at least one time, or mark that you cannot make it' }, 400);

      // Optional structured blocks ({day, slot, start, end}) so phones restore the exact bars.
      const blocks = attending && Array.isArray(body.blocks)
        ? body.blocks
            .filter((b) => b && typeof b.day === 'string' && typeof b.slot === 'string' &&
              isFinite(+b.start) && isFinite(+b.end))
            .slice(0, 40)
            .map((b) => ({
              day: b.day.slice(0, 10),
              slot: String(b.slot).slice(0, 12),
              start: Math.round(+b.start),
              end: Math.round(+b.end),
            }))
        : [];

      const record = {
        id: nameKey(name),
        name,
        attending,
        slots,
        blocks,
        updatedAt: new Date().toISOString(),
      };
      await store.put(prefix + record.id, JSON.stringify(record));
      return json({ ok: true, person: record });
    }

    // DELETE /api/events/<eventId>/responses/<id>
    if (req.method === 'DELETE' && parts.length === 5 && parts[3] === 'responses') {
      const id = decodeURIComponent(parts[4]).toLowerCase();
      if (!id) return json({ error: 'id required' }, 400);
      await store.delete(prefix + id);
      return json({ ok: true, deleted: id });
    }

    return json({ error: 'not found' }, 404);
  },
};
