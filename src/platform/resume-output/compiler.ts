import type { ResumeDocument, ResumeEntry } from '../../domain/resume/resume.types'

export interface ResumeTemplate { id: 'default-v1'; fontVersion: 'noto-sc-v1'; fontBase64: string }
export const escapeHTML = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
export function safeLink(value: string): string | null {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null }
}
const css = `@font-face{font-family:Resume;src:url(data:font/ttf;base64,FONT) format('truetype');font-weight:100 900;font-display:block}
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#eee;color:#171717;font-family:Resume,sans-serif;font-size:10pt;line-height:1.55}
@page{size:A4;margin:0}.page{width:210mm;height:297mm;padding:18mm;background:white;margin:0 auto 8mm;break-after:page}.page:last-child{break-after:auto}
.page-body{width:174mm;height:261mm;display:flow-root}.block{margin:0;padding:0 0 2mm;overflow-wrap:anywhere;white-space:pre-wrap}
h1.block{font-size:22pt;font-weight:700;line-height:1.3;padding-bottom:3mm}h2.block{font-size:12pt;font-weight:700;border-bottom:0.25mm solid #bbb;padding:3mm 0 1.5mm;margin-bottom:2mm}h3.block{font-size:10.5pt;font-weight:700;padding-top:2mm}
.bullet{padding-left:4mm;position:relative}.bullet:before{content:'•';position:absolute;left:0}.continuation:before{content:''}a{color:inherit;text-decoration:none}
#source{width:174mm;margin:0 auto}@media print{html,body{background:white}.page{margin:0;box-shadow:none}}`
const labels = { en: { summary: 'Summary', experience: 'Experience', projects: 'Projects', education: 'Education', skills: 'Skills', current: 'Present' },
  'zh-CN': { summary: '个人简介', experience: '工作经历', projects: '项目经历', education: '教育经历', skills: '技能', current: '至今' } }
/** Pure deterministic compiler: only local font data and escaped document strings enter HTML. */
export function compileHTML(document: ResumeDocument, template: ResumeTemplate): string {
  if (template.id !== 'default-v1' || template.fontVersion !== 'noto-sc-v1' || !/^[A-Za-z0-9+/=]+$/.test(template.fontBase64)) throw new Error('INVALID_TEMPLATE')
  const text = escapeHTML, label = labels[document.language]
  const block = (tag: string, value: string, keep = false, extra = '') => `<${tag} class="block${extra}"${keep ? ' data-keep="true"' : ''}>${text(value)}</${tag}>`
  const link = (name: string, url: string) => { const safe = safeLink(url); return safe ? `<a href="${text(safe)}" rel="noreferrer">${text(name)}: ${text(url)}</a>` : text(name) }
  const entries = (name: string, items: ResumeEntry[]) => !items.length ? '' : block('h2', name, true) + items.map(item =>
    block('h3', [item.title, item.organization, item.role].filter(Boolean).join(' · '), true)
    + block('p', [item.location, [item.startDate, item.isCurrent ? label.current : item.endDate].filter(Boolean).join(' – '), item.degree, item.major, item.gpa].filter(Boolean).join(' · '), Boolean(item.bullets.length))
    + (item.url ? `<p class="block" data-keep="true">${link('', item.url)}</p>` : '')
    + item.bullets.map(bullet => block('p', bullet.text, false, ' bullet')).join('')).join('')
  const basics = document.basics
  const body = block('h1', basics.name, true) + block('p', [basics.email, basics.phone, basics.location].filter(Boolean).join(' · '), Boolean(basics.links.length))
    + basics.links.map(entry => `<p class="block">${link(entry.label, entry.url)}</p>`).join('')
    + (document.summary ? block('h2', label.summary, true) + block('p', document.summary.text) : '')
    + entries(label.experience, document.experience) + entries(label.projects, document.projects) + entries(label.education, document.education)
    + (document.skills.length ? block('h2', label.skills, true) + document.skills.map(skill => block('p', skill.text, false, ' bullet')).join('') : '')
  return `<!doctype html><html lang="${document.language}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src 'none'"><meta name="template" content="default-v1/noto-sc-v1"><title>${text(basics.name)}</title><style>${css.replace('FONT', template.fontBase64)}</style></head><body><main id="source">${body}</main></body></html>`
}
