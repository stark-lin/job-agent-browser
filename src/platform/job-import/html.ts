import { Parser } from 'htmlparser2'
import type { JobPageSnapshot } from '../../domain/job/job.extractor'
import { JobImportFailure } from './errors'

const blocks = new Set(['p', 'div', 'section', 'article', 'main', 'li', 'br', 'h1', 'h2', 'h3', 'tr', 'td'])
const ignored = new Set(['head', 'script', 'style', 'noscript', 'template', 'nav', 'footer', 'header', 'svg'])
function jobPostings(value: unknown, result: unknown[], depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 20 || result.length >= 20) return
  if (Array.isArray(value)) { for (const entry of value) jobPostings(entry, result, depth + 1); return }
  const object = value as Record<string, unknown>, type = object['@type']
  if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) result.push(object)
  else if (object['@graph']) jobPostings(object['@graph'], result, depth + 1)
}
/** Parse HTML without executing scripts, making subrequests or retaining browser state. */
export function snapshotFromHTML(html: string, requestedUrl: string, url: string): JobPageSnapshot {
  const stack: { tag: string; hidden: boolean; primary: boolean; json: boolean; title: boolean }[] = []
  const body: string[] = [], primary: string[] = [], json: string[] = [], jobPosting: unknown[] = []
  let title = '', jsonText = '', password = false
  const add = (text: string) => { body.push(text); if (stack.at(-1)?.primary) primary.push(text) }
  const parser = new Parser({
    onopentag(tag, attrs) {
      const parent = stack.at(-1)
      stack.push({ tag, hidden: Boolean(parent?.hidden || ignored.has(tag) || 'hidden' in attrs || attrs['aria-hidden'] === 'true'),
        primary: Boolean(parent?.primary || tag === 'main' || tag === 'article' || attrs.role === 'main'),
        json: tag === 'script' && attrs.type?.toLowerCase().split(';')[0].trim() === 'application/ld+json', title: tag === 'title' })
      if (tag === 'input' && attrs.type?.toLowerCase() === 'password') password = true
      if (!stack.at(-1)?.hidden && blocks.has(tag)) add('\n')
    },
    ontext(text) {
      const frame = stack.at(-1)
      if (frame?.title) title += text
      else if (frame?.json) jsonText += text
      else if (!frame?.hidden) add(text)
    },
    onclosetag(tag) {
      const frame = stack.at(-1)
      if (frame?.json) { json.push(jsonText); jsonText = '' }
      if (!frame?.hidden && blocks.has(tag)) add('\n')
      stack.pop()
    }
  }, { decodeEntities: true })
  parser.end(html)
  for (const text of json) { try { jobPostings(JSON.parse(text), jobPosting) } catch { /* Ignore unrelated malformed metadata. */ } }
  const clean = (text: string) => text.replace(/[\t \r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const main = clean(primary.join('')), cleanedContent = main.length >= 80 ? main : clean(body.join(''))
  const pageTitle = clean(title).slice(0, 1000)
  const restricted = /(?:^|[\s/:_-])(?:login|signin|sign-in|authwall|checkpoint|captcha)(?:[\s/?#:_-]|$)/i.test(new URL(url).pathname)
    || /^(just a moment|access denied|verify (?:you are|you're) human|security verification|sign in|log in|登录|访问受限)/i.test(pageTitle)
    || /(?:verify (?:you are|you're) human|complete the (?:captcha|security check)|enable javascript and cookies to continue|请完成验证|安全验证)/i.test(cleanedContent.slice(0, 2000))
  if (!jobPosting.length && (restricted || password)) throw new JobImportFailure('JOB_ACCESS_RESTRICTED')
  if (!jobPosting.length && cleanedContent.length < 80) throw new JobImportFailure('JOB_NO_CONTENT')
  if (cleanedContent.length > 60000 || JSON.stringify(jobPosting).length > 40000) throw new JobImportFailure('JOB_CONTENT_TOO_LARGE')
  return { requestedUrl, url, pageTitle, cleanedContent, jobPosting }
}
