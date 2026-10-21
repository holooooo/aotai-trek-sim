"""Local Pages + D1 integration only; never submit acceptance markers to production."""
import json
import os
import uuid
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

BASE = os.environ.get('AOTAI_TEST_URL', 'http://127.0.0.1:53753').rstrip('/')
assert urlparse(BASE).hostname in ('127.0.0.1', 'localhost', '::1'), 'This test only writes to loopback hosts.'

def request(path, body=None):
    headers = {'Origin': BASE}
    payload = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        payload = json.dumps(body).encode()
    try:
        with urlopen(Request(BASE + path, data=payload, headers=headers), timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)

prefix = 'accept_' + uuid.uuid4().hex
record = dict(id=prefix, world='aotai-winter-v1', path='main', x=-1.25, z=15.5,
              role='student', difficulty='normal', cause='fall', gameMinute=750,
              core=36.2, health=0, food=35, water=24, stress=98, altitude=3100)
assert request('/api/remains', record) == (200, {'recorded': True})
assert request('/api/remains', dict(record, cause='injury')) == (200, {'recorded': False})
assert request('/api/remains', dict(record, id=prefix + '_far', x=6400))[0] == 200
assert request('/api/remains', dict(record, id=prefix + '_branch', path='dudumen'))[0] == 200
status, result = request('/api/remains?' + urlencode(dict(world=record['world'], path='main', cx=-1, cz=0)))
assert status == 200, (status, result)
assert len(result['remains']) <= 24
rows = [r for r in result['remains'] if r['id'].startswith(prefix)]
assert len(rows) == 1 and rows[0]['cause'] == 'fall', rows
assert rows[0]['x'] == -1.25 and rows[0]['createdAt'] > 0
assert request('/api/remains')[0] == 400
assert request('/api/remains', dict(record, id=prefix + '_bad', visitorId='not_allowed'))[0] == 400
print('PASS: local D1 migration, bloodstain POST/idempotency, nearby indexed GET, branch/far filtering, strict schema')
