import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveNavigationInput } from '../src/platform/browser/navigationManager'

const searches = [
  'jobs', '招聘', '2026', '0x1234', '1.2', 'software engineer Sydney', '  remote work  ',
  'person@example.com', 'what is example.com?', 'example.com/path with spaces',
  'bad_host.example', '999.999.999.999', 'https tutorials'
]
for (const input of searches) {
  test(`searches ${JSON.stringify(input)}`, () => {
    const url = new URL(resolveNavigationInput(input))
    assert.equal(url.origin, 'https://www.google.com')
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('q'), input.trim())
  })
}

const addresses = [
  ['example.com', 'https://example.com/'],
  ['  EXAMPLE.COM/jobs  ', 'https://example.com/jobs'],
  ['example.com?q=engineer#roles', 'https://example.com/?q=engineer#roles'],
  ['example.com:8443/jobs', 'https://example.com:8443/jobs'],
  ['https://example.com/jobs?q=senior engineer', 'https://example.com/jobs?q=senior%20engineer'],
  ['http://example.com', 'http://example.com/'],
  ['https://intranet/team', 'https://intranet/team'],
  ['localhost:3000/jobs', 'http://localhost:3000/jobs'],
  ['localhost?q=jobs', 'http://localhost/?q=jobs'],
  ['app.localhost:8080', 'http://app.localhost:8080/'],
  ['127.0.0.1:8080/path', 'http://127.0.0.1:8080/path'],
  ['192.168.1.1', 'https://192.168.1.1/'],
  ['[::1]:8080', 'http://[::1]:8080/'],
  ['[2001:db8::1]/jobs', 'https://[2001:db8::1]/jobs'],
  ['例子.中国', 'https://xn--fsqu00a.xn--fiqs8s/']
]
for (const [input, expected] of addresses) {
  test(`opens ${JSON.stringify(input)} as a URL`, () => {
    assert.equal(resolveNavigationInput(input), expected)
  })
}

for (const input of ['', '  ', 'https://', 'http://bad host/jobs', 'file:///tmp/test', 'javascript:alert(1)', 'javascript:alert("hello world")', 'data:text/html,hello', 'ftp://example.com', 'mailto:person@example.com', 'app://home']) {
  test(`rejects ${JSON.stringify(input)}`, () => {
    assert.throws(() => resolveNavigationInput(input))
  })
}
