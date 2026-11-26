// Prueba mínima (smoke test) del scaffold de bibRL.
import { readFileSync } from 'node:fs'
import { resolveTheme } from 'rl-ui'

let passed = 0
let failed = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed++
    console.log(`ok ${passed + failed} - ${name}`)
  } else {
    failed++
    console.log(`FAIL ${passed + failed} - ${name} ${extra}`)
  }
}

const html = readFileSync('index.html', 'utf8')
const titleMatch = html.match(/<title>([^<]+)<\/title>/)
const title = titleMatch?.[1] ?? ''
const appName = (title.split('—')[0] ?? '').trim()

check('el título de la app es bibRL', appName === 'bibRL', `obtenido: "${appName}"`)
check('el título completo tiene 60 caracteres o menos (SEO)', title.length <= 60, `longitud: ${title.length}`)
check(
  'la meta descripción tiene entre 145 y 165 caracteres (SEO)',
  (() => {
    const m = html.match(/<meta\s+name="description"\s+content="([^"]*)"/)
    const desc = m?.[1] ?? ''
    return desc.length >= 145 && desc.length <= 165
  })(),
)
check(
  'la meta descripción incluye la frase objetivo',
  html.includes('Generador BibTeX online gratis'),
)
check(
  'index.html incluye el script de Umami',
  html.includes('https://analytics.reoxlab.com/script.js') &&
    html.includes('0bf0567e-1e8c-4977-a79e-0314f652956a'),
)
check('index.html carga config.js', html.includes('<script src="./config.js"></script>'))

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  name?: string
  license?: string
}
check('package.json tiene nombre bibrl', pkg.name === 'bibrl')
check('package.json declara GPL-3.0-or-later', pkg.license === 'GPL-3.0-or-later')

check('rl-ui resuelve tema system/dark correctamente', resolveTheme('system', true) === 'dark')
check('rl-ui resuelve tema system/light correctamente', resolveTheme('system', false) === 'light')

const entrypoint = readFileSync('entrypoint.sh', 'utf8')
check(
  'entrypoint escribe config.js con brandLink y chmod 644',
  entrypoint.includes('BIBRL_CONFIG') &&
    entrypoint.includes('brandLink') &&
    entrypoint.includes('chmod 644'),
)

const nginx = readFileSync('nginx.conf', 'utf8')
check('nginx.conf sirve /herramientas/bibrl/', nginx.includes('/herramientas/bibrl/'))
check(
  'nginx.conf incluye la location del proxy same-origin para arXiv',
  nginx.includes('location /herramientas/bibrl/api/arxiv/') &&
    nginx.includes('export.arxiv.org'),
)

if (failed > 0) process.exit(1)
console.log(`\nsmoke: ${passed} comprobaciones pasaron.`)
