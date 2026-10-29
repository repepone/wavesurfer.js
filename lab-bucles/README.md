# lab-bucles

Laboratorio de bucles A-B sobre wavesurfer.js (rama `lab-bucles`, solo para estudio).
El informe está en [`../INFORME-LAB-BUCLES.md`](../INFORME-LAB-BUCLES.md).

Todo el audio de las pruebas es sintético (lo genera `gen-audio.mjs`); no se usa ni se sube ninguna grabación.

## Ficheros

| Fichero                       | Qué es                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `gen-audio.mjs`               | Genera `audio/rampa.wav` (cada muestra dice su posición en el fichero) y `audio/seno.wav` (440 Hz, para ver el clic). |
| `recorder-worklet.js`         | AudioWorklet que graba la salida real de audio, muestra a muestra.                                                    |
| `analysis.js`                 | Analiza la grabación: dónde se cortó, dónde se retomó, cuánto hueco hubo, tamaño del salto (clic).                    |
| `harness.html` / `harness.js` | Banco de medida en el navegador (bucle, cadena, varias pistas, edición en bloque).                                    |
| `medir.mjs`                   | Lanza todo en Chromium headless con Playwright y guarda `resultados/medidas.json`.                                    |
| `loop-tools.js`               | Lo que el plugin no trae: edición en bloque, cadenas A→B→C, JSON, compases ↔ segundos.                                |
| `gapless-loop.js`             | Bucle sin hueco con `AudioBufferSourceNode.loop` (escrito aparte, fuera de wavesurfer).                               |
| `demo.html` / `demo.js`       | Demo interactiva para probar a mano.                                                                                  |
| `lab.test.mjs`                | Tests de `analysis.js` y `loop-tools.js` sin navegador.                                                               |
| `server.mjs`                  | Servidor estático mínimo.                                                                                             |
| `resumen.mjs`                 | Convierte `resultados/medidas.json` en las tablas de `resultados/tablas.md`.                                          |
| `probar-demo.mjs`             | Prueba de humo de la demo con Playwright.                                                                             |

## Cómo repetirlo

```bash
yarn install
```

```bash
yarn build
```

```bash
node lab-bucles/gen-audio.mjs
```

```bash
node --test lab-bucles/lab.test.mjs
```

```bash
node lab-bucles/medir.mjs
```

Variables opcionales de `medir.mjs`: `N` (vueltas por prueba, 35), `NC` (pasos de cadena, 36), `R` (repeticiones multipista, 5), `S` (segundos por prueba multipista, 18; `rampa.wav` dura 20 s). Un argumento filtra por nombre de prueba (`node lab-bucles/medir.mjs clic`) y sustituye solo esas pruebas dentro de `resultados/medidas.json`.

Las tablas del informe salen de `node lab-bucles/resumen.mjs > lab-bucles/resultados/tablas.md`.

Para la demo:

```bash
node lab-bucles/server.mjs
```

y abrir `http://localhost:8080/lab-bucles/demo.html`.
