# Informe: bucles A-B con wavesurfer.js

Rama `lab-bucles` del fork `repepone/wavesurfer.js` (wavesurfer.js 8.0.3), solo para estudio. Sin PR al original.
Scripts, demo y datos brutos en [`lab-bucles/`](lab-bucles/README.md). Medido el 29-10-2026 en Chromium 153 headless (Linux, sin tarjeta de sonido real), con audio sintético; ninguna grabación propia se ha usado ni subido.

**Cómo leer las marcas:** «leído» = lo dice el código o un fichero del repo (se cita dónde). «medido» = sale de `lab-bucles/resultados/medidas.json` (tablas completas en `lab-bucles/resultados/tablas.md`). Lo que no se ha comprobado está en la lista **SIN MEDIR** del final.

## Resumen en llano

1. La licencia (BSD de 3 cláusulas) permite usar y modificar wavesurfer.js en un producto, también comercial, siempre que se conserve el aviso de copyright.
2. El plugin de regiones **no tiene bucle**: el bucle se hace con unas líneas de código propio que, al salir de la región, vuelven a lanzarla. Funciona, pero no es exacto.
3. El punto de inicio del bucle es exacto. El final no: sigue sonando entre 1 y 16 ms de más (lo normal, unos 4 ms); con el ordenador ocupado, hasta 54 ms. En algunas vueltas hay además un silencio de hasta 12 ms.
4. El corte es brusco, sin fundido: con música real es probable que se oiga un clic (no se ha escuchado, solo medido el salto de la onda).
5. Una variante muy natural (reproducir «hasta el final de la región» con el motor WebAudio) **se para y no repite nunca**.
6. Editar muchos bucles a la vez, encadenarlos A→B→C y guardarlos en JSON no viene hecho; se ha escrito aparte (`lab-bucles/loop-tools.js`, unas 200 líneas) y funciona con el plugin real, también con 500 bucles.
7. Varias pistas a la vez: no se desajustan con el tiempo, pero a veces arrancan o saltan desfasadas unos 9 ms. No hay reloj común: sincronizar con la partitura u otro reloj exige código propio.
8. Para un bucle sin hueco ni retraso hay que salirse de wavesurfer y usar Web Audio directamente (`AudioBufferSourceNode`); se ha escrito y medido: error menor de 1 muestra, incluso con el ordenador ocupado.

## 0. Licencia

- El fichero `LICENSE` es **BSD 3-Clause**, «Copyright (c) 2012-2023, katspaugh and contributors» (leído, `LICENSE`). `package.json` declara lo mismo: `"license": "BSD-3-Clause"` (leído).
- Permite redistribuir y usar en fuente o binario, con o sin modificaciones, si: (1) en el código fuente se mantiene el aviso de copyright, las condiciones y la renuncia de garantía; (2) en binarios se reproducen en la documentación u otros materiales; (3) no se usa el nombre del titular ni de los colaboradores para promocionar productos derivados sin permiso. Sin garantía (leído, `LICENSE`).
- No hay condición «copyleft»: el código propio que use wavesurfer no tiene que publicarse (leído: el texto de `LICENSE` no impone nada sobre el código que lo usa).

## 1. Bucle con el plugin de regiones: hueco, clic y precisión

### Cómo funciona por dentro (leído)

- El plugin no tiene opción de bucle. Su API pública son `getRegions`, `addRegion`, `enableDragSelection` y `clearRegions`, más `region.play(stopAtEnd?)`, `region.setOptions` y `region.remove` (leído, `src/plugins/regions.ts:871-876`, `663-666`).
- El bucle del ejemplo oficial se hace escuchando `region-out` y llamando a `region.play()` (leído, `examples/regions.js:106-128`).
- `region-in`/`region-out` se calculan en cada evento `timeupdate` (leído, `regions.ts:917-947`), que wavesurfer emite en cada fotograma de `requestAnimationFrame` mientras suena y en cada `timeupdate` del elemento de audio (leído, `src/wavesurfer.ts:299-335`, `src/frame-scheduler.ts`). Es decir: la vuelta la decide el hilo principal de JavaScript, no el motor de audio.
- `region.play()` hace `wavesurfer.play(region.start)`, que es un salto (`setTime`) seguido de `play()` (leído, `regions.ts:1164-1168`, `wavesurfer.ts:1040-1061`).
- Con el motor WebAudio, cada salto para el `AudioBufferSourceNode` y crea otro que arranca en `audioContext.currentTime` (leído, `src/webaudio.ts:194-252`, `353-358`).

### Método (leído en los scripts de la rama)

- `rampa.wav`: 20 s, mono, float32, 44,1 kHz; cada muestra vale 0,1 + 0,8·t/20, así que el valor dice qué instante del fichero está sonando y un 0 es silencio. `seno.wav`: 440 Hz, amplitud 0,5.
- La salida real del reproductor se graba muestra a muestra con un AudioWorklet (`recorder-worklet.js`) y se analiza (`analysis.js`): dónde se dejó de sonar, dónde se retomó y cuántas muestras hay entre medias.
- Región larga 3,217–4,243 s (1,026 s) y corta 7,531–7,832 s (0,301 s). 35 pasadas por prueba = 34 vueltas medidas (35 en la referencia sin hueco). Página nueva por prueba.
- «Con carga»: el hilo principal se bloquea 40 ms cada 60 ms (simula, por ejemplo, el repintado de una partitura pesada).

### Resultados (medido)

«Sobrepaso» = cuánto audio sonó después del final de la región antes de volver. Una muestra son 0,023 ms.

| prueba                                              | vueltas         | sobrepaso: mediana (p25–p75) [mín … máx] ms | error en el inicio, mediana ms | vueltas con hueco | hueco máx. ms |
| --------------------------------------------------- | --------------- | ------------------------------------------- | ------------------------------ | ----------------- | ------------- |
| MediaElement, región larga                          | 34              | 4,39 (4,39–13,10) [4,39 … 16,00]            | 0,007                          | 2                 | 11,61         |
| WebAudio, región larga                              | 34              | 4,39 (4,39–13,10) [1,49 … 16,00]            | 0,007                          | 0                 | 0             |
| MediaElement, región corta                          | 34              | 9,56 (9,56–18,27) [0,86 … 18,27]            | −0,002                         | 9                 | 11,61         |
| WebAudio, región corta                              | 34              | 9,56 (9,56–18,27) [0,86 … 18,27]            | −0,002                         | 7                 | 11,61         |
| MediaElement, `region.play(true)`                   | 34              | 4,39 (4,39–4,39) [1,49 … 16,00]             | 0,007                          | 4                 | 11,61         |
| WebAudio, `region.play(true)`                       | **0** (se para) | –                                           | –                              | –                 | –             |
| MediaElement, con carga                             | 34              | 27,61 (4,39–45,03) [1,49 … 53,73]           | 0,007                          | 2                 | 11,61         |
| WebAudio, con carga                                 | 34              | 24,71 (13,83–33,42) [13,10 … 36,32]         | 0,007                          | 0                 | 0             |
| **Referencia sin hueco** (`gapless-loop.js`), larga | 35              | 0,01 (0,00–0,01) [−0,00 … 0,02]             | 0,011                          | 0 de silencio     | 0,02          |
| Referencia sin hueco, corta                         | 35              | 0,01 (0,00–0,01) [−0,00 … 0,02]             | 0,014                          | 0 de silencio     | 0,02          |
| Referencia sin hueco, con carga                     | 35              | 0,01 (0,00–0,01) [−0,00 … 0,02]             | 0,011                          | 0 de silencio     | 0,02          |

Dispersión del sobrepaso (desviación típica): 4,37 ms (MediaElement larga), 4,52 ms (WebAudio larga), 5,67 ms (MediaElement corta), 20,17 ms (MediaElement con carga), 9,77 ms (WebAudio con carga) (medido).

Lo que se ve:

- **El inicio es exacto**: el primer sonido tras la vuelta cae a menos de una muestra del inicio de la región en todas las vueltas (medido).
- **El final se pasa** siempre: mediana 4,39 ms en la región larga y 9,56 ms en la corta, máximo 18,27 ms sin carga (medido). Los valores no son continuos: salen en escalones de 2,90 ms (128 muestras, el bloque de proceso de Web Audio), por ejemplo 1,49 / 4,39 / 13,10 / 16,00 ms (medido).
- El JavaScript ve casi lo mismo: el `getCurrentTime()` en el momento de `region-out` sobrepasa el fin en una mediana de 4,39 ms (larga) y 9,57 ms (corta) (medido, columna «sobrepaso visto en JS» de `tablas.md`).
- **Huecos**: algunas vueltas meten silencio exacto (muestras a 0) de hasta 512 muestras = 11,61 ms: 2 de 34 en MediaElement larga, 9 de 34 en MediaElement corta, 7 de 34 en WebAudio corta, ninguna en WebAudio larga (medido). En el resto el corte es directo, sin silencio.
- **Con el hilo principal ocupado** el sobrepaso crece hasta 53,73 ms (MediaElement) y 36,32 ms (WebAudio); la referencia sin hueco no cambia (medido).
- **`region.play(true)` con WebAudio se para**: suena hasta el final exacto (posición 4,243 s), se detiene y no da ni una vuelta; no llega a emitirse ningún `region-out` (medido, `loop-webaudio-playEnd`). La causa probable, leída en el código: con WebAudio, `play(start, end)` programa un `stop()` exacto en `end` y luego fija la posición a `end` (`webaudio.ts:279-320`), y `region-out` solo salta si la posición es mayor que `end` (`regions.ts:924-928`). Con MediaElement la misma variante sí repite (medido).

### Clic (medido con `seno.wav`)

Se mide el mayor salto entre dos muestras seguidas alrededor de cada corte, dividido por el mayor salto normal del seno (0,031).

| prueba               | cortes | salto / salto normal: mediana [mín … máx] | muestras a 0 en el corte: mediana [máx] |
| -------------------- | ------ | ----------------------------------------- | --------------------------------------- |
| MediaElement         | 40     | 15,0 [1,7 … 15,9]                         | 0 [512]                                 |
| WebAudio             | 34     | 15,0 [6,5 … 15,9]                         | 0 [256]                                 |
| Referencia sin hueco | 35     | 9,6 [7,1 … 10,4]                          | 0 [0]                                   |

- Ningún motor hace fundido: el corte es un salto brusco de la forma de onda, de hasta casi toda la amplitud (medido). En MediaElement el detector contó 40 cortes para 34 vueltas (medido, `clic-media` en `medidas.json`); de dónde salen los 6 de más no se ha desglosado.
- En la referencia sin hueco el salto es el que da la propia señal entre los dos puntos de corte: 9,6 medido frente a 9,65 calculado con los valores del seno en 4,243 s y 3,217 s (medido). Es decir, ahí el clic depende solo de dónde se ponen A y B; se quitaría con un fundido corto o cortando en pasos por cero (no está escrito).

## 2. Editar en bloque, cadenas A→B→C y JSON

### Qué trae hecho (leído)

- Crear regiones por código (`addRegion`) o arrastrando (`enableDragSelection`), moverlas y estirarlas con el ratón **de una en una**, cambiarlas por código (`region.setOptions({ start, end, color, content, ... })`), borrarlas (`remove`, `clearRegions`) y listarlas (`getRegions`) (leído, `regions.ts`).
- Eventos `region-created`, `region-updated`, `region-removed`, `region-clicked`, `region-in`, `region-out`, etc. (leído, `regions.ts:34-55`).
- Solo se mantienen en el DOM las regiones visibles (leído, `regions.ts:1044-1097`).
- **No** trae: selección múltiple, edición en bloque, cadenas, repeticiones, ni guardar/cargar regiones (leído: no hay nada de eso en `regions.ts`).

### Qué se ha escrito (`lab-bucles/loop-tools.js`)

- Edición en bloque: `batchUpdate`, `shiftAll` (desplaza todas sin salirse ni deformarlas), `padAll` (ensancha/estrecha), `snapAll` (ajusta a una rejilla de compases o pulsos) (leído, en la rama).
- Partitura: `barsToSeconds` y `secondsToBar` con un **mapa de compases** (segundo en que empieza cada compás), para definir bucles por compases aunque el tempo de la grabación no sea fijo y para mover el cursor de la partitura (leído, en la rama).
- Cadenas: `playChain(ws, regiones, { steps: [{ loop: 'A', repeat: 2 }, { loop: 'B' }, ...] })` con repeticiones y vuelta al principio (leído, en la rama). Usa el mismo mecanismo `region-out` → `play()`, así que hereda sus tiempos.
- JSON: `exportLoops` / `parseLoops` / `importLoops`, formato `{ format: "lab-bucles", version: 1, audio, barTimes?, loops: [{ id, start, end, label?, color? } | { id, bars: [desde, hasta] }], chains: [{ id, steps }] }`. La importación valida (ids repetidos, fin ≤ inicio, cadenas que apuntan a bucles inexistentes, `repeat` no entero) con mensajes en castellano y recorta a la duración del audio (leído, en la rama).
- Tests sin navegador (`node --test lab-bucles/lab.test.mjs`): 8 de 8 pasan (medido).

### Resultados con el plugin real (medido)

| bucles | crear   | desplazar todos | estrechar todos | ajustar a rejilla | exportar | importar | JSON         | ida y vuelta idéntica |
| ------ | ------- | --------------- | --------------- | ----------------- | -------- | -------- | ------------ | --------------------- |
| 50     | 6,6 ms  | 0,5 ms          | 0,2 ms          | 0,3 ms            | 0,5 ms   | 4,9 ms   | 4 133 bytes  | sí                    |
| 500    | 43,0 ms | 2,1 ms          | 1,6 ms          | 1,3 ms            | 1,6 ms   | 42,1 ms  | 42 848 bytes | sí                    |

- Cadena A→B→C→A… (35 pasos, regiones 2,113–2,904 / 5,307–6,118 / 9,711–10,402 s): sobrepaso mediana 10,08 ms, rango 1,37–20,11 ms con MediaElement (1 paso con hueco de 8,71 ms) y 7,18–19,12 ms con WebAudio (ningún hueco); inicio de cada paso exacto (−0,002 ms de mediana) (medido).
- **Al saltar de una región a otra, `region-out` de la región anterior y `region-in` de la nueva llegan dos veces**: 35 repetidos de cada en 35 pasos (medido). En bucles sobre una misma región no hay repetidos (medido). Causa leída: `region.play()` hace `setTime`, que emite `timeupdate` dentro del propio manejador de `timeupdate` del plugin, antes de que este actualice su lista de regiones activas (`wavesurfer.ts:950-956`, `regions.ts:917-947`). Quien encadene regiones tiene que ignorar los `region-out` de regiones que ya no suenan; `playChain` lo hace (medido en el test `playChain`).
- La demo (`lab-bucles/demo.html`) se ha probado con Playwright (`probar-demo.mjs`): crear 3 bucles arrastrando, mover 2 a la vez, tocar la cadena «A×2, B, C», exportar, importar, y el motor sin hueco, sin errores en consola (medido).

## 3. Varias pistas a la vez y reloj externo

### Qué trae (leído)

- El núcleo no tiene multipista: cada `WaveSurfer` es una pista con su propio reproductor (leído: no hay «multitrack» en `src/`). El ejemplo `examples/multitrack.js` carga un paquete aparte, `wavesurfer-multitrack`, desde unpkg; no está en el repo (leído).
- No hay API para iniciar varias instancias en un instante común ni para seguir un reloj externo. Con WebAudio se puede pasar un `AudioContext` compartido (`new WebAudioPlayer(ctx)`, opción `media`), pero cada `play()` arranca «ya» (`audioContext.currentTime`), no en un instante programado (leído, `webaudio.ts:64-69`, `217`; `wavesurfer.ts:53`, `227-240`).
- Con WebAudio, `getCurrentTime()` se calcula a partir de `audioContext.currentTime` (leído, `webaudio.ts:348-352`).

### Método (leído en los scripts)

Tres instancias con `rampa.wav`, cada una a un canal de la grabadora; como la muestra dice la posición, se ve el desfase real entre pistas cada 10 ms de audio. 5 repeticiones de 18 s por variante. Prueba de control con desfases forzados de +500 y −250 ms: medidos 500,000 y −250,000 ms (medido), así que el método detecta desfases.

### Resultados (medido)

| variante (5 repeticiones)                        | repeticiones con desfase | desfase cuando lo hay                                | deriva entre pistas |
| ------------------------------------------------ | ------------------------ | ---------------------------------------------------- | ------------------- |
| MediaElement, arrancar juntas                    | 1 de 5 (una pista)       | 8,71 ms todo el rato                                 | 0                   |
| WebAudio (mismo AudioContext), arrancar juntas   | 1 de 5 (dos pistas)      | 8,71 ms todo el rato                                 | 0                   |
| MediaElement con carga, arrancar juntas          | 0 de 5                   | –                                                    | 0                   |
| MediaElement, saltar todas a la vez cada 1,026 s | 4 de 5                   | hasta 8,71 ms, entre el 5,6 % y el 11,5 % del tiempo | –                   |
| WebAudio, saltar todas a la vez cada 1,026 s     | 1 de 5                   | hasta 8,71 ms, el 5,7 % del tiempo (una pista)       | –                   |

- **No hay deriva**: la posición de cada pista avanza exactamente con el reloj de audio (0,000 ppm en todas las repeticiones sin saltos). Un desfase, si aparece, se queda fijo y es múltiplo de 128 muestras (8,71 ms = 384 muestras) (medido).
- **Lo que ve el JavaScript no siempre es lo que suena**: en una repetición MediaElement, `getCurrentTime()` daba hasta 8,73 ms de diferencia entre pistas que en el audio estaban alineadas (medido, `multi-media-3-r4`).
- **Reloj externo** (`performance.now()`, el reloj de la página): en ventanas de 18 s, `getCurrentTime()` frente a `performance.now()` varía entre −488,5 y +29,2 ppm según la repetición, con residuos de hasta 18,27 ms; el propio reloj del `AudioContext` frente a `performance.now()` varía entre −483,7 y +34,5 ppm (y −1 638,5 ppm en una repetición con saltos) (medido). En headless no hay tarjeta de sonido real, así que estas cifras de reloj no valen para un equipo real (ver SIN MEDIR); lo que sí muestran es que la relación entre el reloj de audio y el de la página no es fija y hay que corregirla de forma continua.
- Para sincronizar con la partitura lo práctico es al revés: que el audio mande y la partitura siga a `getCurrentTime()` con el mapa de compases (`secondsToBar`), como hace la demo (leído, `lab-bucles/demo.js`).

## 4. Límites y lo que hay que escribir aparte

### Límites del camino «plugin de regiones» (resumen de lo anterior)

- La vuelta depende del hilo principal: 1–18 ms de más sin carga y hasta 54 ms con carga, más silencios ocasionales de hasta 11,61 ms (medido).
- Corte sin fundido (medido).
- `region.play(true)` en bucle con WebAudio se para (medido).
- `region-out`/`region-in` duplicados al saltar entre regiones distintas (medido).
- `region-in` puede llegar hasta 50 ms antes de tiempo a propósito (tolerancia `REGION_BOUNDARY_TOLERANCE = 0.05`) (leído, `regions.ts:839-858`).
- En pestañas en segundo plano `requestAnimationFrame` se suspende y solo queda el `timeupdate` del elemento de audio (leído, comentario en `wavesurfer.ts:327-330`); según el comentario de `regions.ts:853-855`, ese evento llega cada ~100–250 ms (leído). Efecto sobre los bucles: SIN MEDIR.
- `preservesPitch` (cambiar velocidad sin cambiar tono) solo se aplica al elemento de audio; `WebAudioPlayer` no lo tiene y solo cambia `bufferNode.playbackRate` (leído, `src/player.ts:382-388`, `webaudio.ts:329-346`).

### Escrito aparte en esta rama

- **Bucle sin hueco** con `AudioBufferSourceNode.loop` (`lab-bucles/gapless-loop.js`, ~80 líneas): el motor de audio da la vuelta él solo; wavesurfer queda como vista y su cursor se mueve con `setTime(loop.getCurrentTime())` (leído, en la rama). Error < 1 muestra, sin silencios, igual con carga (medido, tabla de la sección 1). Necesita el audio entero decodificado en memoria (`AudioBuffer`) (leído, en la rama: usa `ws.getDecodedData()` o `decodeAudioData`).
- **Edición en bloque, cadenas, JSON y compases** (`lab-bucles/loop-tools.js`) (sección 2).

### Pendiente de escribir (no hecho)

- Fundido corto (unos ms) en el punto de vuelta para quitar el clic, o ajuste de A y B al paso por cero más cercano.
- Cadena sin hueco: programar cada tramo con `start(when, offset, duration)` sobre el reloj del `AudioContext`, en vez de esperar a `region-out`.
- Varias pistas sincronizadas: un `AudioContext` común y todas las fuentes arrancadas con el mismo `when` en el futuro, en lugar de `play()` una a una.
- Estudiar lento sin cambiar el tono en el camino sin hueco: necesita un estirador de tiempo (el repo trae un ejemplo con `examples/phase-vocoder/`, no evaluado).
- Seguir un reloj externo real (MIDI, metrónomo, otro dispositivo): medir la diferencia de forma continua y corregir.

## SIN MEDIR

- Nada en equipos reales: todo es Chromium 153 headless en Linux sin tarjeta de sonido (salida simulada). Falta Firefox, Safari, móviles, Windows/macOS, auriculares Bluetooth y latencia de salida real.
- Si el clic medido (salto de la forma de onda) se **oye** con música real, y cuánto molesta: no se ha escuchado.
- Bucles con `playbackRate` distinto de 1 (estudio lento) en cualquier motor, con y sin `preservesPitch`.
- Que con WebAudio cambiar la velocidad cambie también el tono (es lo que dice la especificación de Web Audio para `playbackRate`; aquí no se ha comprobado).
- Bucles en pestaña en segundo plano o con la pantalla bloqueada.
- Ficheros comprimidos (MP3, AAC, Opus): solo se ha usado WAV float32; con formatos comprimidos el salto puede comportarse distinto.
- Grabaciones largas: memoria y tiempo de decodificación para el bucle sin hueco (que necesita todo el audio decodificado).
- Deriva de reloj en sesiones de más de 18 s y frente a relojes externos reales (MIDI, otro equipo).
- El paquete `wavesurfer-multitrack` (externo, no está en el repo).
- Interacción con una partitura real (renderizado, cursor); solo se ha simulado la carga del hilo principal.
- Más de 500 bucles, y edición con el ratón de muchos a la vez (solo se ha medido por código).
- El fundido para quitar el clic y la cadena sin hueco: no están escritos, así que tampoco medidos.
- Por qué el detector de clic contó 40 cortes para 34 vueltas con MediaElement (probablemente principio y final de un mismo silencio, sin comprobar).
