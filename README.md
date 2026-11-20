# ThomasForever

Una mascota de escritorio para Windows hecha con las fotos de tu propia mascota. Vive encima de tus ventanas mientras trabajas: pasea, duerme, come, maúlla y reacciona a lo que haces.

Todo se procesa en tu equipo. No hay cuentas, ni servidores, ni envío de fotos a ningún sitio.

## Qué hace

- **Tu mascota, no una genérica.** Subes una foto y la app le quita el fondo en local. Si añades más fotos en otras posturas (caminando, durmiendo, comiendo, maullando, contenta), las usa como poses.
- **Vive en el escritorio.** Ventana transparente, siempre visible, que deja pasar los clics en todo lo que no sea la mascota.
- **Reacciona a tus ventanas.** Se sube a los bordes superiores de las ventanas, viaja con ellas si las mueves y, cuando minimizas o cierras una, salta hasta el botón como si lo hubiera pulsado ella.
- **Cuidados.** Comida, energía y cariño bajan con el tiempo. Puedes darle de comer (también arrastrando la comida), acariciarla y mandarla a dormir.
- **Sonidos.** Maullidos y ronroneos de gatos reales incluidos; puedes elegir cuáles suenan o sustituirlos por grabaciones de tu mascota.
- **Ajustes.** Tamaño, nivel de actividad, volumen, frecuencia de maullidos, interacción con ventanas, pantalla e inicio con Windows.

## Requisitos

- Windows 10 u 11 de 64 bits. Es el único sistema en el que se ha probado; la interacción con ventanas usa la API de Windows.
- [Node.js](https://nodejs.org/) (desarrollado y probado con la versión 24).

## Puesta en marcha

```bash
git clone https://github.com/HugoRB94/ThomasForever.git
cd ThomasForever
npm install
npm start
```

La mascota aparece en la parte baja de la pantalla y un icono de gato en la bandeja del sistema.

Si `npm install` no descarga el binario de Electron (algunas versiones de npm bloquean los scripts de instalación), el propio proyecto lo detecta y lo descarga al terminar la instalación.

## Cómo se usa

| Quiero… | Cómo |
|---|---|
| Abrir los ajustes | Doble clic en el icono de la bandeja, o clic derecho sobre la mascota → Ajustes… |
| Usar mi mascota | Ajustes → Mascota → Elegir foto… |
| Añadir poses | Ajustes → Mascota → Avatar seleccionado → pulsa un hueco de pose y elige la foto |
| Acariciar, dar de comer, dormir | Clic derecho sobre la mascota |
| Moverla | Arrástrala; si la sueltas en movimiento, sale lanzada |
| Elegir los maullidos | Ajustes → Sonido → Maullidos incluidos |
| Usar sus propios sonidos | Ajustes → Sonido → Añadir audios… |
| Cerrar la app | Clic derecho → Salir, o `Ctrl+Alt+Shift+Q` |

### Consejos para las fotos

- Que la mascota se vea entera y destaque del fondo. Las fotos con mantas, cojines u objetos pegados a ella se recortan peor; recórtalas antes alrededor del animal.
- Para la pose base funciona mejor una foto sentada. Para caminar, una de lado.
- Si al pasear camina hacia atrás, cambia "En la imagen mira hacia" en los ajustes del avatar.

La primera vez que importas una foto se descarga el modelo de recorte (unos 170 MB, o 5 MB si eliges la calidad rápida). Se guarda en tu carpeta de usuario y se verifica su integridad antes de usarlo.

## Opciones de línea de comandos

```bash
npm start -- --import-photo=C:\ruta\foto.jpg --name=Thomas   # crea un avatar desde una foto
npm start -- --add-pose=sleep:C:\ruta\durmiendo.jpg          # añade una pose al avatar activo
npm run debug                                                # muestra los bordes de ventana detectados y registros
```

Poses disponibles: `idle`, `walk1`, `walk2`, `sleep`, `eat`, `happy`, `meow`.

Con la app ya abierta, una segunda ejecución con `--action=meow|pet|feed|sleep|wake` le envía esa acción.

## Generar el instalador

```bash
npm run dist    # instalador de Windows en dist/
npm run pack    # carpeta ejecutable sin instalador
```

El instalador no está firmado, así que Windows mostrará un aviso al ejecutarlo.

## Dónde se guardan tus datos

En `%APPDATA%\thomasforever`: ajustes, avatares recortados, sonidos propios y el modelo de recorte. Nada de eso forma parte de este repositorio. Borrar esa carpeta deja la app como recién instalada.

## Limitaciones conocidas

- Con una sola foto no hay ciclo de patas: la mascota se balancea y da saltitos. Las poses mejoran el resultado, pero siguen siendo fotos fijas.
- Solo se sube a una ventana si su borde superior deja sitio encima. Con ventanas maximizadas no hay borde donde subirse.
- Se queda encima de vídeos y juegos a pantalla completa; hay que ocultarla desde el menú.
- Vive en una sola pantalla (se elige en los ajustes).
- En reposo consume alrededor de 300 MB de memoria.

## Cómo está hecho

- [Electron](https://www.electronjs.org/) para la ventana transparente y la integración con el sistema.
- [PixiJS](https://pixijs.com/) para el dibujo y la animación.
- [ONNX Runtime](https://onnxruntime.ai/) para el recorte de fondo en local, en un proceso aparte que se cierra al terminar.
- [Koffi](https://koffi.dev/) para consultar las ventanas abiertas mediante la API de Windows.

```
src/main/       proceso principal: ventanas, ajustes, avatares, sonidos, seguimiento de ventanas
src/main/pipeline/   recorte de fondo y utilidades de imagen
src/preload/    puente entre las páginas y el proceso principal
src/renderer/   la mascota: físicas, comportamiento, necesidades, audio y avatares
src/settings/   ventana de ajustes
assets/sounds/  grabaciones incluidas
```

## Créditos

- **Maullidos:** [BigSoundBank](https://bigsoundbank.com/search?q=meow) (Joseph Sardin), licencia CC0.
- **Ronroneos:** ["cat purr meow"](https://opengameart.org/content/cat-purr-meow), de Kerzoven, licencia CC0.
- **Modelos de recorte:** IS-Net y U²-Net, descargados de las publicaciones del proyecto [rembg](https://github.com/danielgatis/rembg). Cada modelo tiene su propia licencia.

El detalle de cada grabación está en [assets/sounds/CREDITS.txt](assets/sounds/CREDITS.txt).

## Licencia

[MIT](LICENSE). Las grabaciones de sonido incluidas son CC0.
