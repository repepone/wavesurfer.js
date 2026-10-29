// Prueba de humo de la demo: crea bucles, edita en bloque, toca una cadena, exporta/importa JSON y prueba el motor sin hueco.
//   node lab-bucles/probar-demo.mjs
import { createRequire } from 'node:module'
import { startServer } from './server.mjs'
const { chromium } = createRequire(import.meta.url)('playwright')
const server = await startServer(0)
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const p = await b.newPage()
const errs = []
p.on('pageerror', (e) => errs.push(e.message))
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
await p.goto(`http://localhost:${server.address().port}/lab-bucles/demo.html`)
await p.waitForTimeout(1500)
// crear 3 bucles arrastrando sobre la onda
const box = await p.locator('#onda').boundingBox()
for (const [a, c] of [
  [0.1, 0.2],
  [0.4, 0.5],
  [0.7, 0.8],
]) {
  await p.mouse.move(box.x + box.width * a, box.y + box.height / 2)
  await p.mouse.down()
  await p.mouse.move(box.x + box.width * ((a + c) / 2), box.y + box.height / 2, { steps: 5 })
  await p.mouse.move(box.x + box.width * c, box.y + box.height / 2, { steps: 5 })
  await p.mouse.up()
  await p.waitForTimeout(100)
}
console.log('lista:', await p.locator('#lista').innerText())
await p.locator('#lista input').nth(0).check()
await p.locator('#lista input').nth(1).check()
await p.click('[data-op=der]')
console.log('tras mover A y B:', await p.locator('#lista').innerText())
await p.fill('#cadena', 'A×2, B, C')
await p.click('#tocarCadena')
await p.waitForTimeout(2500)
console.log('paso:', await p.locator('#paso').innerText(), 'compás:', await p.locator('#compas').innerText())
await p.click('#pararCadena')
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exportar')])
const json = await (await dl.createReadStream()).toArray()
const text = Buffer.concat(json).toString()
console.log('json:', text.slice(0, 200).replace(/\s+/g, ' '))
await p.setInputFiles('#importar', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) })
await p.waitForTimeout(300)
console.log('tras importar:', await p.locator('#lista').innerText(), '| cadena:', await p.inputValue('#cadena'))
await p.selectOption('#motor', 'sinhueco')
await p.locator('#lista button').nth(2).click()
await p.waitForTimeout(1500)
console.log('sin hueco, compás:', await p.locator('#compas').innerText())
console.log('errores:', errs)
await b.close()
server.close()
