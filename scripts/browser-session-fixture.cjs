// Shared local website for same-session and fresh-process persistence assertions.
module.exports = function sessionFixture(request, response) {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path === '/session/login') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'jab_login=valid; Max-Age=86400; HttpOnly; Path=/; SameSite=Lax' })
    response.end('<title>Logged in</title><script>localStorage.setItem("jab-session-test", "retained")</script>Logged in')
  } else if (path === '/session/logout' || path === '/session/expire') {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'jab_login=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax' })
    response.end('<title>Logged out</title>Logged out')
  } else if (path === '/session/protected') {
    const allowed = /(?:^|;\s*)jab_login=valid(?:;|$)/.test(request.headers.cookie || '')
    response.writeHead(allowed ? 200 : 401, { 'Content-Type': 'text/html' })
    response.end(`<title>${allowed ? 'Authenticated' : 'Unauthorized'}</title><h1>${allowed ? 'Authenticated' : 'Unauthorized'}</h1>`)
  } else return false
  return true
}
